import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contactBusiness = searchParams.get("contactBusiness")?.trim() ?? "";
  const invoiceNumber = searchParams.get("invoiceNumber")?.trim() ?? "";

  if (!contactBusiness && !invoiceNumber) {
    return NextResponse.json(
      { error: "At least one of contactBusiness or invoiceNumber is required" },
      { status: 400 }
    );
  }

  const candidates = await prisma.call.findMany({
    where: { toNumber: { not: "" } },
    orderBy: { createdAt: "desc" },
    select: { toNumber: true, contactBusiness: true, invoiceNumber: true },
    take: 500,
  });

  // (1) Invoice number — same document re-uploaded
  if (invoiceNumber) {
    const hit = candidates.find((c) => c.invoiceNumber === invoiceNumber);
    if (hit) return NextResponse.json({ phone: hit.toNumber, matchedBy: "invoice" });
  }

  // (2) contactBusiness — case-insensitive business name match
  if (contactBusiness) {
    const lower = contactBusiness.toLowerCase();
    const hit = candidates.find((c) => c.contactBusiness?.toLowerCase() === lower);
    if (hit) return NextResponse.json({ phone: hit.toNumber, matchedBy: "name" });
  }

  return NextResponse.json({ phone: null });
}
