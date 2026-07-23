import { NextRequest, NextResponse } from "next/server";
import { getAllTickets, deriveOutboundTicketStatus } from "@/lib/tickets";
import { resolveAccess, unauthorized } from "@/lib/access";

// Owner-scoped ticket list. Supports ?channel=outbound and ?status=... filters.
// Mirrors EnvoyIn's GET /api/tickets (owner-scoped list). Each row is enriched with
// its linked Call + Customer and a `derivedStatus` (Queued|Calling|Voicemail|Failed|Resolved)
// the Tickets board buckets into lanes.
export async function GET(req: NextRequest) {
  const access = await resolveAccess();
  if (!access) return unauthorized();

  const channel = req.nextUrl.searchParams.get("channel") ?? undefined;
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  // Outbound tickets carry channel "phone" + an "outbound" TAG (not channel), so filtering
  // is by tag. Done in JS after the owner-scoped fetch — ticket volumes are small.
  const tag = req.nextUrl.searchParams.get("tag") ?? undefined;

  const tickets = await getAllTickets(access.ownerId, {
    channel,
    status,
    allowedCategoryIds: access.categories,
  });

  const enriched = tickets
    .map((t) => ({
      ...t,
      tags: Array.isArray(t.tags) ? (t.tags as string[]) : [],
      derivedStatus: deriveOutboundTicketStatus(t.status, t.call),
    }))
    .filter((t) => !tag || t.tags.includes(tag));

  return NextResponse.json({ tickets: enriched });
}
