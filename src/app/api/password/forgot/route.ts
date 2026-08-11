import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { issueToken, tokenLink } from '@/lib/auth-tokens'
import { sendPasswordResetEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

// Request a password-reset link. Runs signed out (see PUBLIC_ROUTES in src/middleware.ts).
//
// The response is ALWAYS the same regardless of whether the address exists, so this
// endpoint can't be used to enumerate who has an account. Unlike /api/signup — where a
// vague error would strand a real user — there is no cost to being opaque here: the
// person who owns the address gets the email either way.
const Schema = z.object({ email: z.string().trim().email().max(200) })

const SAME_ANSWER = {
  ok: true,
  message: 'If an account exists for that address, a reset link is on its way.',
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json(SAME_ANSWER)

  const email = parsed.data.email.toLowerCase()
  const user = await prisma.user.findUnique({
    where: { id: email },
    select: { passwordHash: true },
  })

  // Only send to accounts that can actually sign in. An invited-but-not-accepted user has
  // no password to reset — their route back in is the invite link, not this one.
  if (user?.passwordHash) {
    const raw = await issueToken('reset', email)
    try {
      await sendPasswordResetEmail(email, tokenLink('reset', email, raw))
    } catch (err) {
      // Swallow rather than surfacing: a delivery failure that changed the response would
      // reintroduce exactly the enumeration signal this endpoint is shaped to avoid.
      console.error('[password/forgot] send failed', err)
    }
  }

  return NextResponse.json(SAME_ANSWER)
}
