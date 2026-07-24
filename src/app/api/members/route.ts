import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAccess, hasRole, unauthorized, forbidden } from '@/lib/access'
import { listMembers, addMember, MEMBER_ROLES } from '@/lib/members'

export const dynamic = 'force-dynamic'

// Team & Access (Phase 3-C). Members live in the tenant's `members` jsonb; only
// admins/owners may list or invite. Roles: admin | agent | viewer (owner is implicit).
export async function GET() {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  if (!hasRole(access, 'admin')) return forbidden()
  const members = await listMembers(access.ownerId)
  return NextResponse.json({ members, owner: { email: access.ownerId, role: 'owner' } })
}

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(MEMBER_ROLES),
  categories: z.array(z.string()).nullish(),
})

export async function POST(req: NextRequest) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  if (!hasRole(access, 'admin')) return forbidden()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = InviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid invite', details: parsed.error.flatten() }, { status: 400 })
  }
  const member = await addMember(access.ownerId, {
    email: parsed.data.email,
    role: parsed.data.role,
    categories: parsed.data.categories ?? null,
  })
  if (!member) {
    return NextResponse.json({ error: 'That email is already the owner or an existing member.' }, { status: 409 })
  }
  return NextResponse.json({ member })
}
