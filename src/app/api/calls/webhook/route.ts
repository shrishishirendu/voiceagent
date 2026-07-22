import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MAX_INVOICE_ATTEMPTS, getSettings, backfillCustomerFromCall } from "@/lib/dispatcher";
import { getTicketByCallId, updateTicket } from "@/lib/tickets";
import { sendPostCallSms } from "@/lib/sms";

/**
 * Vapi webhook receiver.
 *
 * Vapi fires several event types during a call:
 *   - "status-update"      → ringing | in-progress | ended
 *   - "end-of-call-report" → final transcript, summary, recording URL
 *   - "transcript"         → live partial transcripts (we ignore these here)
 *   - "function-call"      → tool calls (not used yet)
 *
 * We mostly care about "end-of-call-report" — that's where the gold is.
 *
 * Docs: https://docs.vapi.ai/server-url/events
 */

interface VapiMessage {
  type: string;
  call?: { id: string; status?: string };
  status?: string;
  endedReason?: string;
  summary?: string;
  transcript?: string;
  messages?: Array<{ role: string; message?: string; content?: string }>;
  recordingUrl?: string;
  durationSeconds?: number;
  artifact?: {
    transcript?: string;
    messages?: Array<{ role: string; message?: string; content?: string }>;
    recordingUrl?: string;
  };
  analysis?: {
    summary?: string;
    successEvaluation?: string;
  };
}


const STATUS_RANK: Record<string, number> = {
  dispatching: 0, queued: 1, ringing: 2, "in-progress": 3, completed: 4, failed: 4,
};

function deriveOutcome(endedReason?: string, successEval?: string): string {
  // Check endedReason first: a voicemail call can still report a truthy successEvaluation
  // (Envoy "succeeded" at leaving a message), so classify connectivity outcomes before
  // trusting the success evaluation.
  const r = (endedReason ?? "").toLowerCase();
  if (r.includes("no-answer") || r.includes("voicemail") || r.includes("busy") || r.includes("machine")) return "no-answer";
  if (successEval) {
    const s = successEval.toLowerCase();
    if (s.includes("success") || s === "true" || s === "pass") return "success";
    if (s.includes("partial")) return "partial";
    if (s.includes("fail") || s === "false") return "failed";
  }
  if (!endedReason) return "success";
  if (r.includes("error") || r.includes("failed")) return "failed";
  return "success";
}

// Returns a plain array for the Call.transcript jsonb column.
function formatTranscript(messages?: VapiMessage["messages"]): { who: string; text: string }[] {
  if (!messages || messages.length === 0) return [];
  return messages
    .filter((m) => m.role === "assistant" || m.role === "user" || m.role === "bot")
    .map((m) => ({
      who: m.role === "user" ? "them" : "envoy",
      text: m.message ?? m.content ?? "",
    }))
    .filter((m) => m.text.length > 0);
}

