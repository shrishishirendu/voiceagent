import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAccess, unauthorized } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await resolveAccess();
  if (!access) return unauthorized();

  const calls = await prisma.call.findMany({
    where: { ownerId: access.ownerId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    calls: calls.map((c) => ({
      id: c.id,
      contactBusiness: c.contactBusiness,
      toNumber: c.toNumber,
      objective: c.objective,
      status: c.status,
      outcome: c.outcome,
      result: c.result,
      summary: c.summary,
      durationSec: c.durationSec,
      transcript: Array.isArray(c.transcript) ? c.transcript : [],
      recordingUrl: c.recordingUrl,
      endedReason: c.endedReason ?? null,
      voicemailScript: c.voicemailScript ?? null,
      invoiceNumber: c.invoiceNumber ?? null,
      createdAt: c.createdAt,
    })),
  });
}
