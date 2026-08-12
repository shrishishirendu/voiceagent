import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { freeCallSlots, dispatchInvoiceGroup } from "@/lib/dispatcher";
import { resolveAccess, hasRole, unauthorized, forbidden } from "@/lib/access";

const BodySchema = z
  .object({
    groupKey: z.string().min(1).optional(),
    // Dispatch one specific invoice now, regardless of its chaseAfter schedule.
    invoiceId: z.string().uuid().optional(),
    // Number to dial for THIS call only — never persisted (see resolveDialNumber).
    toNumber: z.string().max(40).optional(),
  })
  .refine((b) => !!b.groupKey || !!b.invoiceId, { message: "groupKey or invoiceId required" });

/**
 * Dispatch immediately (manual, bypasses the business-hours gate). Two modes:
 *
 *  - `groupKey`  — every *pending* invoice of that debtor whose chaseAfter has come due.
 *                  This is the original behaviour and is what the queue's per-group
 *                  Dispatch button uses; the scheduler's own sweep is separate
 *                  (runSchedulerTick in lib/dispatcher.ts) and untouched by this route.
 *  - `invoiceId` — one specific stored/pending invoice, WITHOUT the chaseAfter gate.
 *                  An explicit "dispatch now" click is itself the schedule; requiring
 *                  chaseAfter <= now here made manual dispatch a silent no-op for any
 *                  invoice not yet due.
 *
 * Returns the same { dispatched, reason?, errors? } shape as /api/scheduler/tick.
 */
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

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "groupKey or invoiceId required" }, { status: 400 });
  }

  const { groupKey, invoiceId, toNumber } = parsed.data;

  const slots = await freeCallSlots(ownerId);
  if (slots <= 0) {
    return NextResponse.json({ dispatched: 0, reason: "no free call slots" });
  }

  let eligible;
  if (invoiceId) {
    // Single explicit invoice. `ownerId` in the where clause is the IDOR guard — never
    // look this up by id alone. No chaseAfter filter: the click IS the schedule.
    const one = await prisma.invoice.findFirst({
      where: { id: invoiceId, ownerId, status: { in: ["stored", "pending"] } },
    });
    if (!one) {
      return NextResponse.json({ dispatched: 0, reason: "invoice not found or not dispatchable" });
    }
    eligible = [one];
  } else {
    eligible = await prisma.invoice.findMany({
      where: { ownerId, status: "pending", groupKey, chaseAfter: { lte: new Date() } },
    });
    if (eligible.length === 0) {
      return NextResponse.json({ dispatched: 0, reason: "no eligible invoices for this group" });
    }
  }

  const result = await dispatchInvoiceGroup(ownerId, eligible, { toNumberOverride: toNumber ?? null });
  if (result.ok) {
    return NextResponse.json({ dispatched: 1, callId: result.callId });
  }
  return NextResponse.json({ dispatched: 0, errors: [result.error] });
}
