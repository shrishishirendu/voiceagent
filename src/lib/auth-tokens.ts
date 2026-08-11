import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'

// Single-use tokens for the two out-of-band email flows: accepting an invite (setting a
// first password) and resetting a forgotten one. Both reuse the VerificationToken table.
//
// What goes in the email is a 32-byte random value; what goes in the database is its
// SHA-256 hash. Read access to the DB therefore doesn't hand anyone a working link.
// SHA-256 (not bcrypt) is right here because the secret is already 256 bits of entropy —
// there is nothing to brute-force, so the slow-hash tax buys nothing.

export type TokenPurpose = 'invite' | 'reset'

// Invites are handed out by an admin and may sit in an inbox over a weekend; reset links
// are self-service and should not outlive a single sitting.
const TTL_MS: Record<TokenPurpose, number> = {
  invite: 7 * 24 * 60 * 60 * 1000, // 7 days
  reset: 60 * 60 * 1000, // 1 hour
}

const lc = (s: string) => s.trim().toLowerCase()
const identifierFor = (purpose: TokenPurpose, email: string) => `${purpose}:${lc(email)}`
const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex')

// Issue a token, replacing any outstanding one for the same (purpose, email) so a
// re-sent invite or a second "forgot password" click invalidates the earlier link.
export async function issueToken(purpose: TokenPurpose, email: string): Promise<string> {
  const identifier = identifierFor(purpose, email)
  const raw = randomBytes(32).toString('base64url')

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({
      data: {
        identifier,
        token: hashToken(raw),
        expires: new Date(Date.now() + TTL_MS[purpose]),
      },
    }),
  ])

  return raw
}

// The emailed link carries purpose, email and secret together so the consume step needs
// no extra lookup — and so a token issued for a reset can never be redeemed as an invite.
export function tokenLink(purpose: TokenPurpose, email: string, raw: string): string {
  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3010'
  const path = purpose === 'invite' ? '/invite/accept' : '/reset-password'
  return `${base}${path}?email=${encodeURIComponent(lc(email))}&token=${encodeURIComponent(raw)}`
}

// Check a token WITHOUT redeeming it, so the accept/reset page can greet the recipient by
// company name (or say the link is dead) before they type a password. Safe to expose over
// HTTP: it demands the secret, so it tells a caller nothing they didn't already hold.
export async function peekToken(
  purpose: TokenPurpose,
  email: string,
  raw: string
): Promise<boolean> {
  if (!email || !raw) return false
  const row = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier: identifierFor(purpose, email), token: hashToken(raw) } },
  })
  return !!row && row.expires.getTime() >= Date.now()
}

// Redeem a token. Returns the email it was issued to, or null if it is unknown, expired,
// or already used. The delete is the atomic step — whichever caller's deleteMany reports
// a row is the one that redeemed it, so two concurrent clicks can't both succeed.
export async function consumeToken(
  purpose: TokenPurpose,
  email: string,
  raw: string
): Promise<string | null> {
  if (!email || !raw) return null
  const identifier = identifierFor(purpose, email)
  const hashed = hashToken(raw)

  const row = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier, token: hashed } },
  })
  if (!row) return null

  // findUnique already matched on the hash; this is belt-and-braces against a future
  // refactor that switches to a scan-and-compare lookup.
  const a = Buffer.from(row.token)
  const b = Buffer.from(hashed)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const { count } = await prisma.verificationToken.deleteMany({
    where: { identifier, token: hashed },
  })
  if (count === 0) return null // lost the race to a concurrent redemption
  if (row.expires.getTime() < Date.now()) return null

  return lc(email)
}

// Drop an outstanding token without redeeming it — used when an invite is revoked so the
// already-emailed link stops working immediately.
export async function revokeTokens(purpose: TokenPurpose, email: string): Promise<void> {
  await prisma.verificationToken.deleteMany({ where: { identifier: identifierFor(purpose, email) } })
}
