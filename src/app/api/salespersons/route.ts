import { NextResponse } from 'next/server'
import { listSalesPersons } from '@/lib/customers'
import { resolveAccess, unauthorized } from '@/lib/access'

export const dynamic = 'force-dynamic'

// Owner-scoped list of sales people for the customer edit dropdown.
export async function GET() {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  const salesPersons = await listSalesPersons(access.ownerId)
  return NextResponse.json({ salesPersons })
}
