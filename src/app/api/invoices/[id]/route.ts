import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { computeGroupKey, getSettings, normalisePhone, parseLineItemRows } from "@/lib/dispatcher";

const PatchSchema = z.object({
  contactBusiness: z.string().min(1).max(120).optional(),
  contactPerson: z.string().max(120).nullish(),
  toNumber: z.string().max(20).nullish(),
  abn: z.string().max(20).nullish(),
  invoiceNumber: z.string().max(60).nullish(),
  invoiceDate: z.string().max(20).nullish(),
  dueDate: z.string().max(20).nullish(),
  amountDue: z.number().nullish(),
  currency: z.string().max(10).nullish(),
  lineItems: z.string().nullish(),
  invoiceNotes: z.string().nullish(),
  bankName: z.string().max(120).nullish(),
  bsb: z.string().max(10).nullish(),
  accountNumber: z.string().max(30).nullish(),
  swiftCode: z.string().max(20).nullish(),
  remittanceName: z.string().max(120).nullish(),
  remittanceContact: z.string().max(120).nullish(),
  status: z.enum(["pending"]).optional(),
  chaseAfter: z.string().datetime().optional(),
});

function computeChaseAfter(dueDate: string | null | undefined, offsetDays: number): Date {
  if (!dueDate) return new Date();
  const d = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return new Date();
  d.setDate(d.getDate() + offsetDays);
  return d;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid fields", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = parsed.data;

  // Re-derive groupKey if business identity fields changed.
  const newAbn = d.abn !== undefined ? d.abn : existing.abn;
  const newBusiness = d.contactBusiness ?? existing.contactBusiness;
  const groupKey = computeGroupKey(newAbn ?? undefined, newBusiness);

  // Re-derive chaseAfter if dueDate changed, or use explicit override (e.g. manual retry).
  let chaseAfter = existing.chaseAfter;
  if (d.chaseAfter !== undefined) {
    chaseAfter = new Date(d.chaseAfter);
  } else if (d.dueDate !== undefined) {
    const settings = await getSettings();
    chaseAfter = computeChaseAfter(d.dueDate, settings.dueOffsetDays);
  }

  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      ...(d.contactBusiness !== undefined && { contactBusiness: d.contactBusiness }),
      ...(d.contactPerson !== undefined && { contactPerson: d.contactPerson }),
      ...(d.toNumber !== undefined && { toNumber: d.toNumber ? normalisePhone(d.toNumber) : null }),
      ...(d.abn !== undefined && { abn: d.abn }),
      groupKey,
      chaseAfter,
      ...(d.invoiceNumber !== undefined && { invoiceNumber: d.invoiceNumber }),
      ...(d.invoiceDate !== undefined && { invoiceDate: d.invoiceDate }),
      ...(d.dueDate !== undefined && { dueDate: d.dueDate }),
      ...(d.amountDue !== undefined && { amountDue: d.amountDue, totalAmount: d.amountDue }),
      ...(d.currency !== undefined && { currency: d.currency }),
      ...(d.invoiceNotes !== undefined && { invoiceNotes: d.invoiceNotes }),
      ...(d.bankName !== undefined && { bankName: d.bankName }),
      ...(d.bsb !== undefined && { bsb: d.bsb }),
      ...(d.accountNumber !== undefined && { accountNumber: d.accountNumber }),
      ...(d.swiftCode !== undefined && { swiftCode: d.swiftCode }),
      ...(d.remittanceName !== undefined && { remittanceName: d.remittanceName }),
      ...(d.remittanceContact !== undefined && { remittanceContact: d.remittanceContact }),
      ...(d.status !== undefined && { status: d.status }),
    },
  });

  // Line items live in their own table — replace them wholesale when edited.
  if (d.lineItems !== undefined) {
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
    const rows = parseLineItemRows(d.lineItems);
    if (rows.length > 0) {
      await prisma.invoiceLineItem.createMany({ data: rows.map((r) => ({ ...r, invoiceId: id })) });
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;

  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.invoice.update({
    where: { id },
    data: { status: "cancelled" },
  });

  return NextResponse.json({ ok: true });
}
