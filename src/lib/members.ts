// Workspace members, mirroring EnvoyIn's lib/members.js. Members live in the tenant
// row's `members` jsonb (not their own table). Phase 1 ships the shape + a no-op
// lookup so resolveAccess() and the magic-link provider match EnvoyIn's structure;
// Phase 3 (Team & Access) fills in real invite/list/role management.

export const MEMBER_ROLES = ['admin', 'agent', 'viewer'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export type Member = {
  id: string
  email: string
  role: MemberRole
  categories: string[] | null
  accepted_at?: string | null
  invited_by?: string | null
}

export type Membership = {
  ownerId: string
  businessName: string | null
  member: Member
}

// Phase 1: single-tenant-per-owner only — nobody is a member of someone else's
// workspace yet, so this always returns null and resolveAccess() falls back to
// treating the signed-in email as its own workspace owner. Phase 3 replaces this with
// a real jsonb-containment lookup over tenant.members.
export async function findMembershipByEmail(_email: string): Promise<Membership | null> {
  return null
}
