import { NextRequest, NextResponse } from "next/server";
import { getAllTickets } from "@/lib/tickets";
import { resolveAccess, unauthorized } from "@/lib/access";

// Owner-scoped ticket list. Supports ?channel=outbound and ?status=... filters.
// Mirrors EnvoyIn's GET /api/tickets (owner-scoped list).
export async function GET(req: NextRequest) {
  const access = await resolveAccess();
  if (!access) return unauthorized();

  const channel = req.nextUrl.searchParams.get("channel") ?? undefined;
  const status = req.nextUrl.searchParams.get("status") ?? undefined;

  const tickets = await getAllTickets(access.ownerId, {
    channel,
    status,
    allowedCategoryIds: access.categories,
  });
  return NextResponse.json({ tickets });
}
