import 'dotenv/config'
import { prisma } from '../src/lib/prisma'

// Snapshot of who can currently sign in and which workspace they resolve to. Handy after
// the password-auth migration, where "has a User row" and "can log in" stopped being the
// same thing (an invited user has a row but no passwordHash).
async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, isOwner: true, passwordHash: true, emailVerified: true },
    orderBy: { id: 'asc' },
  })
  const tenants = await prisma.tenant.findMany({
    select: { ownerId: true, businessName: true, members: true },
    orderBy: { ownerId: 'asc' },
  })
  const tokens = await prisma.verificationToken.findMany({
    select: { identifier: true, expires: true },
  })

  console.log(`\nUSERS (${users.length})`)
  for (const u of users) {
    const state = u.passwordHash ? 'can sign in' : 'INVITED — no password yet'
    console.log(`  ${u.id}  [${u.isOwner ? 'owner' : 'member'}]  ${state}`)
  }

  console.log(`\nTENANTS (${tenants.length})`)
  for (const t of tenants) {
    const members = Array.isArray(t.members) ? (t.members as { email: string; role: string; accepted_at?: string | null }[]) : []
    console.log(`  ${t.ownerId}  "${t.businessName ?? '—'}"  members=${members.length}`)
    for (const m of members) {
      console.log(`      - ${m.email} (${m.role}) ${m.accepted_at ? 'accepted' : 'PENDING'}`)
    }
  }

  console.log(`\nOUTSTANDING TOKENS (${tokens.length})`)
  for (const t of tokens) console.log(`  ${t.identifier}  expires ${t.expires.toISOString()}`)
  console.log()
}

main().finally(() => prisma.$disconnect())
