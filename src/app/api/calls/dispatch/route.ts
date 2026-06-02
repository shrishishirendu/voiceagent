import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { dispatchVapiCall } from "@/lib/vapi";

const MAX_ACTIVE_CALLS = Number(process.env.MAX_CONCURRENT_CALLS ?? "1");
const ACTIVE_STATUSES = ["dispatching", "ringing", "in-progress"];
const ACTIVE_CUTOFF_MS = 13 * 60 * 1000;

// Normalise a phone number to E.164 (Twilio requires the leading "+").
// Defaults to Australia (AU) so numbers can be entered without the "+",
// which Google Sheets otherwise treats as a formula.
//   +61412345678 → +61412345678   (already E.164, kept as-is)
//   61412345678  → +61412345678   (country code without +)
//   0412345678   → +61412345678   (AU national, leading 0 → +61)
//   any other    → +<digits>      (assume country code is present)
function normalisePhone(raw: string): string {
  const n = raw.trim().replace(/[ \-().]/g, "");
  if (n.startsWith("+")) return n;
  if (n.startsWith("0")) return "+61" + n.slice(1);
  if (n.startsWith("61")) return "+" + n;
  return "+" + n;
}

const BriefSchema = z.object({
  contactBusiness: z.string().min(1).max(120),
  contactPerson: z.string().max(120).optional(),
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
  bankName: z.string().optional(),
  bsb: z.string().optional(),
  accountNumber: z.string().optional(),
  swiftCode: z.string().optional(),
  abn: z.string().optional(),
  remittanceName: z.string().optional(),
  remittanceContact: z.string().optional(),
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
    contactBusiness,
    contactPerson,
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
    bankName,
    bsb,
    accountNumber,
    swiftCode,
    abn,
    remittanceName,
    remittanceContact,
  } = parsed.data;
  const normalisedNumber = normalisePhone(toNumber);

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

  // Gate: reject if too many calls are already active.
  // Self-heal truly abandoned calls (beyond Vapi's maxDurationSeconds:600 + 5 min grace).
  // The poll route handles in-flight calls via Vapi probe; this only clears rows that
  // were never polled (e.g. leftover from a prior session with no active client).
  const STALE_MS = 15 * 60 * 1000;
  await prisma.call.updateMany({
    where: {
      status: { in: ["dispatching", "ringing", "in-progress"] },
      createdAt: { lte: new Date(Date.now() - STALE_MS) },
    },
    data: { status: "failed", endedReason: "abandoned-no-response", outcome: "failed" },
  });

  const activeCount = await prisma.call.count({
    where: {
      status: { in: ACTIVE_STATUSES },
      createdAt: { gte: new Date(Date.now() - ACTIVE_CUTOFF_MS) },
    },
  });
  if (activeCount >= MAX_ACTIVE_CALLS) {
    return NextResponse.json(
      { error: "Too many calls in progress. Try again shortly.", retryable: true },
      { status: 429 }
    );
  }

  // 1. Save the brief to DB first, so we have a row even if Vapi fails
  let call;
  try {
    call = await prisma.call.create({
      data: {
        contactBusiness,
        contactPerson,
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
        bankName,
        bsb,
        accountNumber,
        swiftCode,
        abn,
        remittanceName,
        remittanceContact,
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
      contactBusiness,
      contactPerson,
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
      bankName,
      bsb,
      accountNumber,
      swiftCode,
      abn,
      remittanceName,
      remittanceContact,
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
