import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { probeVapiCall } from "@/lib/vapi";

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

function formatMessages(
  messages?: Array<{ role: string; message?: string; content?: string }>
): string {
  if (!messages?.length) return JSON.stringify([]);
  return JSON.stringify(
    messages
      .filter((m) => m.role === "assistant" || m.role === "user" || m.role === "bot")
      .map((m) => ({ who: m.role === "user" ? "them" : "envoy", text: m.message ?? m.content ?? "" }))
      .filter((m) => m.text.length > 0)
  );
}

type VapiCallDetail = Record<string, unknown> & {
  status?: string;
  endedReason?: string;
  durationSeconds?: number;
  artifact?: {
    messages?: Array<{ role: string; message?: string; content?: string }>;
    recordingUrl?: string;
  };
  messages?: Array<{ role: string; message?: string; content?: string }>;
  analysis?: { summary?: string; successEvaluation?: string };
  summary?: string;
  recordingUrl?: string;
};

const STATUS_RANK: Record<string, number> = {
  dispatching: 0, queued: 1, ringing: 2, "in-progress": 3, completed: 4, failed: 4,
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  let call = await prisma.call.findUnique({ where: { id: params.id } });
  if (!call) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let pollError: string | null = null;

  // If the call hasn't reached a terminal state, check Vapi directly.
  // Always probe Vapi first — age-based auto-fail only fires when Vapi is unreachable.
  if (call.vapiCallId && call.status !== "completed" && call.status !== "failed") {
    const ageMs = Date.now() - new Date(call.createdAt).getTime();
    const RINGING_TIMEOUT_MS    = 5 * 60 * 1000;
    const IN_PROGRESS_TIMEOUT_MS = 12 * 60 * 1000;

    const probe = await probeVapiCall(call.vapiCallId);

    if (probe.ok) {
      const vapiData = probe.data as VapiCallDetail;
      console.log("[poll] Vapi returned status=%s for vapiCallId=%s", vapiData.status, call.vapiCallId);

      if (vapiData.status === "ended") {
        const transcript = formatMessages(vapiData.artifact?.messages ?? vapiData.messages);
        const summary = vapiData.analysis?.summary ?? (vapiData.summary as string | undefined) ?? null;
        const endedReason = (vapiData.endedReason as string | undefined) ?? null;
        const rawMessages = vapiData.artifact?.messages ?? vapiData.messages ?? [];
        const VOICEMAIL_RE = /audio message|leave a message|leave your message|not available|unavailable|voicemail|answering machine|at the tone|after the beep|record your message|send a message/i;
        const transcriptHasVoicemail = rawMessages.some(
          (m: { role: string; message?: string; content?: string }) =>
            m.role === "user" && VOICEMAIL_RE.test(m.message ?? m.content ?? "")
        );
        const isVoicemailDetected = !!(endedReason && /voicemail|machine/i.test(endedReason)) || transcriptHasVoicemail;
        const outcome = isVoicemailDetected
          ? "no-answer"
          : deriveOutcome(endedReason ?? undefined, vapiData.analysis?.successEvaluation);
        const result = summary
          ? summary.split(/[.\n]/).find((s: string) => s.trim().length > 10)?.trim() ?? null
          : null;

        call = await prisma.call.update({
          where: { id: call.id },
          data: {
            status: "completed",
            outcome,
            summary,
            transcript,
            recordingUrl: vapiData.artifact?.recordingUrl ?? (vapiData.recordingUrl as string | undefined) ?? null,
            durationSec: (vapiData.durationSeconds as number | undefined) ?? null,
            endedReason,
            result,
          },
        });
        console.log("[poll] synced completed status from Vapi for", call.id);
      } else if (vapiData.status) {
        // Only advance — never regress. Prevents Vapi's early "queued" state from
        // overwriting "ringing" that the dispatch route already set.
        const currentRank = STATUS_RANK[call.status] ?? -1;
        const newRank = STATUS_RANK[vapiData.status] ?? -1;
        if (newRank > currentRank) {
          call = await prisma.call.update({
            where: { id: call.id },
            data: { status: vapiData.status },
          });
        }
      }
    } else {
      // Vapi probe failed — surface the error; only auto-fail if also overdue
      pollError = probe.error;
      console.error("[poll] Vapi probe failed:", probe.error);

      if (call.status === "ringing" && ageMs > RINGING_TIMEOUT_MS) {
        call = await prisma.call.update({
          where: { id: call.id },
          data: { status: "failed", endedReason: "vapi-unreachable", outcome: "failed" },
        });
        console.log("[poll] auto-failed stuck ringing call (Vapi unreachable)", call.id, "age", Math.round(ageMs / 1000), "s");
      } else if (call.status === "in-progress" && ageMs > IN_PROGRESS_TIMEOUT_MS) {
        call = await prisma.call.update({
          where: { id: call.id },
          data: { status: "failed", endedReason: "vapi-unreachable", outcome: "failed" },
        });
        console.log("[poll] auto-failed overdue in-progress call (Vapi unreachable)", call.id, "age", Math.round(ageMs / 1000), "s");
      }
    }
  }

  return NextResponse.json({
    id: call.id,
    contactBusiness: call.contactBusiness,
    toNumber: call.toNumber,
    objective: call.objective,
    status: call.status,
    outcome: call.outcome,
    result: call.result,
    summary: call.summary,
    durationSec: call.durationSec,
    transcript: (() => { try { return call.transcript ? JSON.parse(call.transcript) : []; } catch { return []; } })(),
    recordingUrl: call.recordingUrl,
    endedReason: call.endedReason,
    invoiceNumber: call.invoiceNumber ?? null,
    createdAt: call.createdAt,
    pollError,
  }, { headers: { "Cache-Control": "no-store" } });
}
