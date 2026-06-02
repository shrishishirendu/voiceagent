import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const calls = await prisma.call.findMany({
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
      transcript: (() => { try { return c.transcript ? JSON.parse(c.transcript) : []; } catch { return []; } })(),
      recordingUrl: c.recordingUrl,
      endedReason: c.endedReason ?? null,
      invoiceNumber: c.invoiceNumber ?? null,
      createdAt: c.createdAt,
    })),
  });
}
