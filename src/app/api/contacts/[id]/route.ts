import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveAccess, hasRole, unauthorized, forbidden } from "@/lib/access";

const PatchSchema = z.object({
  businessName: z.string().min(1).max(200).optional(),
  phone: z.string().max(40).nullish(),
  abn: z.string().max(40).nullish(),
  email: z.string().max(200).nullish(),
  contactPerson: z.string().max(200).nullish(),
});

// Edit a contact (Customer). Used by the Contacts screen to fill in / fix phone numbers.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await resolveAccess();
  if (!access) return unauthorized();
  if (!hasRole(access, "agent")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid fields", details: parsed.error.flatten() }, { status: 400 });
  }

  // id + ownerId together — IDOR guard.
  const existing = await prisma.customer.findFirst({ where: { id: params.id, ownerId: access.ownerId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = parsed.data;
  const updated = await prisma.customer.update({
    where: { id: params.id },
    data: {
      ...(d.businessName !== undefined && { businessName: d.businessName }),
      ...(d.phone !== undefined && { contactPhone: d.phone }),
      ...(d.abn !== undefined && { abn: d.abn }),
      ...(d.email !== undefined && { email1: d.email }),
      ...(d.contactPerson !== undefined && { contactPerson: d.contactPerson }),
    },
  });

  return NextResponse.json({ ok: true, id: updated.id });
}
