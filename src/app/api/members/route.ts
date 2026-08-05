import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveAccess, hasRole, unauthorized, forbidden } from '@/lib/access'
import { listMembers, addMember, MEMBER_ROLES } from '@/lib/members'
import { ensureInvitedUser, sendInvite } from '@/lib/invites'
import { loadTenant } from '@/lib/tenant'

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
  const email = parsed.data.email.trim().toLowerCase()

  // An email that already owns a workspace can't be pulled into this one — their own
  // tenant would win in resolveAccess() and the membership would silently do nothing.
  const existing = await prisma.user.findUnique({
    where: { id: email },
    select: { isOwner: true },
  })
  if (existing?.isOwner) {
    return NextResponse.json(
      { error: 'That email already has its own company account and cannot be added as a member.' },
      { status: 409 }
    )
  }

  const member = await addMember(access.ownerId, {
    email,
    role: parsed.data.role,
    categories: parsed.data.categories ?? null,
  })
  if (!member) {
    return NextResponse.json({ error: 'That email is already the owner or an existing member.' }, { status: 409 })
  }

  // Roster entry exists; now give it an identity and a way in. If the email fails to
  // send, the member is still on the roster — report it so the admin can hit Resend
  // rather than silently leaving someone with no route into the workspace.
  await ensureInvitedUser(email)
  const tenant = await loadTenant(access.ownerId)
  try {
    await sendInvite(email, {
      businessName: tenant?.businessName,
      invitedBy: access.email,
      role: parsed.data.role,
    })
  } catch (err) {
    console.error('[members] invite email failed', err)
    return NextResponse.json({
      member,
      emailSent: false,
      warning: 'Member added, but the invite email could not be sent. Use Resend invite to try again.',
    })
  }

  return NextResponse.json({ member, emailSent: true })
}
