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
  probeVapiCall,
  type InvoiceBlock,
} from "@/lib/vapi";
import { companyNamesMatch } from "@/lib/nameUtils";
import { createTicket } from "@/lib/tickets";
import { resolveDispatchConfig } from "@/lib/credentials";
import { Prisma } from "@prisma/client";
import type { Call, Invoice, Settings, InvoiceLineItem } from "@prisma/client";

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
    .replace(/\b(pty|ltd|limited|inc|incorporated|llc|co|company|corp|corporation|group|holdings|international|the|software|solutions|technologies|tech|systems|services|management|consulting|enterprises|enterprise|digital|innovations|innovation|partners|ventures|associates|global|properties|property|and)\b/g, "")
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

// --- Customer resolution + line-item (de)serialisation --------------------

type DbClient = Prisma.TransactionClient | typeof prisma;

// Find-or-create the debtor Customer for an invoice (ABN first, fuzzy business-name
// fallback — mirrors computeGroupKey's grouping so a debtor collapses to one row).
export async function resolveCustomerId(
  db: DbClient,
  args: { ownerId: string; abn?: string | null; businessName: string; contactPerson?: string | null; phone?: string | null }
): Promise<string> {
  const cleanAbn = (args.abn ?? "").replace(/\s/g, "");
  if (cleanAbn) {
    const byAbn = await db.customer.findFirst({ where: { ownerId: args.ownerId, abn: cleanAbn } });
    if (byAbn) return byAbn.id;
  }
  // Fuzzy name match is scoped to THIS tenant's customers only.
  const all = await db.customer.findMany({ where: { ownerId: args.ownerId }, select: { id: true, businessName: true } });
  const match = all.find((c) => companyNamesMatch(c.businessName, args.businessName));
  if (match) return match.id;
  const created = await db.customer.create({
    data: {
      ownerId: args.ownerId,
      businessName: args.businessName,
      abn: cleanAbn || null,
      contactPerson: args.contactPerson ?? null,
      contactPhone: args.phone ?? null,
    },
  });
  return created.id;
}

// Backfill the debtor Customer from a resolved Call (1E). Fills in contact fields
// that are still empty on the Customer using what the call carried (person/phone/abn),
// so a customer first seen via an outbound call gets its CRM row fleshed out. Owner-
// scoped and non-destructive — never overwrites a value the Customer already has.
export async function backfillCustomerFromCall(ownerId: string, callId: string): Promise<void> {
  const call = await prisma.call.findFirst({ where: { id: callId, ownerId } });
  if (!call?.customerId) return;
  const customer = await prisma.customer.findFirst({ where: { id: call.customerId, ownerId } });
  if (!customer) return;

  const patch: { contactPerson?: string; contactPhone?: string; abn?: string } = {};
  if (!customer.contactPerson && call.contactPerson) patch.contactPerson = call.contactPerson;
  if (!customer.contactPhone && call.toNumber) patch.contactPhone = call.toNumber;
  if (!customer.abn && call.abn) patch.abn = call.abn.replace(/\s/g, "");
  if (Object.keys(patch).length === 0) return;

  await prisma.customer.update({ where: { id: customer.id }, data: patch });
}

// Line items are stored as InvoiceLineItem rows but the parser/prompt/UI speak a
// JSON string of { description, quantity, unitPrice, amount }. These convert between
// the two representations at the DB boundary.
export function serializeLineItems(
  rows: Pick<InvoiceLineItem, "description" | "quantity" | "unitPrice" | "lineTotal">[] | undefined
): string | null {
  if (!rows || rows.length === 0) return null;
  return JSON.stringify(
    rows.map((r) => ({
      description: r.description ?? undefined,
      quantity: r.quantity ?? undefined,
      unitPrice: r.unitPrice ?? undefined,
      amount: r.lineTotal ?? undefined,
    }))
  );
}

export function parseLineItemRows(
  lineItems: string | null | undefined
): { description: string | null; quantity: number | null; unitPrice: number | null; lineTotal: number | null }[] {
  if (!lineItems) return [];
  try {
    const arr = JSON.parse(lineItems);
    if (!Array.isArray(arr)) return [];
    return arr.map((it: { description?: unknown; quantity?: unknown; unitPrice?: unknown; amount?: unknown; lineTotal?: unknown }) => ({
      description: typeof it.description === "string" ? it.description : null,
      quantity: typeof it.quantity === "number" ? it.quantity : null,
      unitPrice: typeof it.unitPrice === "number" ? it.unitPrice : null,
      lineTotal: typeof it.amount === "number" ? it.amount : typeof it.lineTotal === "number" ? it.lineTotal : null,
    }));
  } catch {
    return [];
  }
}

