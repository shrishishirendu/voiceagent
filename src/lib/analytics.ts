import { prisma } from '@/lib/prisma'

// Analytics with inbound/outbound segmentation (Phase 3-E). Tickets carry a `tags` jsonb
// that includes "outbound" (this app) or "inbound" (EnvoyIn's tickets, once merged), so
// the same screen segments both channels off one field. SLA/category tags are ignored
// here (deferred). All owner-scoped. Everything is derived server-side; the page just
// renders the finished numbers via the dataviz SVG primitives.

export type SegmentStats = {
  total: number
  incoming: number
  inProgress: number
  resolved: number
  resolutionRate: number // resolved / total
}

export type Analytics = {
  totals: { tickets: number; resolved: number; resolutionRate: number }
  channel: { outbound: number; inbound: number; other: number }
  outbound: SegmentStats
  inbound: SegmentStats
  perDay: { date: string; outbound: number; inbound: number }[] // last 14 days
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

type Channel = 'outbound' | 'inbound' | 'other'
function channelOf(tags: unknown): Channel {
  const arr = Array.isArray(tags) ? (tags as unknown[]).map(String) : []
  if (arr.includes('inbound')) return 'inbound'
  if (arr.includes('outbound')) return 'outbound'
  return 'other'
}

function emptySegment(): SegmentStats {
  return { total: 0, incoming: 0, inProgress: 0, resolved: 0, resolutionRate: 0 }
}
function tallyStatus(seg: SegmentStats, status: string): void {
  seg.total++
  if (status === 'Resolved') seg.resolved++
  else if (status === 'In Progress') seg.inProgress++
  else seg.incoming++ // "Incoming" or any other non-terminal state
}

export async function getAnalytics(ownerId: string): Promise<Analytics> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - 13) // 14-day window incl. today

  const tickets = await prisma.ticket.findMany({
    where: { ownerId },
    select: { status: true, tags: true, createdAt: true },
  })

  const outbound = emptySegment()
  const inbound = emptySegment()
  const channel = { outbound: 0, inbound: 0, other: 0 }

  // Dense 14-day series, zero-filled.
  const perDayMap = new Map<string, { outbound: number; inbound: number }>()
  for (let i = 0; i < 14; i++) {
    const d = new Date(since)
    d.setDate(since.getDate() + i)
    perDayMap.set(isoDay(d), { outbound: 0, inbound: 0 })
  }

  for (const t of tickets) {
    const ch = channelOf(t.tags)
    channel[ch]++
    if (ch === 'outbound') tallyStatus(outbound, t.status)
    else if (ch === 'inbound') tallyStatus(inbound, t.status)

    if (ch !== 'other') {
      const key = isoDay(new Date(t.createdAt))
      const bucket = perDayMap.get(key)
      if (bucket) bucket[ch]++
    }
  }

  outbound.resolutionRate = outbound.total ? outbound.resolved / outbound.total : 0
  inbound.resolutionRate = inbound.total ? inbound.resolved / inbound.total : 0

  const resolved = outbound.resolved + inbound.resolved
  const total = tickets.length

  return {
    totals: { tickets: total, resolved, resolutionRate: total ? resolved / total : 0 },
    channel,
    outbound,
    inbound,
    perDay: Array.from(perDayMap.entries()).map(([date, v]) => ({ date, ...v })),
  }
}
