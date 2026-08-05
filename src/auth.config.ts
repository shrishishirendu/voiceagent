import type { NextAuthConfig } from 'next-auth'

// Edge-safe config ONLY. src/middleware.ts builds its own NextAuth instance from THIS
// file alone, and middleware runs on the Edge runtime — so nothing Node-only (Prisma,
// bcrypt, Resend) may be reachable from here, directly or transitively.
//
// `providers` is deliberately EMPTY. The real credentials provider needs Prisma + bcrypt
// to check a password, so it is registered in src/auth.ts (Node runtime) instead. That
// costs middleware nothing: middleware only decodes the session JWT to decide
// signed-in vs signed-out, which is provider-independent.
export default {
  providers: [],
  pages: {
    signIn: '/login',
  },
  session: { strategy: 'jwt' },
  // Local dev / self-hosted has no Vercel host auto-trust; harmless when set locally.
  trustHost: true,
} satisfies NextAuthConfig