// --- Settings (per-tenant) -----------------------------------------------

export async function getSettings(ownerId: string): Promise<Settings> {
  return prisma.settings.upsert({
    where: { ownerId },
    create: { ownerId },
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

async function reapStaleCalls(ownerId: string): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_MS);
  const staleCalls = await prisma.call.findMany({
    where: { ownerId, status: { in: ACTIVE_STATUSES }, createdAt: { lte: staleThreshold } },
    select: { id: true },
  });
  if (staleCalls.length === 0) return;
  const staleIds = staleCalls.map((c) => c.id);

  await prisma.call.updateMany({
    where: { id: { in: staleIds } },
    data: { status: "failed", endedReason: "abandoned-no-response", outcome: "failed" },
  });

  // Also requeue (or permanently fail) any invoices stuck at "calling" for reaped calls.
  const settings = await getSettings(ownerId);
  const links = await prisma.callInvoice.findMany({
    where: { callId: { in: staleIds } },
    select: { invoiceId: true },
  });
  const linked = await prisma.invoice.findMany({
    where: { id: { in: links.map((l) => l.invoiceId) }, ownerId, status: "calling" },
  });
  for (const inv of linked) {
    if (!settings.autoRetry || inv.attempts >= MAX_INVOICE_ATTEMPTS) {
      await prisma.invoice.update({ where: { id: inv.id }, data: { status: "failed" } });
    } else {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          status: "pending",
          chaseAfter: new Date(Date.now() + (settings.retryDelayHours ?? 24) * 60 * 60 * 1000),
        },
      });
    }
  }
}

export async function freeCallSlots(ownerId: string): Promise<number> {
  await reapStaleCalls(ownerId);
  const active = await prisma.call.count({
    where: {
      ownerId,
      status: { in: ACTIVE_STATUSES },
      createdAt: { gte: new Date(Date.now() - ACTIVE_CUTOFF_MS) },
    },
  });
  return Math.max(0, MAX_ACTIVE_CALLS - active);
}

// --- Call status sync (Vapi reconciliation) -------------------------------
// Shared by the Live screen poll (/api/calls/[id]) and the Queue screen poll
// (/api/invoices) so a call's status self-heals from Vapi's own record even
// when the end-of-call-report webhook is missed or delayed.

const CALL_STATUS_RANK: Record<string, number> = {
  dispatching: 0, queued: 1, ringing: 2, "in-progress": 3, completed: 4, failed: 4,
};

function deriveCallOutcome(endedReason?: string, successEval?: string): string {
  const r = (endedReason ?? "").toLowerCase();
  if (r.includes("no-answer") || r.includes("voicemail") || r.includes("busy") || r.includes("machine")) return "no-answer";
  if (successEval) {
    const s = successEval.toLowerCase();
    if (s.includes("success") || s === "true" || s === "pass") return "success";
    if (s.includes("partial")) return "partial";
    if (s.includes("fail") || s === "false") return "failed";
  }
  if (!endedReason) return "success";
  if (r.includes("error") || r.includes("failed")) return "failed";
  return "success";
}

// Returns a plain array for the Call.transcript jsonb column.
function formatCallMessages(
  messages?: Array<{ role: string; message?: string; content?: string }>
): { who: string; text: string }[] {
  if (!messages?.length) return [];
  return messages
    .filter((m) => m.role === "assistant" || m.role === "user" || m.role === "bot")
    .map((m) => ({ who: m.role === "user" ? "them" : "envoy", text: m.message ?? m.content ?? "" }))
    .filter((m) => m.text.length > 0);
}

type VapiCallDetail = Record<string, unknown> & {
  status?: string;
  endedReason?: string;
  durationSeconds?: number;
  artifact?: {
    messages?: Array<{ role: string; message?: string; content?: string }>;
    recordingUrl?: string;
  };
  messages?: Array<{ role: string; message?: string; content?: string }>;
  analysis?: { summary?: string; successEvaluation?: string };
  summary?: string;
  recordingUrl?: string;
};

const CALL_VOICEMAIL_RE = /audio message|leave a message|leave your message|not available|unavailable|voicemail|answering machine|at the tone|after the beep|record your message|send a message/i;

