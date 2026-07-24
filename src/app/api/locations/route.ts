import { NextResponse } from 'next/server'
import { listLocations } from '@/lib/customers'
import { resolveAccess, unauthorized } from '@/lib/access'

export const dynamic = 'force-dynamic'

// Owner-scoped list of locations (shops) for the customer edit dropdown.
export async function GET() {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  const locations = await listLocations(access.ownerId)
  return NextResponse.json({ locations })
}
