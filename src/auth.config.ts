import Google from 'next-auth/providers/google'
import type { NextAuthConfig } from 'next-auth'

// Edge-safe config ONLY (Google provider + sign-in page). No adapter, no Node-only
// imports (Prisma/Resend) — src/middleware.ts builds its own NextAuth instance from
// THIS file alone so the Node-only adapter never gets pulled into the Edge bundle.
export default {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: '/login',
  },
} satisfies NextAuthConfig
