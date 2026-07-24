import NextAuth from 'next-auth'
import authConfig from '@/auth.config'
import { PrismaAuthAdapter } from '@/lib/auth-adapter'
import { MagicLinkProvider } from '@/lib/email-provider'

// Full (Node-runtime) NextAuth config. Mirrors EnvoyIn's auth.js: Google +
// magic-link + a custom adapter that forces user.id = lowercased email, JWT sessions.
// The callbacks force the session identity to the lowercased email so Google and
// magic-link sign-ins for the same person resolve to the same owner_id / workspace.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAuthAdapter(),
  // MagicLinkProvider is typed loosely (email provider shape) — cast through the
  // provider list, matching how EnvoyIn spreads it into authConfig.providers.
  providers: [...authConfig.providers, MagicLinkProvider() as never],
  session: { strategy: 'jwt' },
  callbacks: {
    jwt({ token, user, account, profile }) {
      if (user) token.sub = user.id ?? undefined
      else if (account && profile) token.sub = (profile.email || '').toLowerCase()
      return token
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub
      return session
    },
  },
})
