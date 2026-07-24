import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncCallFromVapi } from "@/lib/dispatcher";
import { resolveAccess, unauthorized } from "@/lib/access";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await resolveAccess();
  if (!access) return unauthorized();

  // Filter by both id AND ownerId — the IDOR guard.
  let call = await prisma.call.findFirst({ where: { id: params.id, ownerId: access.ownerId } });
  if (!call) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // If the call hasn't reached a terminal state, probe Vapi directly and self-heal
  // (also used by the Queue screen's poll — see /api/invoices).
  const synced = await syncCallFromVapi(call);
  call = synced.call;
  const pollError = synced.pollError;

  // Invoices aggregated into this call (via the call_invoice join; empty for
  // manual single-invoice / non-invoice calls).
  const links = await prisma.callInvoice.findMany({
    where: { callId: call.id },
    select: { invoiceId: true },
  });
  const linkedInvoices = await prisma.invoice.findMany({
    where: { id: { in: links.map((l) => l.invoiceId) }, ownerId: access.ownerId },
    orderBy: { dueDate: "asc" },
  });

  return NextResponse.json({
    id: call.id,
    contactBusiness: call.contactBusiness,
    toNumber: call.toNumber,
    objective: call.objective,
    status: call.status,
    outcome: call.outcome,
    result: call.result,
    summary: call.summary,
    durationSec: call.durationSec,
    transcript: Array.isArray(call.transcript) ? call.transcript : [],
    recordingUrl: call.recordingUrl,
    endedReason: call.endedReason,
    voicemailScript: call.voicemailScript ?? null,
    invoiceNumber: call.invoiceNumber ?? null,
    amountDue: call.amountDue ?? null,
    currency: call.currency ?? null,
    invoices: linkedInvoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate,
      dueDate: i.dueDate,
      amountDue: i.amountDue,
      currency: i.currency,
      status: i.status,
    })),
    createdAt: call.createdAt,
    pollError,
  }, { headers: { "Cache-Control": "no-store" } });
}
