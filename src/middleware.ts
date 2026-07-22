import { NextResponse } from 'next/server'
import NextAuth from 'next-auth'
import authConfig from '@/auth.config'

// Middleware runs on the Edge runtime and only needs to decode the session JWT — it
// must NOT pull in the full auth.ts config (the Prisma adapter + Resend are Node-only),
// so it builds its own minimal NextAuth instance from the edge-safe authConfig alone.
// Mirrors EnvoyIn's middleware.js.
const { auth } = NextAuth(authConfig)

// Unauthenticated by necessity: the Vapi webhook (raw POST, no session — tenant is
// resolved from the Call row via call.ownerId), the cron dispatch endpoint (guarded by
// CRON_SECRET header instead of a session), and NextAuth's own routes.
const PUBLIC_ROUTES = ['/api/calls/webhook', '/api/cron/dispatch', '/api/auth']

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
