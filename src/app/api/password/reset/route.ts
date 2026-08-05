import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hashPassword, passwordProblem } from '@/lib/passwords'
import { consumeToken, peekToken } from '@/lib/auth-tokens'

export const dynamic = 'force-dynamic'

// Complete a password reset. Runs signed out (see PUBLIC_ROUTES in src/middleware.ts) —
// the single-use token from the email is the credential.
const Schema = z.object({
  email: z.string().trim().email().max(200),
  token: z.string().min(1).max(500),
  password: z.string().min(1).max(200),
})

// Lets the reset page show "this link has expired" up front instead of after the user
// has typed a new password twice.
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email') ?? ''
  const token = req.nextUrl.searchParams.get('token') ?? ''
  return NextResponse.json({ valid: await peekToken('reset', email, token), email: email.toLowerCase() })
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

  const email = await consumeToken('reset', parsed.data.email, parsed.data.token)
  if (!email) {
    return NextResponse.json(
      { error: 'This reset link is invalid, has expired, or has already been used. Request a new one.' },
      { status: 400 }
    )
  }

  const user = await prisma.user.findUnique({ where: { id: email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'That account no longer exists.' }, { status: 400 })

  await prisma.user.update({
    where: { id: email },
    data: { passwordHash: await hashPassword(parsed.data.password) },
  })

  return NextResponse.json({ ok: true, email })
}
