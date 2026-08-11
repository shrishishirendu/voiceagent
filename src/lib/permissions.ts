// The role matrix, in one place, with NO server-only imports — so the sidebar (client)
// and the API routes (server) are gated by the same definitions instead of two lists that
// drift apart.
//
// Hiding a nav item is a courtesy, not a control: every capability below is ALSO enforced
// server-side in the route handler, because a hidden button is still a reachable URL.

export type Role = 'viewer' | 'agent' | 'admin' | 'owner'

export const ROLE_RANK: Record<Role, number> = { viewer: 0, agent: 1, admin: 2, owner: 3 }

export function atLeast(role: Role | null | undefined, min: Role): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min]
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  agent: 'Agent',
  viewer: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'The account holder. Everything, including billing, credentials and caller ID.',
  admin: 'Everything except owner-only account settings.',
  agent: 'Dispatch calls, work the queue, edit customers and invoices. No banking or contact details.',
  viewer: 'Read-only dashboards and reports. No banking or contact details.',
}

// ── Capabilities ─────────────────────────────────────────────────────────────
// Named for the action, not the screen, so a route can ask the question it actually
// cares about rather than re-deriving it from a rank comparison inline.

/** Place calls, queue invoices, work tickets — the day-to-day operational work. */
export const canDispatch = (r?: Role | null) => atLeast(r, 'agent')

/** Upload/ingest invoices and edit customer records. */
export const canEditRecords = (r?: Role | null) => atLeast(r, 'agent')

/** See the payments ledger. Agents need it so they don't chase an already-settled debt. */
export const canViewPayments = (r?: Role | null) => atLeast(r, 'agent')

/** Record a payment against an invoice — moves money on the ledger. Admin and above. */
export const canRecordPayment = (r?: Role | null) => atLeast(r, 'admin')

/** Change scheduler/business-hours config for the whole workspace. */
export const canManageSettings = (r?: Role | null) => atLeast(r, 'admin')

/** Invite, re-role, or remove teammates. */
export const canManageTeam = (r?: Role | null) => atLeast(r, 'admin')

/** Per-tenant Vapi/Twilio credentials and outbound caller ID. Owner only. */
export const canManageCredentials = (r?: Role | null) => r === 'owner'

/** See banking details and customer contact PII. Mirrors access.ts's trim* functions. */
export const canSeeSensitiveFields = (r?: Role | null) => atLeast(r, 'admin')

// ── Navigation ───────────────────────────────────────────────────────────────
// Which sidebar entries each role gets. Everything not listed here is visible to all.

const NAV_MIN_ROLE: Record<string, Role> = {
  invoices: 'agent', // uploading/queuing invoices is operational work
  queue: 'agent',
  payments: 'agent', // readable by agents; recording one is admin+ (canRecordPayment)
  settings: 'admin', // scheduler config, team, credentials
}

export function canSeeNav(role: Role | null | undefined, navId: string): boolean {
  const min = NAV_MIN_ROLE[navId]
  return min ? atLeast(role, min) : true
}
