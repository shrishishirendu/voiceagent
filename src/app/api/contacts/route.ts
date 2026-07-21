import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readContacts, upsertContacts } from "@/lib/contacts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await readContacts();
    return NextResponse.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[contacts] GET error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

const NewContactSchema = z.object({
  businessName: z.string().min(1).max(200),
  abn: z.string().max(40).nullish(),
  phone: z.string().max(40).nullish(),
  email: z.string().max(200).nullish(),
  contactPerson: z.string().max(200).nullish(),
});

// Accepts either a bulk `{ contacts: [...] }` (discovered businesses, no phone) or a
// single contact object (the Contacts screen's "add", which may include a phone).
const PostBodySchema = z.union([
  z.object({ contacts: z.array(NewContactSchema).max(500) }),
  NewContactSchema,
]);

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const contacts = "contacts" in parsed.data ? parsed.data.contacts : [parsed.data];

  try {
    const result = await upsertContacts(contacts);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[contacts] POST error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
