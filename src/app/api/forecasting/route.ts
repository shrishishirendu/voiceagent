import { NextResponse } from 'next/server'
import { resolveAccess, unauthorized } from '@/lib/access'
import { getActivityForecast } from '@/lib/forecasting'

export const dynamic = 'force-dynamic'

// Live-data workload forecast + cash context (Phase 3-D). Owner-scoped.
export async function GET() {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  return NextResponse.json(await getActivityForecast(access.ownerId))
}
