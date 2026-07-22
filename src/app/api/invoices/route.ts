import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { computeGroupKey, getSettings, normalisePhone, syncCallFromVapi, resolveCustomerId, parseLineItemRows, serializeLineItems } from "@/lib/dispatcher";
import { companyNamesMatch } from "@/lib/nameUtils";
import { resolveAccess, hasRole, unauthorized, forbidden, trimInvoiceForAccess } from "@/lib/access";

/**
 * Enqueue a parsed invoice for scheduled chasing.
 *
 * Instead of dialing immediately (see /api/calls/dispatch), this creates an
 * Invoice row with status "pending". The scheduler worker later groups pending
 * invoices by debtor and dispatches one call per debtor within business hours.
 */

// Mirrors buildBulkBrief() on the client and BriefSchema on the dispatch route.
const InvoiceSchema = z.object({
  contactBusiness: z.string().min(1).max(120),
  contactPerson: z.string().max(120).optional(),
  toNumber: z.string().max(20).optional(),
  objective: z.string().min(10).max(2000),
  voice: z.enum(["iris", "arjun", "theo"]).default("iris"),
  manner: z.enum(["warm", "crisp", "formal"]).default("warm"),
  userName: z.string().min(1).max(60).default("the caller"),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  amountDue: z.number().optional(),
  currency: z.string().optional(),
  lineItems: z.string().optional(),
  invoiceNotes: z.string().optional(),
  bankName: z.string().optional(),
  bsb: z.string().optional(),
  accountNumber: z.string().optional(),
  swiftCode: z.string().optional(),
  abn: z.string().optional(),
  remittanceName: z.string().optional(),
  remittanceContact: z.string().optional(),
  sourceFilePath: z.string().optional(),
});

// chaseAfter = dueDate + offsetDays (00:00 recipient-naive). No/invalid dueDate ⇒
// eligible immediately (chaseAfter = now).
function computeChaseAfter(dueDate: string | undefined, offsetDays: number): Date {
  if (!dueDate) return new Date();
  const d = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return new Date();
  d.setDate(d.getDate() + offsetDays);
  return d;
}

export async function POST(req: NextRequest) {
  const access = await resolveAccess();
  if (!access) return unauthorized();
  if (!hasRole(access, "agent")) return forbidden();
  const ownerId = access.ownerId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = InvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid invoice", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const settings = await getSettings(ownerId);
  const chaseAfter = computeChaseAfter(d.dueDate, settings.dueOffsetDays);
  const groupKey = computeGroupKey(d.abn, d.contactBusiness);

  try {
    // Read (fuzzy group-key resolution + dup check) and write happen in one transaction
    // so concurrent creates for the same business (e.g. a bulk upload firing requests
    // in quick succession) can't each read a pre-commit state that's missing the other's
    // not-yet-committed row — without this, two invoices for the same company can end up
    // with different groupKeys instead of collapsing into one debtor group.
    const result = await prisma.$transaction(async (tx) => {
      const activeInvoices = await tx.invoice.findMany({
        where: { ownerId, status: { in: ["pending", "queued", "calling"] } },
        select: { groupKey: true, contactBusiness: true },
      });
      const matchedGroup = activeInvoices.find((i) =>
        companyNamesMatch(i.contactBusiness, d.contactBusiness)
      );
      const resolvedGroupKey = matchedGroup?.groupKey ?? groupKey;

      // Idempotent: if an active invoice with the same number already exists for this debtor, return it.
      if (d.invoiceNumber) {
        const dup = await tx.invoice.findFirst({
          where: { ownerId, groupKey: resolvedGroupKey, invoiceNumber: d.invoiceNumber, status: { in: ["pending", "queued", "calling"] } },
        });
        if (dup) {
          return { duplicate: true as const, id: dup.id, groupKey: resolvedGroupKey, chaseAfter: dup.chaseAfter };
        }
      }

      const normalisedPhone = d.toNumber ? normalisePhone(d.toNumber) : null;
      const customerId = await resolveCustomerId(tx, {
        ownerId,
        abn: d.abn,
        businessName: d.contactBusiness,
        contactPerson: d.contactPerson,
        phone: normalisedPhone,
      });

      const invoice = await tx.invoice.create({
        data: {
          ownerId,
          customerId,
          contactBusiness: d.contactBusiness,
          contactPerson: d.contactPerson,
          toNumber: normalisedPhone,
          abn: d.abn,
          groupKey: resolvedGroupKey,
          userName: d.userName,
          voice: d.voice,
          manner: d.manner,
          objective: d.objective,
          invoiceNumber: d.invoiceNumber,
          invoiceDate: d.invoiceDate,
          dueDate: d.dueDate,
          amountDue: d.amountDue,
          totalAmount: d.amountDue,
          currency: d.currency,
          invoiceNotes: d.invoiceNotes,
          bankName: d.bankName,
          bsb: d.bsb,
          accountNumber: d.accountNumber,
          swiftCode: d.swiftCode,
          remittanceName: d.remittanceName,
          remittanceContact: d.remittanceContact,
          sourceFilePath: d.sourceFilePath,
          chaseAfter,
          status: "pending",
        },
      });

      // Line items live in their own table.
      const rows = parseLineItemRows(d.lineItems);
      if (rows.length > 0) {
        await tx.invoiceLineItem.createMany({
          data: rows.map((r) => ({ ...r, invoiceId: invoice.id })),
        });
      }

      return { duplicate: false as const, id: invoice.id, groupKey: resolvedGroupKey, chaseAfter };
    });

    return NextResponse.json(
      result.duplicate
        ? { id: result.id, groupKey: result.groupKey, chaseAfter: result.chaseAfter, duplicate: true }
        : { id: result.id, groupKey: result.groupKey, chaseAfter: result.chaseAfter }
    );
  } catch (err) {
    console.error("[invoices] create failed:", err);
    return NextResponse.json({ error: "Failed to queue invoice" }, { status: 500 });
  }
}

