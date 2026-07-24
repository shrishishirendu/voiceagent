import { NextRequest, NextResponse } from "next/server";
import { downloadInvoiceFile } from "@/lib/storage";
import { resolveAccess, unauthorized } from "@/lib/access";

export const dynamic = "force-dynamic";

function missingEnv(): string | null {
  if (!process.env.SUPABASE_URL) return "SUPABASE_URL";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return "SUPABASE_SERVICE_ROLE_KEY";
  return null;
}

// Proxy a PDF out of the private Supabase Storage bucket so the bucket stays
// private and the service-role key never reaches the browser.
export async function GET(req: NextRequest) {
  const access = await resolveAccess();
  if (!access) return unauthorized();

  const missing = missingEnv();
  if (missing) {
    return NextResponse.json({ error: `Server configuration error: ${missing} is not set.` }, { status: 500 });
  }

  const path = req.nextUrl.searchParams.get("path")?.trim();
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  try {
    // downloadInvoiceFile enforces the path is under this tenant's prefix (IDOR guard).
    const buffer = await downloadInvoiceFile(access.ownerId, path);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[files/invoice] error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
