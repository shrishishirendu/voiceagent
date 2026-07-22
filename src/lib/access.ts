import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { hasTenant } from '@/lib/tenant'
import { findMembershipByEmail } from '@/lib/members'

// Central access resolution for every authenticated API route, mirroring EnvoyIn's
// lib/access.js. The session only tells us the signed-in email; this maps it to the
// workspace it operates on:
//   - has their own tenant row        → owner of their own workspace
//   - member of someone else's tenant → that workspace's ownerId + their role/scope
//   - neither                         → treated as a brand-new owner (new-owner fallback)
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

export type Role = 'viewer' | 'agent' | 'admin' | 'owner'

export type Access = {
  email: string
  ownerId: string
  role: Role
  categories: string[] | null
  memberId?: string
  businessName?: string | null
  pendingInvite?: boolean
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, agent: 1, admin: 2, owner: 3 }

// Per-instance micro-cache so a burst of API calls from one page load doesn't re-run
// the workspace lookups every time. Mutations should bust it (bustAccessCache).
const CACHE_TTL_MS = 30 * 1000
const accessCache = new Map<string, { access: Access; ts: number }>()

export function bustAccessCache(email: string | null = null): void {
  if (email) accessCache.delete(email)
  else accessCache.clear()
}

export async function resolveAccess(): Promise<Access | null> {
  const session = await auth()
  const email = session?.user?.id
  if (!email) return null

  const cached = accessCache.get(email)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.access

  let access: Access
  if (await hasTenant(email)) {
    access = { email, ownerId: email, role: 'owner', categories: null }
  } else {
    const membership = await findMembershipByEmail(email)
    access = membership
      ? {
          email,
          ownerId: membership.ownerId,
          role: membership.member.role,
          categories: membership.member.categories ?? null,
          memberId: membership.member.id,
          businessName: membership.businessName,
          pendingInvite: !membership.member.accepted_at,
        }
      : { email, ownerId: email, role: 'owner', categories: null } // new-owner fallback
  }

  accessCache.set(email, { access, ts: Date.now() })
  return access
}

export function hasRole(access: Access | null, minRole: Role): boolean {
  return !!access && ROLE_RANK[access.role] >= ROLE_RANK[minRole]
}

export function forbidden(message = 'You do not have permission to do that') {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

// ── Field-level trimming (Phase 1 stubs; filled in Phase 3-C) ────────────────
// Non-admins must not see payment/banking + contact PII on Customer/Invoice. For now
// these are identity passthroughs so callers can already route responses through them.
const CAN_SEE_SENSITIVE: Role[] = ['admin', 'owner']

export function canSeeSensitive(access: Access | null): boolean {
  return !!access && CAN_SEE_SENSITIVE.includes(access.role)
}

export function trimCustomerForAccess<T>(customer: T, _access: Access | null): T {
  // Phase 3-C: strip contactPhone/email/abn/creditLimit for non-admins.
  return customer
}

export function trimInvoiceForAccess<T>(invoice: T, _access: Access | null): T {
  // Phase 3-C: strip bankName/bsb/accountNumber/swiftCode/remittance for non-admins.
  return invoice
}
