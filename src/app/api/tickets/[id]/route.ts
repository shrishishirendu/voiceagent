import { NextRequest, NextResponse } from "next/server";
import { getTicket } from "@/lib/tickets";
import { resolveAccess, unauthorized } from "@/lib/access";

// Single ticket, filtered by both id AND ownerId (IDOR guard).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await resolveAccess();
  if (!access) return unauthorized();

  const ticket = await getTicket(access.ownerId, params.id);
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ticket });
}
