import { NextResponse } from 'next/server'
import { resolveAccess, canSeeSensitive, unauthorized } from '@/lib/access'

export const dynamic = 'force-dynamic'

// The signed-in identity + effective permissions, for client-side UI gating (hide the
// Team tab / banking columns for non-admins, etc.). Server routes still enforce their
// own checks — this is only so the UI doesn't render controls the role can't use.
export async function GET() {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  return NextResponse.json({
    email: access.email,
    ownerId: access.ownerId,
    role: access.role,
    businessName: access.businessName ?? null,
    categories: access.categories,
    pendingInvite: access.pendingInvite ?? false,
    canSeeSensitive: canSeeSensitive(access),
    isOwnerOrAdmin: access.role === 'owner' || access.role === 'admin',
  })
}
