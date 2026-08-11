/**
 * Re-point every row (and every stored PDF) belonging to one owner at another owner.
 *
 *   npx tsx scripts/migrate-owner.ts --from=old@example.com --to=new@example.com
 *   npx tsx scripts/migrate-owner.ts --from=… --to=… --apply      # actually write
 *
 * Defaults to a DRY RUN: it prints exactly what it would change and touches nothing.
 * Pass --apply to commit.
 *
 * Why this is not a one-line UPDATE:
 *
 *  1. `Tenant` and `Settings` are keyed by ownerId (@id), so the destination may already
 *     have one. Two rows cannot merge — the source's config is DROPPED and the
 *     destination's kept, because the destination is the workspace being kept alive.
 *
 *  2. Storage keys are owner-prefixed (`<ownerId>/<file>.pdf`) and `downloadInvoiceFile`
 *     refuses any key outside the caller's prefix. Re-pointing `Invoice.ownerId` without
 *     moving the objects would leave every PDF unreachable — the invoice would render but
 *     its file would 403. So each object is MOVED in the bucket and the row's
 *     `sourceFilePath` rewritten to match, one at a time, so a partial failure leaves
 *     every remaining row still pointing at a file that actually exists.
 *
 *  3. `Location` has @@unique([ownerId, code]), so a code the destination already uses
 *     would throw mid-migration. That is checked up front and reported rather than
 *     discovered halfway through.
 *
 * The DB writes run in a single transaction, so the ownerId reassignment is all-or-nothing.
 * Storage moves happen first and are not transactional — if the run fails after them, the
 * files are already under the new prefix and re-running is safe (a move whose source is
 * missing but whose destination exists is treated as already-done).
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/prisma'

type Args = { from: string; to: string; apply: boolean }

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const hit = argv.find((a) => a.startsWith(`--${flag}=`))
    return hit ? hit.slice(flag.length + 3).trim().toLowerCase() : ''
  }
  const from = get('from')
  const to = get('to')
  if (!from || !to) {
    console.error('Usage: tsx scripts/migrate-owner.ts --from=<email> --to=<email> [--apply]')
    process.exit(2)
  }
  if (from === to) {
    console.error('--from and --to are the same address.')
    process.exit(2)
  }
  return { from, to, apply: argv.includes('--apply') }
}

// Mirrors lib/storage.ts's ownerPrefix — kept in sync deliberately rather than exported,
// since this script also needs the raw client for move(), which storage.ts does not expose.
function ownerPrefix(ownerId: string): string {
  return ownerId.replace(/[^\w.\-@]/g, '_')
}

function storageClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

async function main() {
  const { from, to, apply } = parseArgs()
  const bucket = process.env.SUPABASE_INVOICE_BUCKET ?? 'invoices'

  console.log(`${apply ? 'MIGRATING' : 'DRY RUN —'} ${from}  →  ${to}\n`)

  // ── Pre-flight ─────────────────────────────────────────────────────────────
  const counts = {
    customers: await prisma.customer.count({ where: { ownerId: from } }),
    invoices: await prisma.invoice.count({ where: { ownerId: from } }),
    calls: await prisma.call.count({ where: { ownerId: from } }),
    tickets: await prisma.ticket.count({ where: { ownerId: from } }),
    payments: await prisma.payment.count({ where: { ownerId: from } }),
    notes: await prisma.note.count({ where: { ownerId: from } }),
    salesPeople: await prisma.salesPerson.count({ where: { ownerId: from } }),
    locations: await prisma.location.count({ where: { ownerId: from } }),
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) {
    console.log('Nothing to migrate — source owner has no rows.')
    return
  }
  console.log('Rows to move:')
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(12)} ${v}`)

  // Location code collisions would violate @@unique([ownerId, code]) mid-transaction.
  const [fromLoc, toLoc] = await Promise.all([
    prisma.location.findMany({ where: { ownerId: from }, select: { id: true, code: true } }),
    prisma.location.findMany({ where: { ownerId: to }, select: { code: true } }),
  ])
  const clashes = fromLoc.filter((f) => toLoc.some((t) => t.code === f.code))
  if (clashes.length) {
    console.error(`\n✖ Location code collision: ${clashes.map((c) => c.code).join(', ')}`)
    console.error('  The destination already uses these codes. Rename one side first.')
    process.exit(1)
  }

  const destTenant = await prisma.tenant.findUnique({ where: { ownerId: to } })
  const srcTenant = await prisma.tenant.findUnique({ where: { ownerId: from } })
  if (!destTenant) {
    console.error(`\n✖ ${to} has no Tenant row — it is not a workspace owner. Migrate into an owner.`)
    process.exit(1)
  }
  console.log(`\nTenant: keeping "${destTenant.businessName}"; dropping source "${srcTenant?.businessName ?? '—'}"`)

  // ── Storage ────────────────────────────────────────────────────────────────
  const withFile = await prisma.invoice.findMany({
    where: { ownerId: from, sourceFilePath: { not: null } },
    select: { id: true, invoiceNumber: true, sourceFilePath: true },
  })
  console.log(`\nStored PDFs to re-key: ${withFile.length}`)

  const supabase = storageClient()
  const moved: { id: string; newPath: string }[] = []

  if (withFile.length && !supabase) {
    console.error('✖ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — cannot move the PDFs.')
    console.error('  Refusing to continue: reassigning ownership without moving them would')
    console.error('  leave every invoice pointing at a file its new owner cannot read.')
    process.exit(1)
  }

  const fromPrefix = ownerPrefix(from)
  const toPrefix = ownerPrefix(to)

  for (const inv of withFile) {
    const oldPath = inv.sourceFilePath!
    // Only re-key objects actually under the source prefix; anything else is left alone.
    const rest = oldPath.startsWith(`${fromPrefix}/`) ? oldPath.slice(fromPrefix.length + 1) : null
    if (!rest) {
      console.log(`  ~ ${inv.invoiceNumber}: not under source prefix, left as-is (${oldPath})`)
      continue
    }
    const newPath = `${toPrefix}/${rest}`

    if (!apply) {
      console.log(`  · ${inv.invoiceNumber}: ${oldPath} → ${newPath}`)
      moved.push({ id: inv.id, newPath })
      continue
    }

    const { error } = await supabase!.storage.from(bucket).move(oldPath, newPath)
    if (error) {
      // Re-run tolerance: if the source is gone but the destination is present, a previous
      // run already moved it and the row just needs its path corrected.
      const { data: exists } = await supabase!.storage.from(bucket).download(newPath)
      if (!exists) {
        console.error(`  ✖ ${inv.invoiceNumber}: move failed — ${error.message}`)
        process.exit(1)
      }
      console.log(`  = ${inv.invoiceNumber}: already at destination`)
    } else {
      console.log(`  ✔ ${inv.invoiceNumber}: moved`)
    }
    moved.push({ id: inv.id, newPath })
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to commit.`)
    return
  }

  // ── Database ───────────────────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    const where = { where: { ownerId: from }, data: { ownerId: to } }
    await tx.customer.updateMany(where)
    await tx.invoice.updateMany(where)
    await tx.call.updateMany(where)
    await tx.ticket.updateMany(where)
    await tx.payment.updateMany(where)
    await tx.note.updateMany(where)
    await tx.salesPerson.updateMany(where)
    await tx.location.updateMany(where)

    // Rewrite each moved file's path to its new key.
    for (const m of moved) {
      await tx.invoice.update({ where: { id: m.id }, data: { sourceFilePath: m.newPath } })
    }

    // The source's per-owner config cannot merge into the destination's (both are keyed by
    // ownerId), so it is dropped — the destination workspace's own settings are authoritative.
    await tx.settings.deleteMany({ where: { ownerId: from } })
    await tx.tenant.deleteMany({ where: { ownerId: from } })
  })

  // ── Verify ─────────────────────────────────────────────────────────────────
  const leftovers = {
    customers: await prisma.customer.count({ where: { ownerId: from } }),
    invoices: await prisma.invoice.count({ where: { ownerId: from } }),
    calls: await prisma.call.count({ where: { ownerId: from } }),
    tickets: await prisma.ticket.count({ where: { ownerId: from } }),
    payments: await prisma.payment.count({ where: { ownerId: from } }),
    notes: await prisma.note.count({ where: { ownerId: from } }),
    salesPeople: await prisma.salesPerson.count({ where: { ownerId: from } }),
    locations: await prisma.location.count({ where: { ownerId: from } }),
    tenant: await prisma.tenant.count({ where: { ownerId: from } }),
    settings: await prisma.settings.count({ where: { ownerId: from } }),
  }
  const remaining = Object.values(leftovers).reduce((a, b) => a + b, 0)

  console.log(`\n✔ Migration complete. Rows still owned by ${from}: ${remaining}`)
  console.log(`  ${to} now owns:`)
  console.log(`    customers  ${await prisma.customer.count({ where: { ownerId: to } })}`)
  console.log(`    invoices   ${await prisma.invoice.count({ where: { ownerId: to } })}`)
  console.log(`    calls      ${await prisma.call.count({ where: { ownerId: to } })}`)
  console.log(`    tickets    ${await prisma.ticket.count({ where: { ownerId: to } })}`)
  console.log(`    payments   ${await prisma.payment.count({ where: { ownerId: to } })}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