// Cancel all queued invoices (the "Clear queue" action).
// Also cancels "calling" invoices whose call is already terminal — these are stuck due to missed webhooks.
export async function DELETE() {
  const access = await resolveAccess();
  if (!access) return unauthorized();
  if (!hasRole(access, "agent")) return forbidden();
  const ownerId = access.ownerId;

  await prisma.invoice.updateMany({
    where: { ownerId, status: { in: ["pending", "queued"] } },
    data: { status: "cancelled" },
  });

  // Find calling invoices whose most recent linked call already reached a terminal state.
  const stuckCalling = await prisma.invoice.findMany({
    where: { ownerId, status: "calling" },
    include: { callLinks: { include: { call: { select: { status: true } } }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const stuckIds = stuckCalling
    .filter((i) => {
      const s = i.callLinks[0]?.call?.status;
      return s === "completed" || s === "failed";
    })
    .map((i) => i.id);
  if (stuckIds.length > 0) {
    await prisma.invoice.updateMany({
      where: { id: { in: stuckIds } },
      data: { status: "cancelled" },
    });
  }

  return NextResponse.json({ ok: true });
}

// List queued invoices (for the Queue screen).
// Also includes resolved/failed invoices updated today so transcript links remain visible.
export async function GET() {
  const access = await resolveAccess();
  if (!access) return unauthorized();
  const ownerId = access.ownerId;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const findArgs = {
    where: {
      ownerId,
      OR: [
        { status: { in: ["pending", "queued", "calling"] } },
        { status: { in: ["resolved", "failed"] }, updatedAt: { gte: startOfToday } },
      ],
    },
    orderBy: { chaseAfter: "asc" as const },
    include: {
      lineItems: true,
      // Most recent linked call (call_invoice join) → the queue's "call" summary.
      callLinks: {
        include: { call: { select: { id: true, status: true, outcome: true, vapiCallId: true, createdAt: true } } },
        orderBy: { createdAt: "desc" as const },
        take: 1,
      },
    },
  };

  const invoices = await prisma.invoice.findMany(findArgs);

  // Reshape each row back into the queue's expected JSON: flat scalar fields, the
  // line items re-serialised to a JSON string, and a single `call` summary object.
  const serialize = (inv: (typeof invoices)[number]) => {
    const { lineItems, callLinks, ...rest } = inv;
    // Trim banking/remittance fields for viewer/agent roles (Phase 3-C).
    return trimInvoiceForAccess({ ...rest, lineItems: serializeLineItems(lineItems), call: callLinks[0]?.call ?? null }, access);
  };

  // Self-heal any non-terminal linked call directly from Vapi (mirrors the Live
  // screen's poll) so the Queue screen doesn't show a stale status when the
  // end-of-call-report webhook is missed or delayed. One probe per distinct call,
  // not per invoice — an aggregated call is linked to many invoice rows.
  const staleCallIds = Array.from(
    new Set(
      invoices
        .map((i) => i.callLinks[0]?.call)
        .filter((c): c is NonNullable<typeof c> => !!c && !!c.vapiCallId && c.status !== "completed" && c.status !== "failed")
        .map((c) => c.id)
    )
  );

  if (staleCallIds.length > 0) {
    const staleCalls = await prisma.call.findMany({ where: { id: { in: staleCallIds } } });
    await Promise.all(staleCalls.map((c) => syncCallFromVapi(c)));
    const refreshed = await prisma.invoice.findMany(findArgs);
    return NextResponse.json({ invoices: refreshed.map(serialize) });
  }

  return NextResponse.json({ invoices: invoices.map(serialize) });
}
