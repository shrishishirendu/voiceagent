import Google from 'next-auth/providers/google'
import Credentials from 'next-auth/providers/credentials'
import type { NextAuthConfig } from 'next-auth'

// Edge-safe config ONLY (Google provider + optional dev-login + sign-in page). No adapter,
// no Node-only imports (Prisma/Resend) — src/middleware.ts builds its own NextAuth instance
// from THIS file alone so the Node-only adapter never gets pulled into the Edge bundle.
const providers: NextAuthConfig['providers'] = [
  Google({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }),
]

// Dev-only "sign in as any email" bypass — skips the magic-link/Google flow so you can get
// into the app locally without configuring Resend or a Google OAuth client. The returned
// `id` becomes the ownerId (= lowercased email), exactly like the real providers, so it lands
// in the same workspace. Gated on `!VERCEL` (never set in local dev / Docker, always set on
// any Vercel deployment) so it can never leak into the real hosted app, PLUS an explicit
// ALLOW_DEV_LOGIN=1 opt-in.
if (!process.env.VERCEL && process.env.ALLOW_DEV_LOGIN === '1') {
  providers.push(
    Credentials({
      id: 'dev-login',
      name: 'Dev login',
      credentials: { email: { label: 'Email', type: 'email' } },
      authorize(creds) {
        const email = creds?.email?.toString().trim().toLowerCase()
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null
        return { id: email, email }
      },
    })
  )
}

export default {
  providers,
  pages: {
    signIn: '/login',
  },
  // Local dev / self-hosted has no Vercel host auto-trust; harmless when set locally.
  trustHost: true,
} satisfies NextAuthConfig
