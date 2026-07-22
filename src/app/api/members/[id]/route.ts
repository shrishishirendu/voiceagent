import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAccess, hasRole, unauthorized, forbidden } from '@/lib/access'
import { updateMember, removeMember, MEMBER_ROLES } from '@/lib/members'

export const dynamic = 'force-dynamic'

const PatchSchema = z.object({
  role: z.enum(MEMBER_ROLES).optional(),
  categories: z.array(z.string()).nullish(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  if (!hasRole(access, 'admin')) return forbidden()

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
  const updated = await updateMember(access.ownerId, params.id, {
    role: parsed.data.role,
    categories: parsed.data.categories === undefined ? undefined : parsed.data.categories,
  })
  if (!updated) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  return NextResponse.json({ member: updated })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  if (!hasRole(access, 'admin')) return forbidden()
  const removed = await removeMember(access.ownerId, params.id)
  if (!removed) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
