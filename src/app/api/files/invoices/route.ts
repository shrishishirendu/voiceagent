import { NextResponse } from "next/server";
import { listInvoiceFiles } from "@/lib/storage";
import { resolveAccess, unauthorized } from "@/lib/access";

export const dynamic = "force-dynamic";

function missingEnv(): string | null {
  if (!process.env.SUPABASE_URL) return "SUPABASE_URL";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return "SUPABASE_SERVICE_ROLE_KEY";
  return null;
}

export async function GET() {
  const access = await resolveAccess();
  if (!access) return unauthorized();

  const missing = missingEnv();
  if (missing) {
    return NextResponse.json({ error: `Server configuration error: ${missing} is not set.` }, { status: 500 });
  }
  try {
    const files = await listInvoiceFiles(access.ownerId);
    return NextResponse.json({ files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[files/invoices] error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
