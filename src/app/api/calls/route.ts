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
      contactName: c.contactName,
      toNumber: c.toNumber,
      objective: c.objective,
      status: c.status,
      outcome: c.outcome,
      result: c.result,
      summary: c.summary,
      durationSec: c.durationSec,
      transcript: c.transcript ? JSON.parse(c.transcript) : [],
      recordingUrl: c.recordingUrl,
      createdAt: c.createdAt,
    })),
  });
}
