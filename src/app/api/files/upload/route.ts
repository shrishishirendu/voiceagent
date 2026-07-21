import { NextRequest, NextResponse } from "next/server";
import { uploadInvoiceFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

function missingEnv(): string | null {
  if (!process.env.SUPABASE_URL) return "SUPABASE_URL";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return "SUPABASE_SERVICE_ROLE_KEY";
  return null;
}

// Upload a PDF into the invoices bucket. Used by the upload flow so every processed
// file also lands in Supabase Storage. Returns the storage path.
export async function POST(req: NextRequest) {
  const missing = missingEnv();
  if (missing) {
    return NextResponse.json({ error: `Server configuration error: ${missing} is not set.` }, { status: 500 });
  }

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
  const MAX_PDF_BYTES = 20 * 1024 * 1024;
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "PDF must be under 20 MB" }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const path = await uploadInvoiceFile(file.name, buffer);
    return NextResponse.json({ path });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[files/upload] error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
