import { NextRequest, NextResponse } from "next/server";
import { resolveAccess, hasRole, unauthorized, forbidden } from "@/lib/access";
import { parseInvoiceBuffer } from "@/lib/invoice-ingest";

// PDF text extraction (pdf-parse) runs in the Node runtime, not Edge.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const access = await resolveAccess();
  if (!access) return unauthorized();
  if (!hasRole(access, "agent")) return forbidden();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("document");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "document" file' }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Document must be a PDF" }, { status: 400 });
  }
  const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "PDF must be under 20 MB" }, { status: 413 });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Failed to read uploaded PDF" }, { status: 400 });
  }

  // Deterministic template path (free/fast) → Gemini fallback → 422. Shared with the
  // bulk import script so both ingest surfaces parse identically.
  const outcome = await parseInvoiceBuffer(buffer);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json({
    ...outcome.parsed,
    _source: outcome.source,
    ...(outcome.templateId ? { _templateId: outcome.templateId } : {}),
  });
}
