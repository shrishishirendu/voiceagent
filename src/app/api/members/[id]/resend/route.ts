import { NextRequest, NextResponse } from 'next/server'
import { resolveAccess, hasRole, unauthorized, forbidden } from '@/lib/access'
import { listMembers } from '@/lib/members'
import { ensureInvitedUser, sendInvite } from '@/lib/invites'
import { loadTenant } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// Re-send an invite whose email bounced, was never delivered, or expired. Minting a new
// token invalidates the previous link (see issueToken), so there is never more than one
// live way into an account at a time.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  if (!hasRole(access, 'admin')) return forbidden()

  const member = (await listMembers(access.ownerId)).find((m) => m.id === params.id)
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (member.accepted_at) {
    return NextResponse.json(
      { error: 'That member has already set a password. They can use "Forgot password" instead.' },
      { status: 409 }
    )
  }

  await ensureInvitedUser(member.email)
  const tenant = await loadTenant(access.ownerId)
  try {
    await sendInvite(member.email, {
      businessName: tenant?.businessName,
      invitedBy: access.email,
      role: member.role,
    })
  } catch (err) {
    console.error('[members] invite resend failed', err)
    return NextResponse.json({ error: 'Could not send the invite email. Check the Resend configuration.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
