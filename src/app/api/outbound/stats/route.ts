import { NextResponse } from 'next/server'
import { getOutboundStats } from '@/lib/outbound-stats'
import { resolveAccess, unauthorized } from '@/lib/access'

export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  const stats = await getOutboundStats(access.ownerId)
  return NextResponse.json(stats)
}
