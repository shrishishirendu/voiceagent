import { NextRequest, NextResponse } from "next/server";
import { downloadDriveFile } from "@/lib/drive";

export const dynamic = "force-dynamic";

function missingEnv(): string | null {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) return "GOOGLE_SERVICE_ACCOUNT_KEY";
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) return "GOOGLE_DRIVE_FOLDER_ID";
  return null;
}

export async function GET(req: NextRequest) {
  const missing = missingEnv();
  if (missing) {
    return NextResponse.json(
      { error: `Server configuration error: ${missing} is not set.` },
      { status: 500 }
    );
  }

  const fileId = req.nextUrl.searchParams.get("fileId")?.trim();
  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  try {
    const buffer = await downloadDriveFile(fileId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[drive/invoice-file] error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
