import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAccess, hasRole, unauthorized, forbidden } from '@/lib/access'
import { getCredentialStatus, saveCredentials } from '@/lib/credentials'

export const dynamic = 'force-dynamic'

// Per-tenant outbound credentials + caller-id (Phase 3-G). Owner-only — credentials are
// owner-only account settings (admins manage the team but not the account's keys). GET
// returns presence/masking only; raw secrets never leave the server.
export async function GET() {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  if (!hasRole(access, 'owner')) return forbidden()
  return NextResponse.json(await getCredentialStatus(access.ownerId))
}

const SaveSchema = z.object({
  vapiPrivateKey: z.string().max(400).optional(),
  twilioAccountSid: z.string().max(200).optional(),
  twilioAuthToken: z.string().max(400).optional(),
  anthropicKey: z.string().max(400).optional(),
  phoneNumber: z.string().max(40).nullish(),
})

export async function PUT(req: NextRequest) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  if (!hasRole(access, 'owner')) return forbidden()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = SaveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid credentials', details: parsed.error.flatten() }, { status: 400 })
  }
  const { error } = await saveCredentials(access.ownerId, parsed.data)
  if (error) return NextResponse.json({ error }, { status: 409 })
  return NextResponse.json(await getCredentialStatus(access.ownerId))
}
