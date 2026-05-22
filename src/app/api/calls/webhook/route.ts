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

interface VapiWebhookBody {
  message: VapiMessage;
}

function deriveOutcome(endedReason?: string, successEval?: string): string {
  if (successEval) {
    const s = successEval.toLowerCase();
    if (s.includes("success") || s === "true" || s === "pass") return "success";
    if (s.includes("partial")) return "partial";
    if (s.includes("fail") || s === "false") return "failed";
  }
  if (!endedReason) return "success";
  const r = endedReason.toLowerCase();
  if (r.includes("no-answer") || r.includes("voicemail") || r.includes("busy")) return "no-answer";
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
  let body: VapiWebhookBody;
  try {
    body = (await req.json()) as VapiWebhookBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const msg = body?.message;
  if (!msg || !msg.call?.id) {
    return NextResponse.json({ ok: true, ignored: "no call id" });
  }

  const vapiCallId = msg.call.id;

  // Find our local call record
  const call = await prisma.call.findUnique({ where: { vapiCallId } });
  if (!call) {
    // Vapi might fire webhooks before our DB write commits; just acknowledge
    return NextResponse.json({ ok: true, ignored: "call not found yet" });
  }

  switch (msg.type) {
    case "status-update": {
      const status = msg.status ?? msg.call.status ?? "in-progress";
      await prisma.call.update({
        where: { id: call.id },
        data: { status },
      });
      break;
    }

    case "end-of-call-report": {
      const transcript = formatTranscript(msg.artifact?.messages ?? msg.messages);
      const summary = msg.analysis?.summary ?? msg.summary ?? null;
      const recordingUrl = msg.artifact?.recordingUrl ?? msg.recordingUrl ?? null;
      const durationSec = msg.durationSeconds ?? null;
      const endedReason = msg.endedReason ?? null;
      const outcome = deriveOutcome(endedReason, msg.analysis?.successEvaluation);

      // Try to extract a one-line "result" from the summary
      const result = summary
        ? summary.split(/[.\n]/).find((s) => s.trim().length > 10)?.trim() ?? null
        : null;

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
      break;
    }

    default:
      // ignore transcript/function-call/etc. for now
      break;
  }

  return NextResponse.json({ ok: true });
}
