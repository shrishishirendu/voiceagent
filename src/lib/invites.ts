import { prisma } from '@/lib/prisma'
import { issueToken, revokeTokens, tokenLink } from '@/lib/auth-tokens'
import { sendInviteEmail } from '@/lib/email'
import type { Member } from '@/lib/members'

// The identity half of inviting a teammate. lib/members.ts owns the roster (who is on the
// team, with what role); this owns the account that roster entry points at — the
// passwordless User row and the emailed link that lets them set a password.
//
// Kept separate from members.ts so the roster stays a pure data module: mutateMembers runs
// inside a transaction, and sending email from inside one is a good way to email people
// about a change that then rolls back.

const lc = (s: string) => s.trim().toLowerCase()

// Create the sign-in identity for an invited email, if it doesn't already exist.
// passwordHash stays null — that is precisely what marks "invited but not yet accepted",
// and what stops the account being usable until the emailed link is redeemed.
export async function ensureInvitedUser(email: string, name?: string | null): Promise<void> {
  const id = lc(email)
  await prisma.user.upsert({
    where: { id },
    create: { id, email: id, name: name ?? null, passwordHash: null, isOwner: false },
    update: {}, // never touch an existing account — especially not its password
  })
}

// Issue a fresh invite token and email it. Also used by "resend", which is why it always
// mints a new token: issueToken drops any outstanding one, so a resend invalidates the
// earlier link rather than leaving two live ways in.
export async function sendInvite(
  email: string,
  opts: { businessName?: string | null; invitedBy?: string | null; role?: string }
): Promise<void> {
  const to = lc(email)
  const raw = await issueToken('invite', to)
  await sendInviteEmail(to, tokenLink('invite', to, raw), opts)
}

// Undo an invite that was never accepted: kill the outstanding link, and delete the
// placeholder User row so the address is free to sign up on its own later.
//
// An accepted member (one who has set a password) keeps their account — removing them
// from the roster revokes their access to THIS workspace, which is a different thing from
// deleting their identity.
export async function revokeInvite(member: Pick<Member, 'email'>): Promise<void> {
  const email = lc(member.email)
  await revokeTokens('invite', email)
  await prisma.user.deleteMany({ where: { id: email, passwordHash: null, isOwner: false } })
}
