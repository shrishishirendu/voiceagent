import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { companyNamesMatch } from "@/lib/nameUtils";
import { resolveAccess, unauthorized } from "@/lib/access";

export const dynamic = "force-dynamic";

// Resolve a debtor phone number. Priority: a previously-ingested invoice with the
// same number → a fuzzy business-name match against the customer (contacts) table.
export async function GET(req: NextRequest) {
  const access = await resolveAccess();
  if (!access) return unauthorized();
  const ownerId = access.ownerId;

  const { searchParams } = new URL(req.url);
  const contactBusiness = searchParams.get("contactBusiness")?.trim() ?? "";
  const invoiceNumber = searchParams.get("invoiceNumber")?.trim() ?? "";

  if (!contactBusiness && !invoiceNumber) {
    return NextResponse.json(
      { error: "At least one of contactBusiness or invoiceNumber is required" },
      { status: 400 }
    );
  }

  // (1) Invoice number — same document re-uploaded.
  if (invoiceNumber) {
    const inv = await prisma.invoice.findFirst({
      where: { ownerId, invoiceNumber },
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { contactPhone: true } } },
    });
    const phone = inv?.toNumber || inv?.customer?.contactPhone || null;
    if (phone) return NextResponse.json({ phone, matchedBy: "invoice" });
  }

  // (2) contactBusiness — fuzzy business-name match against the customer table.
  if (contactBusiness) {
    const customers = await prisma.customer.findMany({
      where: { ownerId, contactPhone: { not: null } },
      select: { businessName: true, contactPhone: true },
      take: 1000,
    });
    const hit = customers.find((c) => companyNamesMatch(c.businessName, contactBusiness));
    if (hit?.contactPhone) return NextResponse.json({ phone: hit.contactPhone, matchedBy: "name" });
  }

  return NextResponse.json({ phone: null });
}
