import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/dispatcher";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available in production" }, { status: 403 });
  }

  const settings = await getSettings();
  const lastCall = await prisma.call.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true, toNumber: true, outcome: true, status: true, createdAt: true },
  });

  return NextResponse.json({
    smsEnabled: settings.smsEnabled,
    credentials: {
      TWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
      TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER ?? null,
    },
    lastCall,
  });
}
