import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { dispatchVapiCall } from "@/lib/vapi";

const BriefSchema = z.object({
  contactName: z.string().min(1).max(120),
  toNumber: z.string().min(6).max(20).regex(/^\+?[0-9 \-()]+$/, "Must be a phone number"),
  objective: z.string().min(10).max(2000),
  voice: z.enum(["marcus", "iris", "theo"]).default("marcus"),
  manner: z.enum(["warm", "crisp", "formal"]).default("warm"),
  userName: z.string().min(1).max(60).default("the caller"),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  amountDue: z.number().optional(),
  currency: z.string().optional(),
  lineItems: z.string().optional(),
  invoiceNotes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BriefSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid brief", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const {
    contactName,
    toNumber,
    objective,
    voice,
    manner,
    userName,
    invoiceNumber,
    invoiceDate,
    dueDate,
    amountDue,
    currency,
    lineItems,
    invoiceNotes,
  } = parsed.data;
  const normalisedNumber = toNumber.replace(/[ \-()]/g, "");

  // Required env
  const missing: string[] = [];
  if (!process.env.VAPI_PRIVATE_KEY) missing.push("VAPI_PRIVATE_KEY");
  if (!process.env.TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
  if (!process.env.TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
  if (!process.env.TWILIO_PHONE_NUMBER) missing.push("TWILIO_PHONE_NUMBER");
  if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (!process.env.PUBLIC_URL) missing.push("PUBLIC_URL");
  if (missing.length) {
    console.error("[dispatch] missing env vars:", missing.join(", "));
    return NextResponse.json(
      { error: "Server configuration error. Contact the administrator." },
      { status: 500 }
    );
  }

  // 1. Save the brief to DB first, so we have a row even if Vapi fails
  let call;
  try {
    call = await prisma.call.create({
      data: {
        contactName,
        toNumber: normalisedNumber,
        objective,
        voice,
        manner,
        invoiceNumber,
        invoiceDate,
        dueDate,
        amountDue,
        currency,
        lineItems,
        invoiceNotes,
        status: "dispatching",
      },
    });
  } catch (err) {
    console.error("[dispatch] failed to create call record:", err);
    return NextResponse.json({ error: "Failed to create call record" }, { status: 500 });
  }

  // 2. Dispatch via Vapi
  try {
    const vapiCall = await dispatchVapiCall({
      toNumber: normalisedNumber,
      contactName,
      objective,
      voice,
      manner,
      userName,
      invoiceNumber,
      invoiceDate,
      dueDate,
      amountDue,
      currency,
      lineItems,
      invoiceNotes,
      twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER!,
      twilioAccountSid: process.env.TWILIO_ACCOUNT_SID!,
      twilioAuthToken: process.env.TWILIO_AUTH_TOKEN!,
      publicUrl: process.env.PUBLIC_URL!,
      anthropicKey: process.env.ANTHROPIC_API_KEY!,
    });

    await prisma.call.update({
      where: { id: call.id },
      data: { vapiCallId: vapiCall.id, status: "ringing" },
    });

    return NextResponse.json({
      id: call.id,
      vapiCallId: vapiCall.id,
      status: "ringing",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await prisma.call.update({
      where: { id: call.id },
      data: { status: "failed", endedReason: msg.slice(0, 500) },
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
