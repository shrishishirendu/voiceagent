import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { freeCallSlots, dispatchInvoiceGroup } from "@/lib/dispatcher";

const BodySchema = z.object({ groupKey: z.string().min(1) });

/**
 * Dispatch a single debtor group immediately (manual, bypasses business-hours gate).
 * Returns the same { dispatched, reason?, errors? } shape as /api/scheduler/tick.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "groupKey required" }, { status: 400 });
  }

  const { groupKey } = parsed.data;

  const slots = await freeCallSlots();
  if (slots <= 0) {
    return NextResponse.json({ dispatched: 0, reason: "no free call slots" });
  }

  const eligible = await prisma.invoice.findMany({
    where: { status: "pending", groupKey, chaseAfter: { lte: new Date() } },
  });

  if (eligible.length === 0) {
    return NextResponse.json({ dispatched: 0, reason: "no eligible invoices for this group" });
  }

  const result = await dispatchInvoiceGroup(eligible);
  if (result.ok) {
    return NextResponse.json({ dispatched: 1, callId: result.callId });
  }
  return NextResponse.json({ dispatched: 0, errors: [result.error] });
}
