/**
 * Twilio SMS follow-up after every call via the Twilio REST API (no SDK dependency).
 */

interface SmsCallData {
  id: string;
  contactBusiness: string;
  toNumber: string;
  userName: string;
  invoiceNumber: string | null;
  amountDue: number | null;
  currency: string | null;
  dueDate: string | null;
  bankName: string | null;
  bsb: string | null;
  accountNumber: string | null;
  swiftCode: string | null;
}

function fmtAmt(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null) return "";
  const c = (currency ?? "AUD").trim().toUpperCase();
  const formatted = amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return c === "AUD" || c === "" ? `$${formatted}` : `${c} ${formatted}`;
}

function buildPostCallSms(call: SmsCallData, outcome: string): string {
  const client = call.userName || "our client";
  const invoiceRef = call.invoiceNumber ? `invoice #${call.invoiceNumber}` : "an invoice";
  const amountStr = call.amountDue ? ` for ${fmtAmt(call.amountDue, call.currency)}` : "";
  const dueDateStr = call.dueDate ? ` due ${call.dueDate}` : "";
  const invoiceDetail = `${invoiceRef}${amountStr}${dueDateStr}`;

  const paymentParts = [
    call.bankName,
    call.bsb ? `BSB ${call.bsb}` : null,
    call.accountNumber ? `Acct ${call.accountNumber}` : null,
    call.swiftCode ? `SWIFT ${call.swiftCode}` : null,
  ].filter(Boolean);
  const paymentLine = paymentParts.length > 0 ? `\nPayment details: ${paymentParts.join(", ")}.` : "";

  switch (outcome) {
    case "success":
      return (
        `Hi, following up on our call today from ${client} regarding ${invoiceDetail}. ` +
        `As discussed, please arrange payment at your earliest convenience.${paymentLine} Thank you.`
      );
    case "partial":
      return (
        `Hi, ${client} followed up regarding ${invoiceDetail} today. ` +
        `Our call wasn't fully resolved — please get in touch to finalise.${paymentLine}`
      );
    case "failed":
      return (
        `Hi, ${client} tried to follow up regarding ${invoiceDetail} today but was unable to connect. ` +
        `Please get in touch at your earliest convenience.`
      );
    case "no-answer":
    default:
      return (
        `Hi, Envoy called on behalf of ${client} today regarding ${invoiceDetail}. ` +
        `Please contact ${client} or reply to arrange payment.`
      );
  }
}

export async function sendPostCallSms(call: SmsCallData, outcome: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.warn("[sms] missing Twilio credentials — skipping");
    return;
  }
  if (!call.toNumber) {
    console.warn("[sms] no toNumber on call — skipping");
    return;
  }

  const body = buildPostCallSms(call, outcome);
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const params = new URLSearchParams({ From: from, To: call.toNumber, Body: body });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio SMS ${res.status}: ${text.slice(0, 200)}`);
  }
  console.log("[sms] sent to", call.toNumber, "call", call.id, "outcome", outcome);
}
