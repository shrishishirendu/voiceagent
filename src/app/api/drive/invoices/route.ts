import { NextResponse } from "next/server";
import { listDriveInvoices } from "@/lib/drive";

export const dynamic = "force-dynamic";

function missingEnv(): string | null {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) return "GOOGLE_SERVICE_ACCOUNT_KEY";
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) return "GOOGLE_DRIVE_FOLDER_ID";
  return null;
}

export async function GET() {
  const missing = missingEnv();
  if (missing) {
    return NextResponse.json(
      { error: `Server configuration error: ${missing} is not set.` },
      { status: 500 }
    );
  }

  try {
    const files = await listDriveInvoices();
    return NextResponse.json({ files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[drive/invoices] error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
