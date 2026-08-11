import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import authConfig from '@/auth.config'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/passwords'

// Full (Node-runtime) NextAuth config: email + password only.
//
// There is no adapter. Adapters exist to persist OAuth accounts and sessions; with a
// credentials provider and JWT sessions neither is needed — User rows are created
// explicitly by /api/signup and by the invite flow, which is exactly where the extra
// company/membership rules have to be enforced anyway.
//
// The session identity is ALWAYS the lowercased email, because `User.id` doubles as
// `ownerId` on every tenant-scoped table.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: 'password',
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(creds) {
        const email = creds?.email?.toString().trim().toLowerCase()
        const password = creds?.password?.toString()
        if (!email || !password) return null

        const user = await prisma.user.findUnique({
          where: { id: email },
          select: { id: true, email: true, name: true, passwordHash: true },
        })

        // verifyPassword still runs bcrypt when passwordHash is null (invited but not yet
        // accepted), so that case isn't distinguishable by response time from a wrong
        // password. Returning null for every failure means the UI can only show one
        // generic message, which is what stops this being an account-existence oracle.
        const ok = await verifyPassword(password, user?.passwordHash ?? null)
        if (!user || !ok) return null

        return { id: user.id, email: user.email, name: user.name }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.sub = user.id ?? undefined
      return token
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub
      return session
    },
  },
})
