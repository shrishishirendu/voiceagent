import { NextResponse } from 'next/server'
import NextAuth from 'next-auth'
import authConfig from '@/auth.config'

// Middleware runs on the Edge runtime and only needs to decode the session JWT — it
// must NOT pull in the full auth.ts config (Prisma + bcrypt are Node-only), so it builds
// its own minimal NextAuth instance from the edge-safe authConfig alone.
const { auth } = NextAuth(authConfig)

// Unauthenticated by necessity:
//   - the Vapi webhook (raw POST, no session — tenant resolved from call.ownerId)
//   - the cron dispatch endpoint (guarded by the CRON_SECRET header instead of a session)
//   - NextAuth's own routes
//   - the pre-session account endpoints: creating a company, redeeming an invite, and
//     requesting/completing a password reset all necessarily happen while signed out.
//     Each enforces its own rules (token validity, duplicate-email checks) internally.
const PUBLIC_ROUTES = [
  '/api/calls/webhook',
  '/api/cron/dispatch',
  '/api/auth',
  '/api/signup',
  '/api/invite/accept',
  '/api/password/forgot',
  '/api/password/reset',
]

export default auth((req) => {
  const { pathname } = req.nextUrl

  if (PUBLIC_ROUTES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  if (!req.auth) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', req.nextUrl.origin))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/app/:path*', '/onboarding/:path*', '/api/:path*'],
}
