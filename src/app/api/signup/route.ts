import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hashPassword, passwordProblem } from '@/lib/passwords'
import { findMembershipByEmail } from '@/lib/members'
import { hasTenant } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// Self-serve company signup — the ONLY way a new workspace comes into existence.
// Runs signed out (see PUBLIC_ROUTES in src/middleware.ts).
//
// This creates the identity (a User row with isOwner: true) but NOT the Tenant row.
// The company itself is created by the existing onboarding wizard, which the /app layout
// gate routes them into next; duplicating company setup here would mean two places that
// can create a tenant. `businessName` is only carried through to prefill that wizard.
const Schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
  businessName: z.string().trim().min(1).max(200),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please fill in your name, work email, company name, and a password.' },
      { status: 400 }
    )
  }

  const email = parsed.data.email.toLowerCase()
  const pwProblem = passwordProblem(parsed.data.password)
  if (pwProblem) return NextResponse.json({ error: pwProblem }, { status: 400 })

  // An address that already owns a workspace can never sign up again, password or not —
  // a second signup would silently orphan the existing company's data.
  if (await hasTenant(email)) {
    return NextResponse.json(
      {
        error: 'That email already owns a workspace. Log in, or use "Forgot password" if you can\'t get in.',
        code: 'exists',
      },
      { status: 409 }
    )
  }

  const existing = await prisma.user.findUnique({
    where: { id: email },
    select: { passwordHash: true },
  })
  if (existing) {
    // Deliberately explicit rather than vague. Signup is not a place where account
    // enumeration matters much (anyone can test an address by trying to sign up), and a
    // vague error here strands people who genuinely already have an account.
    return NextResponse.json(
      existing.passwordHash
        ? { error: 'An account with that email already exists. Log in instead.', code: 'exists' }
        : {
            error: 'You have a pending invite for that email. Check your inbox for the link to set your password.',
            code: 'invited',
          },
      { status: 409 }
    )
  }

  // Someone on a team roster must not be able to spin up a second workspace under the
  // same address — their identity has to stay attached to the company that invited them.
  const membership = await findMembershipByEmail(email)
  if (membership) {
    return NextResponse.json(
      {
        error: `That email has been invited to ${membership.businessName || 'an existing workspace'}. Check your inbox for the invite link.`,
        code: 'invited',
      },
      { status: 409 }
    )
  }

  await prisma.user.create({
    data: {
      id: email,
      email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
      isOwner: true,
      emailVerified: null,
    },
  })

  // The client signs in with the credentials it already holds, then follows the
  // onboarding gate. Returning the business name lets it prefill the wizard.
  return NextResponse.json({ ok: true, email, businessName: parsed.data.businessName })
}
