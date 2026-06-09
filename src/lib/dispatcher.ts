/**
 * Shared dispatch + scheduling logic.
 *
 * Used by both the standalone scheduler worker (scripts/scheduler.ts) and the
 * manual "run now" route (/api/scheduler/tick). Keeps grouping, ordering,
 * business-hours, concurrency, and Vapi dispatch in one reusable place so the
 * worker and the HTTP routes never drift.
 */

import { prisma } from "@/lib/prisma";
import {
  dispatchVapiCall,
  buildVoicemailMessage,
  getVoiceLanguage,
  getVoiceGender,
  type InvoiceBlock,
} from "@/lib/vapi";
import type { Invoice, Settings } from "@prisma/client";

const MAX_ACTIVE_CALLS = Number(process.env.MAX_CONCURRENT_CALLS ?? "1");
const ACTIVE_STATUSES = ["dispatching", "ringing", "in-progress"];
const ACTIVE_CUTOFF_MS = 13 * 60 * 1000;
const STALE_MS = 15 * 60 * 1000;

export const MAX_INVOICE_ATTEMPTS = 3;

type VoiceId = "iris" | "arjun" | "theo";
type Manner = "warm" | "crisp" | "formal";

// --- Grouping ------------------------------------------------------------

// Strip legal suffixes + punctuation so "Acme Pty Ltd" and "ACME" collapse together.
export function normalizeBusinessName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|inc|incorporated|llc|co|company|corp|corporation|group|holdings|international|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// ABN first (most reliable), normalized business name as fallback.
export function computeGroupKey(abn: string | null | undefined, name: string): string {
  const cleanAbn = (abn ?? "").replace(/\s/g, "");
  if (cleanAbn) return `abn:${cleanAbn}`;
  return `name:${normalizeBusinessName(name)}`;
}

// --- Phone (mirror of the dispatch route's normaliser; AU default) -------

export function normalisePhone(raw: string): string {
  const n = (raw ?? "").trim().replace(/[ \-().]/g, "");
  if (n.startsWith("+")) return n;
  if (n.startsWith("0")) return "+61" + n.slice(1);
  if (n.startsWith("61")) return "+" + n;
  return "+" + n;
}

// --- Settings singleton --------------------------------------------------

export async function getSettings(): Promise<Settings> {
  return prisma.settings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
}

// --- Business hours ------------------------------------------------------

// Read the recipient-local weekday + hour via Intl (no date dependency) and
// test against the configured window. ISO weekdays: Mon=1 .. Sun=7.
export function isWithinBusinessHours(now: Date, s: Settings): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: s.timezone,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const isoMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const iso = isoMap[wd] ?? 0;
  const days = s.bhDays.split(",").map((d) => parseInt(d.trim(), 10)).filter((n) => !Number.isNaN(n));
  if (!days.includes(iso)) return false;
  return hour >= s.bhStartHour && hour < s.bhEndHour;
}

// --- Concurrency gate (mirror of dispatch route L107-131) ----------------

async function reapStaleCalls(): Promise<void> {
  await prisma.call.updateMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      createdAt: { lte: new Date(Date.now() - STALE_MS) },
    },
    data: { status: "failed", endedReason: "abandoned-no-response", outcome: "failed" },
  });
}

export async function freeCallSlots(): Promise<number> {
  await reapStaleCalls();
  const active = await prisma.call.count({
    where: {
      status: { in: ACTIVE_STATUSES },
      createdAt: { gte: new Date(Date.now() - ACTIVE_CUTOFF_MS) },
    },
  });
  return Math.max(0, MAX_ACTIVE_CALLS - active);
}

// --- Ordering ------------------------------------------------------------

function minDueDate(group: Invoice[]): string {
  return group.reduce((min, i) => {
    const d = i.dueDate ?? "9999-12-31";
    return d < min ? d : min;
  }, "9999-12-31");
}

function groupTotal(group: Invoice[]): number {
  return group.reduce((sum, i) => sum + (i.amountDue ?? 0), 0);
}

// Group eligible invoices by debtor, then order the groups per Settings.
// overdue + asc  → most overdue (earliest due date) first.
// amount  + desc → largest debt first.
export function groupAndOrder(invoices: Invoice[], settings: Settings): Invoice[][] {
  const map = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    const key = inv.groupKey || computeGroupKey(inv.abn, inv.contactBusiness);
    const arr = map.get(key);
    if (arr) arr.push(inv);
    else map.set(key, [inv]);
  }
  const groups = Array.from(map.values());
  const dir = settings.sortDir === "desc" ? -1 : 1;
  groups.sort((a, b) => {
    if (settings.sortField === "amount") {
      return (groupTotal(a) - groupTotal(b)) * dir;
    }
    return minDueDate(a).localeCompare(minDueDate(b)) * dir;
  });
  return groups;
}

// --- Dispatch one debtor group as a single aggregated call ---------------

function requiredEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.VAPI_PRIVATE_KEY) missing.push("VAPI_PRIVATE_KEY");
  if (!process.env.TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
  if (!process.env.TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
  if (!process.env.TWILIO_PHONE_NUMBER) missing.push("TWILIO_PHONE_NUMBER");
  if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (!process.env.PUBLIC_URL) missing.push("PUBLIC_URL");
  return missing;
}

export type DispatchResult =
  | { ok: true; callId: string; vapiCallId?: string }
  | { ok: false; error: string };

export async function dispatchInvoiceGroup(invoices: Invoice[]): Promise<DispatchResult> {
  if (invoices.length === 0) return { ok: false, error: "empty group" };

  const missing = requiredEnv();
  if (missing.length) return { ok: false, error: `missing env: ${missing.join(", ")}` };

  // Oldest-due invoice represents the debtor for flat Call fields + dialing.
  const sorted = [...invoices].sort((a, b) =>
    (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31")
  );
  const lead = sorted[0];
  if (!lead.toNumber) return { ok: false, error: "no phone number on lead invoice" };
  const toNumber = normalisePhone(lead.toNumber);

  const voice = lead.voice as VoiceId;
  const manner = lead.manner as Manner;
  const language = getVoiceLanguage(lead.voice);
  const gender = getVoiceGender(lead.voice);

  const invoiceBlocks: InvoiceBlock[] = sorted.map((i) => ({
    invoiceNumber: i.invoiceNumber ?? undefined,
    invoiceDate: i.invoiceDate ?? undefined,
    dueDate: i.dueDate ?? undefined,
    amountDue: i.amountDue ?? undefined,
    currency: i.currency ?? undefined,
    lineItems: i.lineItems ?? undefined,
    invoiceNotes: i.invoiceNotes ?? undefined,
  }));

  const totalAmount = sorted.reduce((sum, i) => sum + (i.amountDue ?? 0), 0);
  const voicemailScript = buildVoicemailMessage({
    contactBusiness: lead.contactBusiness,
    userName: lead.userName,
    invoiceNumber: lead.invoiceNumber,
    amountDue: invoices.length > 1 ? totalAmount : lead.amountDue,
    currency: lead.currency,
    dueDate: invoices.length > 1 ? null : lead.dueDate,
    invoiceCount: invoices.length,
    language,
    gender,
  });

  // 1. Create the Call row. Flat invoice fields come from the lead invoice for
  //    Detail back-compat; amountDue is the aggregate total across the group.
  const call = await prisma.call.create({
    data: {
      contactBusiness: lead.contactBusiness,
      contactPerson: lead.contactPerson,
      toNumber,
      objective: lead.objective,
      voice: lead.voice,
      manner: lead.manner,
      invoiceNumber: lead.invoiceNumber,
      invoiceDate: lead.invoiceDate,
      dueDate: lead.dueDate,
      amountDue: invoices.length > 1 ? totalAmount : lead.amountDue,
      currency: lead.currency,
      lineItems: lead.lineItems,
      invoiceNotes: lead.invoiceNotes,
      bankName: lead.bankName,
      bsb: lead.bsb,
      accountNumber: lead.accountNumber,
      swiftCode: lead.swiftCode,
      abn: lead.abn,
      remittanceName: lead.remittanceName,
      remittanceContact: lead.remittanceContact,
      voicemailScript,
      status: "dispatching",
    },
  });

  // 2. Link the invoices to this call and mark them calling.
  const invoiceIds = invoices.map((i) => i.id);
  await prisma.invoice.updateMany({
    where: { id: { in: invoiceIds } },
    data: { status: "calling", callId: call.id, attempts: { increment: 1 } },
  });

  // 3. Dispatch via Vapi.
  try {
    const vapiCall = await dispatchVapiCall({
      toNumber,
      contactBusiness: lead.contactBusiness,
      contactPerson: lead.contactPerson ?? undefined,
      objective: lead.objective,
      voice,
      manner,
      userName: lead.userName,
      invoices: invoiceBlocks,
      bankName: lead.bankName ?? undefined,
      bsb: lead.bsb ?? undefined,
      accountNumber: lead.accountNumber ?? undefined,
      swiftCode: lead.swiftCode ?? undefined,
      abn: lead.abn ?? undefined,
      remittanceName: lead.remittanceName ?? undefined,
      remittanceContact: lead.remittanceContact ?? undefined,
      twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER!,
      twilioAccountSid: process.env.TWILIO_ACCOUNT_SID!,
      twilioAuthToken: process.env.TWILIO_AUTH_TOKEN!,
      publicUrl: process.env.PUBLIC_URL!,
      anthropicKey: process.env.ANTHROPIC_API_KEY!,
    });

    await prisma.call.update({
      where: { id: call.id },
      data: { vapiCallId: vapiCall.id, status: "ringing" },
    });
    return { ok: true, callId: call.id, vapiCallId: vapiCall.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await prisma.call.update({
      where: { id: call.id },
      data: { status: "failed", endedReason: msg.slice(0, 500), outcome: "failed" },
    });
    // Call never connected — return invoices to the queue for a later tick.
    await prisma.invoice.updateMany({
      where: { id: { in: invoiceIds } },
      data: { status: "pending", callId: null, chaseAfter: new Date(Date.now() + 60 * 60 * 1000) },
    });
    return { ok: false, error: msg };
  }
}

// --- One scheduler tick --------------------------------------------------

export interface TickResult {
  dispatched: number;
  reason?: string;
  errors?: string[];
}

export async function runSchedulerTick(opts: { ignoreBusinessHours?: boolean } = {}): Promise<TickResult> {
  const settings = await getSettings();
  if (!settings.schedulerOn) return { dispatched: 0, reason: "scheduler off" };
  if (!opts.ignoreBusinessHours && !isWithinBusinessHours(new Date(), settings)) {
    return { dispatched: 0, reason: "outside business hours" };
  }

  const slots = await freeCallSlots();
  if (slots <= 0) return { dispatched: 0, reason: "no free call slots" };

  const eligible = await prisma.invoice.findMany({
    where: { status: "pending", chaseAfter: { lte: new Date() } },
  });
  if (eligible.length === 0) return { dispatched: 0, reason: "no eligible invoices" };

  const groups = groupAndOrder(eligible, settings);
  let dispatched = 0;
  const errors: string[] = [];
  for (const group of groups) {
    if (dispatched >= slots) break;
    const res = await dispatchInvoiceGroup(group);
    if (res.ok) dispatched++;
    else errors.push(res.error);
  }
  return { dispatched, errors: errors.length ? errors : undefined };
}
