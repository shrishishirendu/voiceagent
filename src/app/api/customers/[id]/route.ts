import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCustomer, updateCustomer } from '@/lib/customers'
import { resolveAccess, hasRole, unauthorized, forbidden } from '@/lib/access'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  const detail = await getCustomer(access.ownerId, params.id)
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(detail)
}

const PatchSchema = z.object({
  businessName: z.string().min(1).max(200).optional(),
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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  if (!hasRole(access, 'agent')) return forbidden()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid fields', details: parsed.error.flatten() }, { status: 400 })
  }
  const updated = await updateCustomer(access.ownerId, params.id, parsed.data)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, id: updated.id })
}
