/**
 * Seed the CRM "master" detail fields on existing customers so the Customer → Details
 * tab renders fully populated (like the accounts-master reference), plus the reference
 * SalesPerson + Location rows the customer edit dropdowns pick from.
 *
 *   npx tsx scripts/seed-crm-details.ts --owner=you@example.com
 *
 * Idempotent: upserts sales-people/locations by (owner,name/code) and only fills the
 * extra columns; safe to re-run. Run AFTER import-invoices.ts (+ optionally seed-demo.ts).
 */
import 'dotenv/config'
import { prisma } from '@/lib/prisma'

function ownerArg(): string {
  const a = process.argv.slice(2).find((x) => x.startsWith('--owner='))
  const owner = a?.slice('--owner='.length).trim().toLowerCase()
  if (!owner) {
    console.error('Usage: tsx scripts/seed-crm-details.ts --owner=<email>')
    process.exit(2)
  }
  return owner
}

async function main() {
  const owner = ownerArg()

  // 1) Reference sales people (idempotent by name).
  const salesNames = ['Anisha', 'Shammi']
  const sales: { id: string; name: string }[] = []
  for (const name of salesNames) {
    const existing = await prisma.salesPerson.findFirst({ where: { ownerId: owner, name } })
    const row = existing ?? (await prisma.salesPerson.create({ data: { ownerId: owner, name } }))
    sales.push({ id: row.id, name: row.name })
  }

  // 2) Reference locations / shops (unique by owner+code).
  const locDefs = [
    { code: 'WENTYSHOP', name: 'Wentyshop' },
    { code: 'DEEWHYSHOP', name: 'Dee Why Shop' },
  ]
  const locations: { id: string; code: string }[] = []
  for (const d of locDefs) {
    const row = await prisma.location.upsert({
      where: { ownerId_code: { ownerId: owner, code: d.code } },
      create: { ownerId: owner, code: d.code, name: d.name },
      update: { name: d.name },
    })
    locations.push({ id: row.id, code: row.code })
  }

  // 3) Fill the extra columns on every customer, round-robining sales-person + location.
  const customers = await prisma.customer.findMany({ where: { ownerId: owner }, orderBy: { businessName: 'asc' } })
  const creditLimits = [500, 800, 1000, 1500]
  let i = 0
  for (const c of customers) {
    // Outstanding balance from this customer's unpaid invoices (nice for the balance field).
    const invAgg = await prisma.invoice.aggregate({
      where: { ownerId: owner, customerId: c.id, status: { not: 'cancelled' } },
      _sum: { amountDue: true, paidAmount: true },
    })
    const balance = Math.max(0, (invAgg._sum.amountDue ?? 0) - (invAgg._sum.paidAmount ?? 0))

    await prisma.customer.update({
      where: { id: c.id },
      data: {
        accountCode: c.accountCode ?? `GFM${10786 - i}`,
        salesPersonId: c.salesPersonId ?? sales[i % sales.length].id,
        locationId: c.locationId ?? locations[i % locations.length].id,
        creditLimit: c.creditLimit ?? creditLimits[i % creditLimits.length],
        paymentTermsDays: c.paymentTermsDays ?? 7,
        email2: c.email2 ?? (c.email1 ? c.email1.replace('@', '.accounts@') : null),
        contactPerson: c.contactPerson ?? 'Accounts Payable',
        ignoreProductMinPrice: i % 2 === 0 ? true : c.ignoreProductMinPrice,
        hideInvoice: c.hideInvoice,
        isActive: true,
        balanceAmount: balance,
      },
    })
    i++
  }

  console.log(`Seeded CRM details for ${customers.length} customers · ${sales.length} sales people · ${locations.length} locations (owner ${owner}).`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
