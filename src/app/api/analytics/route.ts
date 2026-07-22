import { NextResponse } from 'next/server'
import { resolveAccess, unauthorized } from '@/lib/access'
import { getAnalytics } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

// Inbound/outbound analytics segmentation (Phase 3-E). Owner-scoped.
export async function GET() {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  return NextResponse.json(await getAnalytics(access.ownerId))
}
