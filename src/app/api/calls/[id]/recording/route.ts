import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const call = await prisma.call.findUnique({ where: { id: params.id } });
  if (!call) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!call.vapiCallId) {
    return NextResponse.json({ error: "No recording available" }, { status: 404 });
  }

  const vapiKey = process.env.VAPI_PRIVATE_KEY;
  if (!vapiKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const vapiRes = await fetch(
    `https://api.vapi.ai/call/${call.vapiCallId}/mono-recording`,
    {
      headers: { Authorization: `Bearer ${vapiKey}` },
      redirect: "follow",
    }
  );

  if (!vapiRes.ok) {
    return NextResponse.json({ error: "Recording unavailable" }, { status: vapiRes.status });
  }

  // vapiRes followed the 302 to a signed URL — stream the audio back
  const contentType = vapiRes.headers.get("content-type") ?? "audio/wav";
  return new NextResponse(vapiRes.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
}
