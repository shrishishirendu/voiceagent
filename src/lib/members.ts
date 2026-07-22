import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'

// Workspace members, mirroring EnvoyIn's lib/members.js. Members live in the tenant
// row's `members` jsonb (not their own table), so a workspace's team travels with its
// config. The signed-in OWNER is implicit (never in the array); everyone else is a
// member with a role + optional category scope. resolveAccess() maps a signed-in email
// to the (owner workspace, role) it belongs to via findMembershipByEmail().

export const MEMBER_ROLES = ['admin', 'agent', 'viewer'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export type Member = {
  id: string
  email: string
  role: MemberRole
  categories: string[] | null
  accepted_at?: string | null
  invited_by?: string | null
  created_at?: string
}

export type Membership = {
  ownerId: string
  businessName: string | null
  member: Member
}

const lc = (s: string) => s.trim().toLowerCase()

function readMembers(raw: Prisma.JsonValue | null | undefined): Member[] {
  if (!Array.isArray(raw)) return []
  return (raw as unknown[]).filter((m): m is Member => !!m && typeof m === 'object' && 'email' in m)
}

// Find the workspace a signed-in email is a MEMBER of (not owner). Scans every tenant's
// `members` jsonb for the email via Postgres jsonb containment (`members @> [{email}]`).
// A given email is only ever a member of one workspace here, so the first hit wins.
export async function findMembershipByEmail(email: string): Promise<Membership | null> {
  const lower = lc(email)
  const rows = await prisma.tenant.findMany({
    where: { members: { array_contains: [{ email: lower }] } },
    select: { ownerId: true, businessName: true, members: true },
  })
  for (const row of rows) {
    const member = readMembers(row.members).find((m) => lc(m.email) === lower)
    if (member) return { ownerId: row.ownerId, businessName: row.businessName, member }
  }
  return null
}

export async function listMembers(ownerId: string): Promise<Member[]> {
  const row = await prisma.tenant.findUnique({ where: { ownerId }, select: { members: true } })
  return readMembers(row?.members)
}

// Read-modify-write the tenant's members jsonb inside a transaction so concurrent
// invite/role edits don't clobber each other.
async function mutateMembers(
  ownerId: string,
  fn: (members: Member[]) => Member[]
): Promise<Member[]> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.tenant.findUnique({ where: { ownerId }, select: { members: true } })
    if (!row) throw new Error('No tenant for owner')
    const next = fn(readMembers(row.members))
    await tx.tenant.update({ where: { ownerId }, data: { members: next as unknown as Prisma.InputJsonValue } })
    return next
  })
}

export type InviteInput = { email: string; role: MemberRole; categories?: string[] | null }

// Add a member (invite). Returns the new member, or null if the email is already the
// owner or an existing member. accepted_at stays null until they first sign in.
export async function addMember(ownerId: string, input: InviteInput): Promise<Member | null> {
  const email = lc(input.email)
  if (email === lc(ownerId)) return null // owner is implicit, never a member of itself
  let created: Member | null = null
  await mutateMembers(ownerId, (members) => {
    if (members.some((m) => lc(m.email) === email)) return members // already a member — no-op
    created = {
      id: randomUUID(),
      email,
      role: input.role,
      categories: input.categories ?? null,
      accepted_at: null,
      invited_by: lc(ownerId),
      created_at: new Date().toISOString(),
    }
    return [...members, created]
  })
  return created
}

export async function updateMember(
  ownerId: string,
  memberId: string,
  patch: { role?: MemberRole; categories?: string[] | null }
): Promise<Member | null> {
  let updated: Member | null = null
  await mutateMembers(ownerId, (members) =>
    members.map((m) => {
      if (m.id !== memberId) return m
      updated = { ...m, ...(patch.role ? { role: patch.role } : {}), ...(patch.categories !== undefined ? { categories: patch.categories } : {}) }
      return updated
    })
  )
  return updated
}

export async function removeMember(ownerId: string, memberId: string): Promise<boolean> {
  let removed = false
  await mutateMembers(ownerId, (members) => {
    const next = members.filter((m) => m.id !== memberId)
    removed = next.length !== members.length
    return next
  })
  return removed
}

// Mark a member's invite accepted on first successful sign-in (accepted_at was null).
export async function acceptInviteIfPending(ownerId: string, email: string): Promise<void> {
  const lower = lc(email)
  await mutateMembers(ownerId, (members) =>
    members.map((m) => (lc(m.email) === lower && !m.accepted_at ? { ...m, accepted_at: new Date().toISOString() } : m))
  )
}
