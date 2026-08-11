import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { hashPassword, passwordProblem } from '../src/lib/passwords'
import { hasTenant } from '../src/lib/tenant'

// One-off backfill for workspaces that predate password auth.
//
// Before this change, sign-in was Google/magic-link, so existing owners have a Tenant row
// full of real data but a User row with no passwordHash — which under password-only auth
// means they cannot get in. This gives such an owner a password without touching their
// data. It is also the escape hatch if an owner is ever locked out entirely (no working
// email, so "Forgot password" can't reach them).
//
//   npx tsx scripts/set-owner-password.ts <email> <password>
//
// Runs against whatever DATABASE_URL points at, so check your .env before using it.
async function main() {
  const [emailArg, password] = process.argv.slice(2)
  if (!emailArg || !password) {
    console.error('Usage: npx tsx scripts/set-owner-password.ts <email> <password>')
    process.exit(1)
  }

  const email = emailArg.trim().toLowerCase()
  const problem = passwordProblem(password)
  if (problem) {
    console.error(problem)
    process.exit(1)
  }

  const owns = await hasTenant(email)
  if (!owns) {
    // Refuse rather than inventing an owner: creating one here would sidestep the whole
    // "companies are created deliberately" rule this migration is built around.
    console.error(
      `No workspace is owned by ${email}. This script only sets a password for an EXISTING owner.\n` +
        `Use /signup to create a new company, or invite the address from Settings → Team.`
    )
    process.exit(1)
  }

  await prisma.user.upsert({
    where: { id: email },
    create: {
      id: email,
      email,
      passwordHash: await hashPassword(password),
      isOwner: true,
      emailVerified: new Date(),
    },
    update: { passwordHash: await hashPassword(password), isOwner: true },
  })

  console.log(`✔ ${email} can now log in with that password (owner of their existing workspace).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
