import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCustomers, createCustomer } from '@/lib/customers'
import { resolveAccess, hasRole, unauthorized, forbidden } from '@/lib/access'

export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  const customers = await getCustomers(access.ownerId)
  return NextResponse.json({ customers })
}

const CreateSchema = z.object({
  businessName: z.string().min(1).max(200),
  contactPerson: z.string().max(200).nullish(),
  contactPhone: z.string().max(40).nullish(),
  email: z.string().max(200).nullish(),
  abn: z.string().max(40).nullish(),
  addressLine: z.string().max(300).nullish(),
  city: z.string().max(120).nullish(),
  state: z.string().max(120).nullish(),
  postCode: z.string().max(20).nullish(),
  deliveryInstructions: z.string().max(1000).nullish(),
})

export async function POST(req: NextRequest) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  if (!hasRole(access, 'agent')) return forbidden()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid customer', details: parsed.error.flatten() }, { status: 400 })
  }
  const created = await createCustomer(access.ownerId, parsed.data)
  return NextResponse.json({ id: created.id })
}
