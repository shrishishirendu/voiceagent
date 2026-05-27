import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getVapiCall } from "@/lib/vapi";

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

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  let call = await prisma.call.findUnique({ where: { id: params.id } });
  if (!call) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // If the call hasn't reached a terminal state, check Vapi directly.
  // This makes status/transcript updates independent of webhook delivery.
  if (call.vapiCallId && call.status !== "completed" && call.status !== "failed") {
    try {
      const vapiData = await getVapiCall(call.vapiCallId) as VapiCallDetail;

      if (vapiData.status === "ended") {
        const transcript = formatMessages(vapiData.artifact?.messages ?? vapiData.messages);
        const summary = vapiData.analysis?.summary ?? (vapiData.summary as string | undefined) ?? null;
        const endedReason = (vapiData.endedReason as string | undefined) ?? null;
        const outcome = deriveOutcome(endedReason ?? undefined, vapiData.analysis?.successEvaluation);
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
      } else if (vapiData.status && vapiData.status !== call.status) {
        // Keep in-progress status in sync (ringing → in-progress)
        call = await prisma.call.update({
          where: { id: call.id },
          data: { status: vapiData.status },
        });
      }
    } catch (err) {
      // Vapi check failed — return what we have in the DB; don't error the poll
      console.error("[poll] Vapi status check failed:", err);
    }
  }

  return NextResponse.json({
    id: call.id,
    contactName: call.contactName,
    toNumber: call.toNumber,
    objective: call.objective,
    status: call.status,
    outcome: call.outcome,
    result: call.result,
    summary: call.summary,
    durationSec: call.durationSec,
    transcript: call.transcript ? JSON.parse(call.transcript) : [],
    recordingUrl: call.recordingUrl,
    endedReason: call.endedReason,
    createdAt: call.createdAt,
  });
}
