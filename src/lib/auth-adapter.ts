import type { Adapter, AdapterUser } from 'next-auth/adapters'
import { prisma } from '@/lib/prisma'

// Prisma port of EnvoyIn's SupabaseAuthAdapter. The canonical user id is ALWAYS the
// lowercased email address — this is what lets a Google sign-in and a magic-link
// sign-in for the same person resolve to the same owner_id (and therefore the same
// workspace), instead of Google's opaque `sub` and the adapter's own generated id
// fragmenting one person into two tenants. `user.id` doubles as `ownerId` everywhere.
//
// JWT session strategy → no Session-table methods are needed.

type UserRow = {
  id: string
  email: string
  name: string | null
  image: string | null
  emailVerified: Date | null
}

function toAdapterUser(row: UserRow | null): AdapterUser | null {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified ?? null,
    name: row.name ?? null,
    image: row.image ?? null,
  }
}

export function PrismaAuthAdapter(): Adapter {
  return {
    async createUser(data) {
      const id = data.email.toLowerCase()
      const row = await prisma.user.upsert({
        where: { id },
        create: {
          id,
          email: id,
          name: data.name ?? null,
          image: data.image ?? null,
          emailVerified: data.emailVerified ?? null,
        },
        update: {},
      })
      return toAdapterUser(row) as AdapterUser
    },

    async getUser(id) {
      const row = await prisma.user.findUnique({ where: { id } })
      return toAdapterUser(row)
    },

    async getUserByEmail(email) {
      const row = await prisma.user.findUnique({ where: { id: email.toLowerCase() } })
      return toAdapterUser(row)
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const account = await prisma.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { user: true },
      })
      return toAdapterUser(account?.user ?? null)
    },

    async updateUser(data) {
      const row = await prisma.user.update({
        where: { id: data.id! },
        data: {
          name: data.name ?? undefined,
          image: data.image ?? undefined,
          emailVerified: data.emailVerified ?? undefined,
        },
      })
      return toAdapterUser(row) as AdapterUser
    },

    async linkAccount(account) {
      await prisma.account.upsert({
        where: {
          provider_providerAccountId: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
        },
        create: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          access_token: account.access_token ?? null,
          refresh_token: account.refresh_token ?? null,
          expires_at: account.expires_at ?? null,
          token_type: account.token_type ?? null,
          scope: account.scope ?? null,
          id_token: account.id_token ?? null,
          session_state: account.session_state ? String(account.session_state) : null,
        },
        update: {},
      })
      return account
    },

    async createVerificationToken(data) {
      await prisma.verificationToken.create({
        data: { identifier: data.identifier, token: data.token, expires: data.expires },
      })
      return data
    },

    async useVerificationToken({ identifier, token }) {
      const row = await prisma.verificationToken.findUnique({
        where: { identifier_token: { identifier, token } },
      })
      if (!row) return null
      await prisma.verificationToken.delete({
        where: { identifier_token: { identifier, token } },
      })
      return { identifier: row.identifier, token: row.token, expires: row.expires }
    },
  }
}
