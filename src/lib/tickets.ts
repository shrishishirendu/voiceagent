import { prisma } from '@/lib/prisma'
import type { Prisma, Ticket } from '@prisma/client'

// Ticket data-access, mirroring EnvoyIn's lib/tickets.js: every function takes
// `ownerId` as its FIRST argument and filters by it; single-row ops filter by BOTH
// id AND ownerId together (IDOR guard). In demo3.0 tickets are the outbound-call
// analogue of EnvoyIn's inbound tickets — one Ticket per Call, tagged "outbound",
// carrying a real customerId FK (which EnvoyIn's tickets lack).

type DbClient = Prisma.TransactionClient | typeof prisma

export type TicketFilters = {
  channel?: string
  status?: string
  customerId?: string
  // Category scoping is a no-op for outbound (SLA/category deferred), but the param
  // is kept so the shape matches EnvoyIn for the eventual merge.
  allowedCategoryIds?: string[] | null
}

export async function createTicket(
  ownerId: string,
  data: {
    customerId?: string | null
    callId?: string | null
    title?: string | null
    requester?: string | null
    channel?: string
    status?: string
    tags?: string[]
    aiSummary?: string | null
    body?: string | null
  },
  db: DbClient = prisma
): Promise<Ticket> {
  return db.ticket.create({
    data: {
      ownerId,
      customerId: data.customerId ?? null,
      callId: data.callId ?? null,
      title: data.title ?? null,
      requester: data.requester ?? null,
      channel: data.channel ?? 'phone',
      status: data.status ?? 'Incoming',
      tags: data.tags ?? [],
      aiSummary: data.aiSummary ?? null,
      body: data.body ?? null,
    },
  })
}

export async function getAllTickets(ownerId: string, filters: TicketFilters = {}): Promise<Ticket[]> {
  return prisma.ticket.findMany({
    where: {
      ownerId,
      ...(filters.channel ? { channel: filters.channel } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getTicket(ownerId: string, id: string): Promise<Ticket | null> {
  // Filter by both id AND ownerId — ticket ids are uuids, but scoping by owner is the
  // IDOR guard that keeps one tenant from reading another's ticket by id.
  return prisma.ticket.findFirst({ where: { id, ownerId } })
}

export async function getTicketByCallId(ownerId: string, callId: string): Promise<Ticket | null> {
  return prisma.ticket.findFirst({ where: { ownerId, callId } })
}

export async function getTicketsByCustomer(ownerId: string, customerId: string): Promise<Ticket[]> {
  return prisma.ticket.findMany({ where: { ownerId, customerId }, orderBy: { createdAt: 'desc' } })
}

export async function updateTicket(
  ownerId: string,
  id: string,
  data: Prisma.TicketUpdateInput
): Promise<Ticket | null> {
  // Guard ownership first (updateMany won't leak, but we want the fresh row back).
  const existing = await prisma.ticket.findFirst({ where: { id, ownerId }, select: { id: true } })
  if (!existing) return null
  return prisma.ticket.update({ where: { id }, data })
}

export async function resolveTicket(ownerId: string, id: string): Promise<Ticket | null> {
  return updateTicket(ownerId, id, { status: 'Resolved' })
}
