import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAccess, hasRole, unauthorized, forbidden, bustAccessCache } from '@/lib/access'
import { updateMember, removeMember, listMembers, MEMBER_ROLES } from '@/lib/members'
import { revokeInvite } from '@/lib/invites'

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
  // A role change must take effect on their next request, not up to 30s later.
  bustAccessCache(updated.email)
  return NextResponse.json({ member: updated })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  if (!hasRole(access, 'admin')) return forbidden()

  // Read the roster entry BEFORE removing it — we need the email to revoke the invite,
  // and after removeMember it's gone.
  const member = (await listMembers(access.ownerId)).find((m) => m.id === params.id)
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const removed = await removeMember(access.ownerId, params.id)
  if (!removed) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Kill any outstanding invite link so a removed member can't still redeem it, and drop
  // the placeholder account if they never accepted. An accepted member keeps their
  // account — they just no longer resolve to this workspace.
  await revokeInvite(member)
  bustAccessCache(member.email)

  return NextResponse.json({ ok: true })
}
