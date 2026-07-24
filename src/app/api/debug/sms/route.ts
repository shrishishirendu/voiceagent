import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/dispatcher";
import { resolveAccess, unauthorized } from "@/lib/access";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available in production" }, { status: 403 });
  }

  const access = await resolveAccess();
  if (!access) return unauthorized();

  const settings = await getSettings(access.ownerId);
  const lastCall = await prisma.call.findFirst({
    where: { ownerId: access.ownerId },
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
