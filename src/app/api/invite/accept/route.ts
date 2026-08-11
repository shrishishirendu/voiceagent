import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hashPassword, passwordProblem } from '@/lib/passwords'
import { consumeToken, peekToken } from '@/lib/auth-tokens'
import { findMembershipByEmail, acceptInviteIfPending } from '@/lib/members'
import { bustAccessCache } from '@/lib/access'

export const dynamic = 'force-dynamic'

// An invited employee redeeming their emailed link to set a first password.
// Runs signed out (see PUBLIC_ROUTES in src/middleware.ts) — the token IS the credential.
//
// Note this never sets isOwner: an invited user's workspace comes from their membership,
// so if the invite were later revoked they lose access rather than falling back to owning
// an empty tenant of their own.
const Schema = z.object({
  email: z.string().trim().email().max(200),
  token: z.string().min(1).max(500),
  password: z.string().min(1).max(200),
})

// Non-destructive check so the accept page can greet the recipient by company name (or
// tell them the link is dead) before they type anything. Requires the token itself, so it
// reveals nothing to anyone who doesn't already have the link.
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email') ?? ''
  const token = req.nextUrl.searchParams.get('token') ?? ''

  if (!(await peekToken('invite', email, token))) {
    return NextResponse.json({ valid: false }, { status: 200 })
  }
  const membership = await findMembershipByEmail(email)
  if (!membership) return NextResponse.json({ valid: false }, { status: 200 })

  return NextResponse.json({
    valid: true,
    email: email.toLowerCase(),
    businessName: membership.businessName,
    role: membership.member.role,
  })
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const pwProblem = passwordProblem(parsed.data.password)
  if (pwProblem) return NextResponse.json({ error: pwProblem }, { status: 400 })

  const email = await consumeToken('invite', parsed.data.email, parsed.data.token)
  if (!email) {
    return NextResponse.json(
      { error: 'This invite link is invalid, has expired, or has already been used. Ask an admin to send a new one.' },
      { status: 400 }
    )
  }

  // The token proves the email was invited at send time; re-check the roster in case the
  // invite was revoked in the interim, so a revoked link can't still create a password.
  const membership = await findMembershipByEmail(email)
  if (!membership) {
    return NextResponse.json(
      { error: 'That invite is no longer active. Ask an admin to invite you again.' },
      { status: 403 }
    )
  }

  const passwordHash = await hashPassword(parsed.data.password)
  await prisma.user.upsert({
    where: { id: email },
    create: { id: email, email, passwordHash, isOwner: false, emailVerified: new Date() },
    // Redeeming an invite is a verified round-trip through the address, so it doubles as
    // email verification.
    update: { passwordHash, emailVerified: new Date() },
  })

  await acceptInviteIfPending(membership.ownerId, email)
  bustAccessCache(email)

  return NextResponse.json({ ok: true, email, businessName: membership.businessName })
}
