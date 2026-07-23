import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getTicket, updateTicket, deriveOutboundTicketStatus } from "@/lib/tickets";
import { resolveAccess, unauthorized, forbidden, hasRole } from "@/lib/access";

// Single ticket, filtered by both id AND ownerId (IDOR guard). Enriched with the linked
// call (+ its invoices) and customer, plus the derived outbound status the drawer shows.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await resolveAccess();
  if (!access) return unauthorized();

  const ticket = await getTicket(access.ownerId, params.id);
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const invoices = (ticket.call?.invoiceLinks ?? []).map((l) => l.invoice);
  return NextResponse.json({
    ticket: {
      ...ticket,
      tags: Array.isArray(ticket.tags) ? (ticket.tags as string[]) : [],
      notes: Array.isArray(ticket.notes) ? ticket.notes : [],
      invoices,
      derivedStatus: deriveOutboundTicketStatus(ticket.status, ticket.call),
    },
  });
}

const PatchSchema = z.object({
  status: z.enum(["Incoming", "In Progress", "Resolved"]).optional(),
  note: z.string().trim().min(1).max(2000).optional(),
});

// Manual ticket edits from the drawer (resolve / add note). Agent+.
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid patch" }, { status: 400 });

  const existing = await getTicket(access.ownerId, params.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Prisma.TicketUpdateInput = {};
  if (parsed.data.status) data.status = parsed.data.status;
  if (parsed.data.note) {
    const prior = Array.isArray(existing.notes) ? (existing.notes as unknown[]) : [];
    data.notes = [...prior, { text: parsed.data.note, ts: new Date().toISOString() }] as Prisma.InputJsonValue;
  }

  const updated = await updateTicket(access.ownerId, params.id, data);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ticket: updated });
}