export async function POST(req: NextRequest) {
  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // Full payload dump — remove once webhook processing is confirmed working
  console.log("[webhook] raw:", JSON.stringify(rawBody).slice(0, 800));

  // Vapi sends events either wrapped as { message: {...} } or as the event object at the root.
  // Handle both formats so the handler works regardless of which Vapi uses.
  const msg = (rawBody?.message ?? rawBody) as VapiMessage;
  console.log("[webhook] type=%s callId=%s", msg?.type ?? "(none)", msg?.call?.id ?? "(none)");

  if (!msg?.call?.id) {
    console.log("[webhook] ignored – no call id. Root keys:", Object.keys(rawBody ?? {}));
    return NextResponse.json({ ok: true, ignored: "no call id" });
  }

  const vapiCallId = msg.call.id;

  // Tenant carried in the webhook URL (?owner=<ownerId>) by vapi.ts — used only to
  // scope the unbound-call fallback below so an early event can't bind to another
  // tenant's in-flight call. The authoritative tenant is call.ownerId once matched.
  const ownerHint = req.nextUrl.searchParams.get("owner");

  // Find our local call record
  let call;
  try {
    call = await prisma.call.findUnique({ where: { vapiCallId } });
    // Race: vapiCallId may arrive before the dispatch route writes it.
    // Attempt to bind this event to the most recent unbound in-flight call (within 2 min).
    // Safe under MAX_CONCURRENT_CALLS=1 per tenant — at most one unbound call at a time.
    if (!call) {
      const candidate = await prisma.call.findFirst({
        where: {
          ...(ownerHint ? { ownerId: ownerHint } : {}),
          vapiCallId: null,
          status: { in: ["dispatching", "ringing"] },
          createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
      });
      if (candidate) {
        call = await prisma.call.update({
          where: { id: candidate.id },
          data: { vapiCallId },
        }).catch(() => null);
        if (!call) call = await prisma.call.findUnique({ where: { vapiCallId } });
      }
    }
  } catch (err) {
    console.error("[webhook] findUnique failed", err);
    return NextResponse.json({ ok: false, error: "db error" }, { status: 500 });
  }
  if (!call) {
    console.log("[webhook] call not found for vapiCallId:", vapiCallId);
    return NextResponse.json({ ok: true, ignored: "call not found yet" });
  }

  switch (msg.type) {
    case "status-update": {
      const rawStatus = msg.status ?? msg.call?.status;
      // Skip if no status field, or if "ended" (transitional state before end-of-call-report).
      if (!rawStatus || rawStatus === "ended") break;
      // Only advance — never regress to an earlier state (e.g. "queued" after "ringing").
      const currentRank = STATUS_RANK[call.status] ?? -1;
      const newRank = STATUS_RANK[rawStatus] ?? -1;
      if (newRank <= currentRank) break;
      try {
        await prisma.call.update({
          where: { id: call.id },
          data: { status: rawStatus },
        });
      } catch (err) {
        console.error("[webhook] status-update DB write failed", err);
        return NextResponse.json({ ok: false, error: "db error" }, { status: 500 });
      }
      break;
    }

    case "end-of-call-report": {
      const transcript = formatTranscript(msg.artifact?.messages ?? msg.messages);
      const endedReason = msg.endedReason ?? null;

      // Detect voicemail from endedReason OR from transcript content (Google Voice / audio-message
      // systems often don't trigger Vapi's machine detection, so we also scan what the other party said).
      const rawMessages = msg.artifact?.messages ?? msg.messages ?? [];
      const VOICEMAIL_RE = /audio message|leave a message|leave your message|not available|unavailable|voicemail|answering machine|at the tone|after the beep|record your message|send a message/i;
      const transcriptHasVoicemail = rawMessages.some(
        (m) => m.role === "user" && VOICEMAIL_RE.test(m.message ?? m.content ?? "")
      );
      const isVoicemailDetected = !!(endedReason && /voicemail|machine/i.test(endedReason)) || transcriptHasVoicemail;

      // For voicemail calls, discard the analysisPlan summary — it reads "As an audio message"
      // as if the contact said it, producing misleading text. Use our own description instead.
      const rawSummary = isVoicemailDetected
        ? null
        : (msg.analysis?.summary ?? msg.summary ?? null);
      const summary = rawSummary ??
        (isVoicemailDetected
          ? `Envoy placed a call to ${call.contactBusiness} but the contact didn't pick up and the call was redirected to voicemail. A message was left. Expecting a call back or will follow up.`
          : null);

      const recordingUrl = msg.artifact?.recordingUrl ?? msg.recordingUrl ?? null;
      const durationSec = msg.durationSeconds ?? null;
      // For transcript-detected voicemail, override outcome to "no-answer" (endedReason may say
      // "silence-timed-out" or similar which would otherwise produce "failed" or "success").
      const outcome = isVoicemailDetected
        ? "no-answer"
        : deriveOutcome(endedReason ?? undefined, msg.analysis?.successEvaluation);

      if (isVoicemailDetected) {
        console.log(
          "[webhook] voicemail – endedReason=%s messages=%d vapiDetected=%s voicemailScript=%s",
          endedReason ?? "(none)",
          rawMessages.length,
          !!(endedReason && /voicemail|machine/i.test(endedReason)),
          call.voicemailScript ? "present" : "absent"
        );
      }

      // Try to extract a one-line "result" from the summary
      const result = summary
        ? summary.split(/[.\n]/).find((s) => s.trim().length > 10)?.trim() ?? null
        : null;

      try {
        await prisma.call.update({
          where: { id: call.id },
          data: {
            status: "completed",
            outcome,
            summary,
            transcript,
            recordingUrl,
            durationSec,
            endedReason,
            result,
          },
        });
      } catch (err) {
        console.error("[webhook] end-of-call-report DB write failed", err);
        return NextResponse.json({ ok: false, error: "db error" }, { status: 500 });
      }

      // Load settings once for retry delay, SMS flag, and auto-retry toggle.
      let retryDelayHours = 24;
      let smsEnabled = false;
      let autoRetry = true;
      try {
        const settings = await getSettings(call.ownerId);
        retryDelayHours = settings.retryDelayHours ?? 24;
        smsEnabled = settings.smsEnabled ?? false;
        autoRetry = settings.autoRetry ?? true;
      } catch {
        // keep defaults
      }

      // Resolve or requeue any invoices aggregated into this call. A reached contact
      // (success/partial) settles them; no-answer/failed requeues under the attempt cap
      // (chaseAfter = configurable retryDelayHours out; the business-hours gate still applies).
      // When autoRetry is off, failed/no-answer invoices are marked failed immediately instead.
      try {
        const links = await prisma.callInvoice.findMany({
          where: { callId: call.id },
          select: { invoiceId: true },
        });
        const linkedIds = links.map((l) => l.invoiceId);
        if (outcome === "success" || outcome === "partial") {
          await prisma.invoice.updateMany({
            where: { id: { in: linkedIds }, ownerId: call.ownerId, status: "calling" },
            data: { status: "resolved" },
          });
        } else {
          const linked = await prisma.invoice.findMany({ where: { id: { in: linkedIds }, ownerId: call.ownerId, status: "calling" } });
          for (const inv of linked) {
            if (!autoRetry || inv.attempts >= MAX_INVOICE_ATTEMPTS) {
              await prisma.invoice.update({ where: { id: inv.id }, data: { status: "failed" } });
            } else {
              await prisma.invoice.update({
                where: { id: inv.id },
                data: {
                  status: "pending",
                  chaseAfter: new Date(Date.now() + retryDelayHours * 60 * 60 * 1000),
                },
              });
            }
          }
        }
      } catch (err) {
        console.error("[webhook] invoice resolution failed", err);
      }

      // Update the outbound Ticket linked to this call (1D): a reached contact resolves
      // it, otherwise it stays In Progress. Also stamp transcript/summary onto the ticket.
      try {
        const ticket = await getTicketByCallId(call.ownerId, call.id);
        if (ticket) {
          const ticketStatus = outcome === "success" || outcome === "partial" ? "Resolved" : "In Progress";
          await updateTicket(call.ownerId, ticket.id, {
            status: ticketStatus,
            transcript,
            aiSummary: summary,
          });
        }
      } catch (err) {
        console.error("[webhook] ticket update failed", err);
      }

      // Backfill the debtor Customer with any corrected contact facts learned on the
      // call (1E) — owner-scoped, best-effort.
      try {
        await backfillCustomerFromCall(call.ownerId, call.id);
      } catch (err) {
        console.error("[webhook] customer backfill failed", err);
      }

      // SMS follow-up — fire and forget; never let SMS failure affect webhook response.
      console.log("[sms] check: smsEnabled=%s toNumber=%s outcome=%s", smsEnabled, call.toNumber ?? "(null)", outcome);
      if (smsEnabled && call.toNumber) {
        console.log("[sms] firing for call", call.id);
        sendPostCallSms({ ...call, userName: call.userName ?? "our client" }, outcome).catch((err) =>
          console.error("[webhook] SMS send failed:", err)
        );
      } else {
        if (!smsEnabled) console.log("[sms] skipped — smsEnabled is false in settings");
        if (!call.toNumber) console.log("[sms] skipped — toNumber is null for call", call.id);
      }
      break;
    }

    default:
      // ignore transcript/function-call/etc. for now
      break;
  }

  return NextResponse.json({ ok: true });
}
