import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { computeGroupKey, getSettings, normalisePhone } from "@/lib/dispatcher";

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
  const settings = await getSettings();
  const chaseAfter = computeChaseAfter(d.dueDate, settings.dueOffsetDays);
  const groupKey = computeGroupKey(d.abn, d.contactBusiness);

  try {
    const invoice = await prisma.invoice.create({
      data: {
        contactBusiness: d.contactBusiness,
        contactPerson: d.contactPerson,
        toNumber: d.toNumber ? normalisePhone(d.toNumber) : null,
        abn: d.abn,
        groupKey,
        userName: d.userName,
        voice: d.voice,
        manner: d.manner,
        objective: d.objective,
        invoiceNumber: d.invoiceNumber,
        invoiceDate: d.invoiceDate,
        dueDate: d.dueDate,
        amountDue: d.amountDue,
        currency: d.currency,
        lineItems: d.lineItems,
        invoiceNotes: d.invoiceNotes,
        bankName: d.bankName,
        bsb: d.bsb,
        accountNumber: d.accountNumber,
        swiftCode: d.swiftCode,
        remittanceName: d.remittanceName,
        remittanceContact: d.remittanceContact,
        chaseAfter,
        status: "pending",
      },
    });
    return NextResponse.json({ id: invoice.id, groupKey, chaseAfter });
  } catch (err) {
    console.error("[invoices] create failed:", err);
    return NextResponse.json({ error: "Failed to queue invoice" }, { status: 500 });
  }
}

// List queued invoices (for the Queue screen).
export async function GET() {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["pending", "queued", "calling"] } },
    orderBy: { chaseAfter: "asc" },
  });
  return NextResponse.json({ invoices });
}
