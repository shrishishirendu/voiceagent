import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
  if (successEval) {
    const s = successEval.toLowerCase();
    if (s.includes("success") || s === "true" || s === "pass") return "success";
    if (s.includes("partial")) return "partial";
    if (s.includes("fail") || s === "false") return "failed";
  }
  if (!endedReason) return "success";
  const r = endedReason.toLowerCase();
  if (r.includes("no-answer") || r.includes("voicemail") || r.includes("busy") || r.includes("machine")) return "no-answer";
  if (r.includes("error") || r.includes("failed")) return "failed";
  return "success";
}

function formatTranscript(messages?: VapiMessage["messages"]): string {
  if (!messages || messages.length === 0) return JSON.stringify([]);
  const formatted = messages
    .filter((m) => m.role === "assistant" || m.role === "user" || m.role === "bot")
    .map((m) => ({
      who: m.role === "user" ? "them" : "envoy",
      text: m.message ?? m.content ?? "",
    }))
    .filter((m) => m.text.length > 0);
  return JSON.stringify(formatted);
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

  // Find our local call record
  let call;
  try {
    call = await prisma.call.findUnique({ where: { vapiCallId } });
    // Race: vapiCallId may arrive before the dispatch route writes it.
    // Attempt to bind this event to the most recent unbound in-flight call (within 2 min).
    // Safe under MAX_CONCURRENT_CALLS=1 — at most one unbound call at a time.
    if (!call) {
      const candidate = await prisma.call.findFirst({
        where: {
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
      const isVoicemail = endedReason
        ? /voicemail|machine/i.test(endedReason)
        : false;

      // For voicemail calls Vapi often sends no summary — synthesise a clear one.
      const rawSummary = msg.analysis?.summary ?? msg.summary ?? null;
      const summary = rawSummary ??
        (isVoicemail
          ? `Envoy called ${call.contactBusiness} but the call went to voicemail. A message was left.`
          : null);

      const recordingUrl = msg.artifact?.recordingUrl ?? msg.recordingUrl ?? null;
      const durationSec = msg.durationSeconds ?? null;
      const outcome = deriveOutcome(
        endedReason ?? undefined,
        msg.analysis?.successEvaluation
      );

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
      break;
    }

    default:
      // ignore transcript/function-call/etc. for now
      break;
  }

  return NextResponse.json({ ok: true });
}