// Probe Vapi directly for a call that hasn't reached a terminal state locally, and
// self-heal: if Vapi reports it "ended", pull the transcript/summary/outcome and
// mark it completed; otherwise advance-only sync the intermediate status. No-ops
// for calls that are already terminal or were never dispatched to Vapi.
export async function syncCallFromVapi(call: Call): Promise<{ call: Call; pollError: string | null }> {
  if (!call.vapiCallId || call.status === "completed" || call.status === "failed") {
    return { call, pollError: null };
  }

  let pollError: string | null = null;
  const ageMs = Date.now() - new Date(call.createdAt).getTime();
  const RINGING_TIMEOUT_MS = 5 * 60 * 1000;
  const IN_PROGRESS_TIMEOUT_MS = 12 * 60 * 1000;

  const probe = await probeVapiCall(call.vapiCallId);

  if (probe.ok) {
    const vapiData = probe.data as VapiCallDetail;

    if (vapiData.status === "ended") {
      const transcript = formatCallMessages(vapiData.artifact?.messages ?? vapiData.messages);
      const summary = vapiData.analysis?.summary ?? (vapiData.summary as string | undefined) ?? null;
      const endedReason = (vapiData.endedReason as string | undefined) ?? null;
      const rawMessages = vapiData.artifact?.messages ?? vapiData.messages ?? [];
      const transcriptHasVoicemail = rawMessages.some(
        (m: { role: string; message?: string; content?: string }) =>
          m.role === "user" && CALL_VOICEMAIL_RE.test(m.message ?? m.content ?? "")
      );
      const isVoicemailDetected = !!(endedReason && /voicemail|machine/i.test(endedReason)) || transcriptHasVoicemail;
      const outcome = isVoicemailDetected
        ? "no-answer"
        : deriveCallOutcome(endedReason ?? undefined, vapiData.analysis?.successEvaluation);
      const result = summary
        ? summary.split(/[.\n]/).find((s: string) => s.trim().length > 10)?.trim() ?? null
        : null;

      call = await prisma.call.update({
        where: { id: call.id },
        data: {
          status: "completed",
          outcome,
          summary,
          transcript,
          recordingUrl: vapiData.artifact?.recordingUrl ?? (vapiData.recordingUrl as string | undefined) ?? null,
          durationSec: (vapiData.durationSeconds as number | undefined) ?? null,
          endedReason,
          result,
        },
      });
    } else if (vapiData.status) {
      // Only advance — never regress (e.g. Vapi's early "queued" state overwriting
      // "ringing" that the dispatch route already set).
      const currentRank = CALL_STATUS_RANK[call.status] ?? -1;
      const newRank = CALL_STATUS_RANK[vapiData.status] ?? -1;
      if (newRank > currentRank) {
        call = await prisma.call.update({
          where: { id: call.id },
          data: { status: vapiData.status },
        });
      }
    }
  } else {
    pollError = probe.error;

    if (call.status === "ringing" && ageMs > RINGING_TIMEOUT_MS) {
      call = await prisma.call.update({
        where: { id: call.id },
        data: { status: "failed", endedReason: "vapi-unreachable", outcome: "failed" },
      });
    } else if (call.status === "in-progress" && ageMs > IN_PROGRESS_TIMEOUT_MS) {
      call = await prisma.call.update({
        where: { id: call.id },
        data: { status: "failed", endedReason: "vapi-unreachable", outcome: "failed" },
      });
    }
  }

  return { call, pollError };
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
//
// Groups by fuzzy business-name match (mirroring the Queue screen's own display
// grouping in page.tsx) rather than the raw groupKey column — a single customer's
// invoices can end up with different groupKeys (e.g. differing per-invoice ABNs),
// and grouping by the literal column would risk splitting one customer across two
// concurrent calls to the same phone number within a single scheduler tick.
export function groupAndOrder(invoices: Invoice[], settings: Settings): Invoice[][] {
  const buckets: { business: string; items: Invoice[] }[] = [];
  for (const inv of invoices) {
    const existing = buckets.find((b) => companyNamesMatch(b.business, inv.contactBusiness));
    if (existing) existing.items.push(inv);
    else buckets.push({ business: inv.contactBusiness, items: [inv] });
  }
  const groups = buckets.map((b) => b.items);
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

export type DispatchResult =
  | { ok: true; callId: string; vapiCallId?: string }
  | { ok: false; error: string };

// All invoices in `invoices` must belong to `ownerId` (the caller — a per-tenant
// scheduler tick or an owner-scoped API route — guarantees this).
export async function dispatchInvoiceGroup(ownerId: string, invoices: Invoice[]): Promise<DispatchResult> {
  if (invoices.length === 0) return { ok: false, error: "empty group" };

  // Per-tenant outbound config (own Vapi/Twilio/Anthropic keys + caller-id), each
  // falling back to the process env when the tenant hasn't set its own (Phase 3-G).
  const { config: cfg, missing } = await resolveDispatchConfig(ownerId);
  if (missing.length) return { ok: false, error: `missing config: ${missing.join(", ")}` };

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

  // Same-customer pending invoices outside this dispatch batch, matched by fuzzy
  // business name rather than the raw groupKey column — a debtor's invoices can
  // end up with different groupKeys (e.g. differing per-invoice ABNs) even though
  // they're clearly the same customer, which is why the Queue screen's own display
  // grouping (page.tsx) already fuzzy-matches by name. Already-overdue matches are
  // folded in as full participants of this call (linked + marked calling, resolved/
  // requeued by the webhook like the rest); not-yet-due matches stay context-only —
  // the agent can discuss them if asked, but they aren't formally being chased yet.
  const today = new Date().toISOString().split("T")[0];
  const candidates = await prisma.invoice.findMany({
    where: { ownerId, status: "pending", id: { notIn: invoices.map((i) => i.id) } },
  });
  const sameCustomer = candidates.filter((i) => companyNamesMatch(i.contactBusiness, lead.contactBusiness));
  const overdueExtras = sameCustomer.filter((i) => i.dueDate && i.dueDate < today);
  const notYetDueExtras = sameCustomer.filter((i) => !overdueExtras.includes(i));

  const allDispatched = [...invoices, ...overdueExtras];
  const sortedAll = [...allDispatched].sort((a, b) =>
    (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31")
  );

  // Line items live in their own table — load them for every invoice we'll speak
  // about (dispatched + context-only) and re-serialise to the prompt's JSON shape.
  const involvedIds = [...sortedAll, ...notYetDueExtras].map((i) => i.id);
  const liRows = await prisma.invoiceLineItem.findMany({ where: { invoiceId: { in: involvedIds } } });
  const liByInvoice = new Map<string, InvoiceLineItem[]>();
  for (const r of liRows) {
    const list = liByInvoice.get(r.invoiceId);
    if (list) list.push(r);
    else liByInvoice.set(r.invoiceId, [r]);
  }
  const toBlock = (i: Invoice): InvoiceBlock => ({
    invoiceNumber: i.invoiceNumber ?? undefined,
    invoiceDate: i.invoiceDate ?? undefined,
    dueDate: i.dueDate ?? undefined,
    amountDue: i.amountDue ?? undefined,
    currency: i.currency ?? undefined,
    lineItems: serializeLineItems(liByInvoice.get(i.id)) ?? undefined,
    invoiceNotes: i.invoiceNotes ?? undefined,
  });

  const invoiceBlocks: InvoiceBlock[] = sortedAll.map(toBlock);
  const allInvoiceBlocks: InvoiceBlock[] = [...invoiceBlocks, ...notYetDueExtras.map(toBlock)];

  const totalAmount = sortedAll.reduce((sum, i) => sum + (i.amountDue ?? 0), 0);
  const voicemailScript = buildVoicemailMessage({
    contactBusiness: lead.contactBusiness,
    userName: lead.userName,
    invoiceNumber: lead.invoiceNumber,
    amountDue: allDispatched.length > 1 ? totalAmount : lead.amountDue,
    currency: lead.currency,
    dueDate: allDispatched.length > 1 ? null : lead.dueDate,
    invoiceCount: allDispatched.length,
    language,
    gender,
  });

  // 1. Create the Call row. Flat invoice fields come from the lead invoice for
  //    Detail back-compat; amountDue is the aggregate total across the group.
  const call = await prisma.call.create({
    data: {
      ownerId,
      customerId: lead.customerId,
      contactBusiness: lead.contactBusiness,
      contactPerson: lead.contactPerson,
      toNumber,
      objective: lead.objective,
      voice: lead.voice,
      manner: lead.manner,
      userName: lead.userName,
      invoiceNumber: lead.invoiceNumber,
      invoiceDate: lead.invoiceDate,
      dueDate: lead.dueDate,
      amountDue: allDispatched.length > 1 ? totalAmount : lead.amountDue,
      currency: lead.currency,
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

  // 2. Link the invoices to this call (call_invoice join) and mark them calling.
  const invoiceIds = allDispatched.map((i) => i.id);
  await prisma.callInvoice.createMany({
    data: invoiceIds.map((id) => ({ callId: call.id, invoiceId: id })),
    skipDuplicates: true,
  });
  await prisma.invoice.updateMany({
    where: { id: { in: invoiceIds } },
    data: { status: "calling", attempts: { increment: 1 } },
  });

  // 2b. Create the outbound Ticket for this call (EnvoyIn-shaped work item, tagged
  //     "outbound"). The webhook flips it to Resolved and fills transcript/summary
  //     on the end-of-call report (see calls/webhook + lib/tickets getTicketByCallId).
  await createTicket(ownerId, {
    customerId: lead.customerId,
    callId: call.id,
    channel: "phone",
    status: "In Progress",
    title: `Outbound call — ${lead.contactBusiness}`,
    requester: lead.contactBusiness,
    tags: ["outbound"],
  });

  // 3. Dispatch via Vapi.
  console.log(`[dispatcher] dialing ${lead.contactBusiness} → ${toNumber} (call ${call.id})`);
  try {
    const vapiCall = await dispatchVapiCall({
      ownerId,
      toNumber,
      contactBusiness: lead.contactBusiness,
      contactPerson: lead.contactPerson ?? undefined,
      objective: lead.objective,
      voice,
      manner,
      userName: lead.userName,
      invoices: allInvoiceBlocks,
      bankName: lead.bankName ?? undefined,
      bsb: lead.bsb ?? undefined,
      accountNumber: lead.accountNumber ?? undefined,
      swiftCode: lead.swiftCode ?? undefined,
      abn: lead.abn ?? undefined,
      remittanceName: lead.remittanceName ?? undefined,
      remittanceContact: lead.remittanceContact ?? undefined,
      twilioPhoneNumber: cfg.twilioPhoneNumber,
      twilioAccountSid: cfg.twilioAccountSid,
      twilioAuthToken: cfg.twilioAuthToken,
      publicUrl: cfg.publicUrl,
      anthropicKey: cfg.anthropicKey,
      vapiPrivateKey: cfg.vapiPrivateKey,
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
    // Call never connected — unlink and return invoices to the queue for a later tick.
    await prisma.callInvoice.deleteMany({ where: { callId: call.id } });
    await prisma.invoice.updateMany({
      where: { id: { in: invoiceIds } },
      data: { status: "pending", chaseAfter: new Date(Date.now() + 60 * 60 * 1000) },
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

// One tick for a SINGLE tenant. All queries are scoped to `ownerId`, so each
// tenant's business hours, concurrency, and queue are honoured independently.
export async function runSchedulerTick(
  ownerId: string,
  opts: { ignoreBusinessHours?: boolean } = {}
): Promise<TickResult> {
  const settings = await getSettings(ownerId);
  if (!settings.schedulerOn) return { dispatched: 0, reason: "scheduler off" };
  if (!opts.ignoreBusinessHours && !isWithinBusinessHours(new Date(), settings)) {
    return { dispatched: 0, reason: "outside business hours" };
  }

  const slots = await freeCallSlots(ownerId);
  if (slots <= 0) return { dispatched: 0, reason: "no free call slots" };

  const eligible = await prisma.invoice.findMany({
    where: { ownerId, status: "pending", chaseAfter: { lte: new Date() } },
  });
  if (eligible.length === 0) return { dispatched: 0, reason: "no eligible invoices" };

  const groups = groupAndOrder(eligible, settings);
  let dispatched = 0;
  const errors: string[] = [];
  for (const group of groups) {
    if (dispatched >= slots) break;
    const res = await dispatchInvoiceGroup(ownerId, group);
    if (res.ok) dispatched++;
    else errors.push(res.error);
  }
  return { dispatched, errors: errors.length ? errors : undefined };
}

// One tick across ALL tenants that currently have pending, due invoices. This is what
// the on-demand cron endpoint (POST /api/cron/dispatch) and the local scheduler worker
// call — instead of an always-on per-tenant loop, we wake up, find who has work, and
// run each tenant's own tick. Serverless-friendly (nothing runs between invocations).
export async function runAllTenantsTick(
  opts: { ignoreBusinessHours?: boolean } = {}
): Promise<{ tenants: number; dispatched: number; perTenant: Record<string, TickResult> }> {
  const rows = await prisma.invoice.findMany({
    where: { status: "pending", chaseAfter: { lte: new Date() } },
    distinct: ["ownerId"],
    select: { ownerId: true },
  });
  const perTenant: Record<string, TickResult> = {};
  let dispatched = 0;
  for (const { ownerId } of rows) {
    const res = await runSchedulerTick(ownerId, opts);
    perTenant[ownerId] = res;
    dispatched += res.dispatched;
  }
  return { tenants: rows.length, dispatched, perTenant };
}
