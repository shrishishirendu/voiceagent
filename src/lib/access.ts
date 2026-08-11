import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { hasTenant } from '@/lib/tenant'
import { findMembershipByEmail } from '@/lib/members'
import { atLeast, canSeeSensitiveFields, type Role } from '@/lib/permissions'

// Central access resolution for every authenticated API route, mirroring EnvoyIn's
// lib/access.js. The session only tells us the signed-in email; this maps it to the
// workspace it operates on:
//   - has their own tenant row        → owner of their own workspace
//   - member of someone else's tenant → that workspace's ownerId + their role/scope
//   - neither, but User.isOwner       → an owner mid-signup, still to run onboarding
//   - neither                         → NO ACCESS
//
// That last case used to fall through to "treat them as a brand-new owner", which meant
// any authenticated email with no workspace silently became the owner of a fresh empty
// tenant. With self-serve signup that is actively wrong: an employee who was never
// invited (or who mistyped their address) would land in their own private workspace
// instead of being told they have no access. Creating a company is now an explicit act
// — /api/signup sets User.isOwner — and everyone else must be invited.
//
// Enforcement lives HERE in route handlers, NOT in middleware — middleware runs on the
// Edge runtime and gating there would mean a DB round-trip on every request. Routes
// already hit the DB, so one extra small (briefly cached) lookup is the cheaper place.
//
// role semantics:
//   owner  — the workspace account; everything, incl. per-tenant credentials/phone
//   admin  — everything except owner-only account settings
//   agent  — dispatch calls, work tickets, view customers/invoices
//   viewer — read-only dashboards; payment/contact fields hidden (Phase 3-C)
// categories: null = all; [ids] = scoped (outbound skips category scoping for now).

// Role/rank and the capability predicates live in lib/permissions.ts — a pure module with
// no server-only imports, so the client sidebar is gated by the same definitions these
// route handlers enforce. Re-exported here so existing `import { Role } from '@/lib/access'`
// call sites keep working.
export type { Role } from '@/lib/permissions'

export type Access = {
  email: string
  ownerId: string
  role: Role
  categories: string[] | null
  memberId?: string
  businessName?: string | null
  pendingInvite?: boolean
}

// Per-instance micro-cache so a burst of API calls from one page load doesn't re-run
// the workspace lookups every time. Mutations should bust it (bustAccessCache).
const CACHE_TTL_MS = 30 * 1000
const accessCache = new Map<string, { access: Access; ts: number }>()

export function bustAccessCache(email: string | null = null): void {
  if (email) accessCache.delete(email)
  else accessCache.clear()
}

// Why a signed-in request still got no access — lets callers tell "not signed in"
// (send them to /login) apart from "signed in, but attached to no company" (send them
// to /no-workspace, where the message is actionable instead of a confusing login loop).
export type AccessDenial = 'unauthenticated' | 'no-workspace'

export type AccessResult = { access: Access; denial?: never } | { access: null; denial: AccessDenial }

export async function resolveAccessResult(): Promise<AccessResult> {
  const session = await auth()
  const email = session?.user?.id
  if (!email) return { access: null, denial: 'unauthenticated' }

  const cached = accessCache.get(email)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return { access: cached.access }

  let access: Access | null
  if (await hasTenant(email)) {
    access = { email, ownerId: email, role: 'owner', categories: null }
  } else {
    const membership = await findMembershipByEmail(email)
    if (membership) {
      access = {
        email,
        ownerId: membership.ownerId,
        role: membership.member.role,
        categories: membership.member.categories ?? null,
        memberId: membership.member.id,
        businessName: membership.businessName,
        pendingInvite: !membership.member.accepted_at,
      }
    } else {
      // No tenant and no membership. Only someone who explicitly signed up to create a
      // company may proceed — they are an owner who hasn't finished onboarding yet, and
      // the /app layout gate will route them there. Anyone else is refused.
      const user = await prisma.user.findUnique({ where: { id: email }, select: { isOwner: true } })
      access = user?.isOwner ? { email, ownerId: email, role: 'owner', categories: null } : null
    }
  }

  if (!access) return { access: null, denial: 'no-workspace' }

  accessCache.set(email, { access, ts: Date.now() })
  return { access }
}

// Convenience wrapper for the many call sites that only care whether access exists.
export async function resolveAccess(): Promise<Access | null> {
  const { access } = await resolveAccessResult()
  return access
}

export function hasRole(access: Access | null, minRole: Role): boolean {
  return atLeast(access?.role, minRole)
}

// Guard for routes whose permission is a named capability rather than a rank threshold
// (see lib/permissions.ts). Returns a 403 response to return directly, or null to proceed.
// Takes a non-null Access so callers do their own `if (!access) return unauthorized()`
// first — that keeps TypeScript's narrowing intact for the rest of the handler.
export function requireCapability(
  access: Access,
  can: (r?: Role | null) => boolean,
  message?: string
): NextResponse | null {
  return can(access.role) ? null : forbidden(message)
}

export function forbidden(message = 'You do not have permission to do that') {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

// ── Field-level trimming (Phase 3-C) ─────────────────────────────────────────
// Viewers and agents must not see payment/banking details or contact PII. Only
// admin/owner get the full record; everyone else gets a copy with the sensitive
// keys deleted. Trimming happens in the API layer (before serialisation) so the
// wire never carries what the role isn't allowed to see — not just hidden in the UI.
// The role test itself is canSeeSensitiveFields in lib/permissions.ts, so the UI can ask
// the same question without duplicating the rule.

// Banking / remittance fields that appear on Invoice and (as a snapshot) on Call.
const BANKING_KEYS = ['bankName', 'bsb', 'accountNumber', 'swiftCode', 'remittanceName', 'remittanceContact'] as const
// Customer contact PII + commercial-sensitivity fields.
const CUSTOMER_PII_KEYS = ['contactPhone', 'email', 'email1', 'email2', 'abn', 'creditLimit'] as const

export function canSeeSensitive(access: Access | null): boolean {
  return canSeeSensitiveFields(access?.role)
}

function stripKeys<T extends Record<string, unknown>>(obj: T, keys: readonly string[]): T {
  const copy = { ...obj }
  for (const k of keys) if (k in copy) delete (copy as Record<string, unknown>)[k]
  return copy
}

export function trimCustomerForAccess<T extends Record<string, unknown>>(customer: T, access: Access | null): T {
  if (canSeeSensitive(access)) return customer
  return stripKeys(customer, CUSTOMER_PII_KEYS)
}

export function trimInvoiceForAccess<T extends Record<string, unknown>>(invoice: T, access: Access | null): T {
  if (canSeeSensitive(access)) return invoice
  return stripKeys(invoice, BANKING_KEYS)
}

// A Call row carries the same banking snapshot fields as an Invoice.
export function trimCallForAccess<T extends Record<string, unknown>>(call: T, access: Access | null): T {
  if (canSeeSensitive(access)) return call
  return stripKeys(call, BANKING_KEYS)
}
