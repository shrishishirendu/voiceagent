import 'server-only'
import { redirect } from 'next/navigation'
import { resolveAccessResult } from '@/lib/access'
import type { Role } from '@/lib/permissions'

// Server-side gate for a route segment whose page component is a client component (and so
// can't check the session itself). Used from a tiny layout.tsx beside the page.
//
// This is the enforcement; hiding the sidebar item is not. Without it, a viewer who types
// /app/payments would still get the page shell and only see failures once its fetches
// 403'd — a confusing broken screen rather than a clear redirect.
export async function requirePageAccess(can: (r?: Role | null) => boolean): Promise<Role> {
  const { access, denial } = await resolveAccessResult()
  if (!access) redirect(denial === 'no-workspace' ? '/no-workspace' : '/login')
  // Bounce to the one screen every role can see, rather than a dead end.
  if (!can(access.role)) redirect('/app/dashboard')
  return access.role
}
