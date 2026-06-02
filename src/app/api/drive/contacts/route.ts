import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readContactsSheet, addMissingContacts } from "@/lib/drive";

export const dynamic = "force-dynamic";

function missingEnv(): string | null {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) return "GOOGLE_SERVICE_ACCOUNT_KEY";
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) return "GOOGLE_DRIVE_FOLDER_ID";
  return null;
}

const NewContactSchema = z.object({
  businessName: z.string().min(1).max(200),
  abn: z.string().max(20).nullish(),
  email: z.string().max(200).nullish(),
  contactPerson: z.string().max(200).nullish(),
});

const PostBodySchema = z.object({
  contacts: z.array(NewContactSchema).max(500),
});

export async function GET() {
  const missing = missingEnv();
  if (missing) {
    return NextResponse.json(
      { error: `Server configuration error: ${missing} is not set.` },
      { status: 500 }
    );
  }

  try {
    const { rows } = await readContactsSheet();
    return NextResponse.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[drive/contacts] GET error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const missing = missingEnv();
  if (missing) {
    return NextResponse.json(
      { error: `Server configuration error: ${missing} is not set.` },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await addMissingContacts(parsed.data.contacts);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[drive/contacts] POST error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
