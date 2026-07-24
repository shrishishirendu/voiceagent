import { prisma } from '@/lib/prisma'

// Forecasting (Phase 3-D). Ports EnvoyIn's approach — linear trend + weekly seasonality
// + AR(1) on residuals, all pure arithmetic (no ML lib) — but drives it from demo3.0's
// LIVE data (ticket activity + invoice due dates) instead of EnvoyIn's static history
// blob. Two things are produced:
//   1. A daily workload forecast (outbound tickets/day) with a confidence band.
//   2. Cash tiles: recorded collections + known upcoming invoice due amounts.

export type DailyPoint = { date: string; value: number }
export type ForecastPoint = { date: string; value: number; lower: number; upper: number; forecast: boolean }

const DAY_MS = 24 * 60 * 60 * 1000
const iso = (d: Date) => d.toISOString().slice(0, 10)
const weekday = (dateStr: string) => new Date(`${dateStr}T00:00:00Z`).getUTCDay() // 0=Sun..6=Sat

// Zero-filled daily series between [start, end] inclusive from an event→count map.
function fillDaily(counts: Map<string, number>, start: Date, end: Date): DailyPoint[] {
  const points: DailyPoint[] = []
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const key = iso(new Date(t))
    points.push({ date: key, value: counts.get(key) ?? 0 })
  }
  return points
}

// Ordinary least-squares slope/intercept for y over x = 0..n-1.
function linearFit(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length
  if (n === 0) return { slope: 0, intercept: 0 }
  const sumX = (n * (n - 1)) / 2
  const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6
  const sumY = ys.reduce((a, b) => a + b, 0)
  const sumXY = ys.reduce((a, b, i) => a + b * i, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: sumY / n }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

/**
 * Forecast a daily series `horizon` days forward. Decomposes the history into a linear
 * trend, a day-of-week seasonal offset, and an AR(1) residual carry, then projects each
 * component forward. Values are clamped at zero (counts/amounts can't go negative) and a
 * widening ±1.28σ band (~80%) is attached.
 */
export function forecastDaily(history: DailyPoint[], horizon = 14): ForecastPoint[] {
  const historyPoints: ForecastPoint[] = history.map((p) => ({ ...p, lower: p.value, upper: p.value, forecast: false }))
  const n = history.length
  if (n < 3) return historyPoints // too little signal to project

  const ys = history.map((p) => p.value)
  const { slope, intercept } = linearFit(ys)

  // Residuals after removing the trend, then a day-of-week seasonal mean.
  const resid = ys.map((y, i) => y - (intercept + slope * i))
  const seasonalSum = new Array(7).fill(0)
  const seasonalCount = new Array(7).fill(0)
  history.forEach((p, i) => {
    const wd = weekday(p.date)
    seasonalSum[wd] += resid[i]
    seasonalCount[wd] += 1
  })
  const seasonal = seasonalSum.map((s, i) => (seasonalCount[i] ? s / seasonalCount[i] : 0))

  // Deseasonalised residuals → AR(1) coefficient + std for the band.
  const deseason = resid.map((r, i) => r - seasonal[weekday(history[i].date)])
  let num = 0
  let den = 0
  for (let i = 1; i < n; i++) {
    num += deseason[i] * deseason[i - 1]
    den += deseason[i - 1] * deseason[i - 1]
  }
  const phi = den === 0 ? 0 : Math.max(-0.95, Math.min(0.95, num / den))
  const variance = deseason.reduce((a, r) => a + r * r, 0) / n
  const sigma = Math.sqrt(variance)
  const lastResid = deseason[n - 1] ?? 0

  const lastDate = new Date(`${history[n - 1].date}T00:00:00Z`)
  const out: ForecastPoint[] = []
  for (let h = 1; h <= horizon; h++) {
    const d = new Date(lastDate.getTime() + h * DAY_MS)
    const dateStr = iso(d)
    const trend = intercept + slope * (n - 1 + h)
    const season = seasonal[weekday(dateStr)]
    const ar = Math.pow(phi, h) * lastResid
    const value = Math.max(0, trend + season + ar)
    const spread = 1.28 * sigma * Math.sqrt(h)
    out.push({
      date: dateStr,
      value: Math.round(value * 100) / 100,
      lower: Math.max(0, Math.round((value - spread) * 100) / 100),
      upper: Math.round((value + spread) * 100) / 100,
      forecast: true,
    })
  }
  return [...historyPoints, ...out]
}

export type ForecastResponse = {
  series: ForecastPoint[]
  horizon: number
  projectedActivity: number // sum of forecast values over the horizon
  upcomingDue: number // open invoice amounts due within the horizon
  recentCollections: number // payments received in the lookback window
  lookbackDays: number
}

const LOOKBACK_DAYS = 42 // 6 weeks — enough to learn weekly seasonality
const HORIZON = 14

// Assemble the live daily history (outbound ticket activity) and forecast it, plus the
// cash context tiles. All owner-scoped.
export async function getActivityForecast(ownerId: string): Promise<ForecastResponse> {
  const now = new Date()
  const start = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setUTCHours(0, 0, 0, 0)

  const [tickets, openInvoices, collections] = await Promise.all([
    prisma.ticket.findMany({
      where: { ownerId, createdAt: { gte: start } },
      select: { createdAt: true },
    }),
    prisma.invoice.findMany({
      where: { ownerId, status: { in: ['pending', 'queued', 'calling', 'failed'] }, dueDate: { not: null } },
      select: { dueDate: true, amountDue: true, paidAmount: true },
    }),
    prisma.payment.aggregate({
      where: { ownerId, createdAt: { gte: start } },
      _sum: { payAmount: true },
    }),
  ])

  const counts = new Map<string, number>()
  for (const t of tickets) {
    const key = iso(t.createdAt)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const history = fillDaily(counts, start, end)
  const series = forecastDaily(history, HORIZON)

  // Known upcoming inflow: open invoices due within the horizon window.
  const horizonEnd = iso(new Date(end.getTime() + HORIZON * DAY_MS))
  const todayStr = iso(end)
  const upcomingDue = openInvoices.reduce((sum, inv) => {
    if (!inv.dueDate) return sum
    if (inv.dueDate >= todayStr && inv.dueDate <= horizonEnd) {
      return sum + Math.max(0, (inv.amountDue ?? 0) - (inv.paidAmount ?? 0))
    }
    return sum
  }, 0)

  const projectedActivity = series.filter((p) => p.forecast).reduce((a, p) => a + p.value, 0)

  return {
    series,
    horizon: HORIZON,
    projectedActivity: Math.round(projectedActivity * 10) / 10,
    upcomingDue: Math.round(upcomingDue * 100) / 100,
    recentCollections: collections._sum.payAmount ?? 0,
    lookbackDays: LOOKBACK_DAYS,
  }
}
