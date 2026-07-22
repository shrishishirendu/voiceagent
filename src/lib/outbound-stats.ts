import { prisma } from '@/lib/prisma'

// Server-side aggregation for the Outbound dashboard (mirrors EnvoyIn's server-computed
// Analytics/Forecasting — derive once on the server, ship the finished numbers). All
// queries are owner-scoped.

export type OutboundStats = {
  totalCalls: number
  outcome: { resolved: number; voicemail: number; failed: number; active: number }
  resolutionRate: number // resolved / (calls that reached a terminal state)
  queue: { queued: number; calling: number } // invoices waiting / in-flight
  outboundTickets: { incoming: number; inProgress: number; resolved: number }
  callsPerDay: { date: string; count: number }[] // last 14 days, oldest→newest
}

const RESOLVED_OUTCOMES = ['success', 'partial']
const ACTIVE_STATUSES = ['dispatching', 'ringing', 'in-progress']

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function getOutboundStats(ownerId: string): Promise<OutboundStats> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - 13) // 14-day window incl. today

  const [calls, invoiceGroups, ticketGroups, recentCalls] = await Promise.all([
    prisma.call.findMany({ where: { ownerId }, select: { status: true, outcome: true } }),
    prisma.invoice.groupBy({ by: ['status'], where: { ownerId }, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ['status'], where: { ownerId, channel: 'phone' }, _count: { _all: true } }),
    prisma.call.findMany({ where: { ownerId, createdAt: { gte: since } }, select: { createdAt: true } }),
  ])

  const outcome = { resolved: 0, voicemail: 0, failed: 0, active: 0 }
  for (const c of calls) {
    if (ACTIVE_STATUSES.includes(c.status)) outcome.active++
    else if (c.outcome && RESOLVED_OUTCOMES.includes(c.outcome)) outcome.resolved++
    else if (c.outcome === 'no-answer') outcome.voicemail++
    else outcome.failed++
  }
  const terminal = outcome.resolved + outcome.voicemail + outcome.failed
  const resolutionRate = terminal > 0 ? outcome.resolved / terminal : 0

  const invByStatus = new Map(invoiceGroups.map((g) => [g.status, g._count._all]))
  const queue = {
    queued: (invByStatus.get('pending') ?? 0) + (invByStatus.get('queued') ?? 0),
    calling: invByStatus.get('calling') ?? 0,
  }

  const tkByStatus = new Map(ticketGroups.map((g) => [g.status, g._count._all]))
  const outboundTickets = {
    incoming: tkByStatus.get('Incoming') ?? 0,
    inProgress: tkByStatus.get('In Progress') ?? 0,
    resolved: tkByStatus.get('Resolved') ?? 0,
  }

  // Bucket recent calls into a dense 14-day series (zero-fill missing days).
  const perDay = new Map<string, number>()
  for (let i = 0; i < 14; i++) {
    const d = new Date(since)
    d.setDate(since.getDate() + i)
    perDay.set(isoDay(d), 0)
  }
  for (const c of recentCalls) {
    const key = isoDay(new Date(c.createdAt))
    if (perDay.has(key)) perDay.set(key, (perDay.get(key) ?? 0) + 1)
  }
  const callsPerDay = Array.from(perDay.entries()).map(([date, count]) => ({ date, count }))

  return {
    totalCalls: calls.length,
    outcome,
    resolutionRate,
    queue,
    outboundTickets,
    callsPerDay,
  }
}
