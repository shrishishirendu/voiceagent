/**
 * Build a complete, self-contained DEMO workspace that someone can log into and click
 * through — every screen populated, no onboarding, no "no data yet" empty states.
 *
 *   npx tsx scripts/seed-demo-workspace.ts
 *   npx tsx scripts/seed-demo-workspace.ts --with-pdfs
 *
 * Defaults to dev@local.test / devpassword owning "Golden Valley Produce Co.".
 *
 * How this differs from scripts/seed-demo.ts: that one decorates invoices that
 * import-invoices.ts already created, so it needs a two-step setup and an existing tenant.
 * This one creates everything from nothing — User row included — so a demo can be stood up
 * against an empty database with a single command.
 *
 * SAFETY. This script deletes before it writes, and it is expected to be pointed at a
 * shared database that also holds real workspaces. Two things keep that safe:
 *   1. every delete is filtered on `ownerId = <demo email>`, so no other tenant's rows are
 *      reachable — tenancy is the blast radius;
 *   2. it refuses to overwrite a Tenant it did not create (marked `data.demoSeed`), which
 *      is what stops a typo'd --email from wiping a real customer's workspace. --force
 *      overrides that, deliberately requiring an explicit act.
 *
 * Idempotent: re-running drops this owner's demo rows and rebuilds them identically (the
 * randomness is seeded), so it is safe to run before every demo.
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { hashPassword, passwordProblem } from '@/lib/passwords'
import { computeGroupKey } from '@/lib/dispatcher'
import { buildInvoicePdf, type PdfLine } from './mini-pdf'

// ── Args ─────────────────────────────────────────────────────────────────────

type Args = {
  email: string
  password: string
  business: string
  withPdfs: boolean
  force: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (flag: string, fallback: string) => {
    const hit = argv.find((a) => a.startsWith(`--${flag}=`))
    return hit ? hit.slice(flag.length + 3).trim() : fallback
  }
  return {
    email: get('email', 'dev@local.test').toLowerCase(),
    password: get('password', 'devpassword'),
    business: get('business', 'Golden Valley Produce Co.'),
    withPdfs: argv.includes('--with-pdfs'),
    force: argv.includes('--force'),
  }
}

// ── Deterministic helpers ────────────────────────────────────────────────────
// A seeded LCG rather than Math.random so two runs produce byte-identical data. A demo
// that reshuffles its own numbers every time it is seeded is impossible to script around.

let rngState = 0x2f6e2b1
function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0
  return rngState / 0x100000000
}
function randInt(min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1))
}
function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length)]
}

const NOW = new Date()
function daysAgo(n: number): Date {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  return d
}
function daysAhead(n: number): Date {
  return daysAgo(-n)
}
/** The date-only text format the invoice date columns store (they are `text`, not `date`). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function money(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Reference data ───────────────────────────────────────────────────────────

const SALES_PEOPLE = ['Dana Whitfield', 'Marcus Ellery', 'Priya Raghavan'] as const
const LOCATIONS = [
  { code: 'SYD', name: 'Sydney Markets Depot' },
  { code: 'MEL', name: 'Melbourne Cold Store' },
  { code: 'BNE', name: 'Brisbane Distribution' },
] as const

type CustomerSpec = {
  key: string
  businessName: string
  accountCode: string
  contactPerson: string
  phone: string
  email: string
  abn: string
  city: string
  state: string
  postCode: string
  address: string
  terms: number
  creditLimit: number
  location: string
  salesPerson: string
}

const CUSTOMERS: CustomerSpec[] = [
  { key: 'harbourview', businessName: 'Harbourview Grocers Pty Ltd', accountCode: 'HAR-001', contactPerson: 'Alice Nguyen', phone: '+61255500110', email: 'accounts@harbourviewgrocers.com.au', abn: '51824753556', city: 'Sydney', state: 'NSW', postCode: '2000', address: '14 Wharf Road', terms: 30, creditLimit: 45000, location: 'SYD', salesPerson: 'Dana Whitfield' },
  { key: 'riverside', businessName: 'Riverside Restaurant Group', accountCode: 'RIV-002', contactPerson: 'Tom Beckett', phone: '+61255500121', email: 'ap@riversidegroup.com.au', abn: '29002589460', city: 'Melbourne', state: 'VIC', postCode: '3000', address: '88 Southbank Blvd', terms: 14, creditLimit: 60000, location: 'MEL', salesPerson: 'Marcus Ellery' },
  { key: 'kingsford', businessName: 'Kingsford Market Fresh', accountCode: 'KIN-003', contactPerson: 'Sofia Marchetti', phone: '+61255500132', email: 'finance@kingsfordfresh.com.au', abn: '83914762281', city: 'Sydney', state: 'NSW', postCode: '2032', address: '5 Anzac Parade', terms: 30, creditLimit: 30000, location: 'SYD', salesPerson: 'Dana Whitfield' },
  { key: 'bayside', businessName: 'Bayside Catering Co.', accountCode: 'BAY-004', contactPerson: 'Reuben Ochoa', phone: '+61255500143', email: 'payables@baysidecatering.com.au', abn: '17650391104', city: 'Brisbane', state: 'QLD', postCode: '4000', address: '210 Eagle Street', terms: 21, creditLimit: 25000, location: 'BNE', salesPerson: 'Priya Raghavan' },
  { key: 'northgate', businessName: 'Northgate Hotels Group', accountCode: 'NOR-005', contactPerson: 'Helena Fisk', phone: '+61255500154', email: 'invoices@northgatehotels.com.au', abn: '44118273905', city: 'Melbourne', state: 'VIC', postCode: '3053', address: '77 Lygon Street', terms: 45, creditLimit: 90000, location: 'MEL', salesPerson: 'Marcus Ellery' },
  { key: 'sunset', businessName: 'Sunset Cafe Collective', accountCode: 'SUN-006', contactPerson: 'Jonah Pretorius', phone: '+61255500165', email: 'admin@sunsetcafes.com.au', abn: '62740118337', city: 'Sydney', state: 'NSW', postCode: '2026', address: '3 Campbell Parade', terms: 14, creditLimit: 15000, location: 'SYD', salesPerson: 'Dana Whitfield' },
  { key: 'meridian', businessName: 'Meridian Food Services', accountCode: 'MER-007', contactPerson: 'Grace Adeyemi', phone: '+61255500176', email: 'ar@meridianfoods.com.au', abn: '90335872164', city: 'Brisbane', state: 'QLD', postCode: '4064', address: '41 Caxton Street', terms: 30, creditLimit: 55000, location: 'BNE', salesPerson: 'Priya Raghavan' },
  { key: 'palmgrove', businessName: 'Palm Grove Retail Holdings', accountCode: 'PAL-008', contactPerson: 'Victor Lindqvist', phone: '+61255500187', email: 'accounts@palmgroveretail.com.au', abn: '38207641590', city: 'Melbourne', state: 'VIC', postCode: '3182', address: '9 Acland Street', terms: 30, creditLimit: 40000, location: 'MEL', salesPerson: 'Marcus Ellery' },
]

const PRODUCE = [
  { desc: 'Truss tomatoes, 5kg carton', unit: 28.5 },
  { desc: 'Baby spinach, 1.5kg box', unit: 14.0 },
  { desc: 'Hass avocados, tray of 25', unit: 62.0 },
  { desc: 'Red capsicum, 6kg carton', unit: 41.25 },
  { desc: 'Continental cucumbers, box of 20', unit: 33.0 },
  { desc: 'Dutch carrots, 10 bunch case', unit: 27.5 },
  { desc: 'Field mushrooms, 3kg punnet case', unit: 46.75 },
  { desc: 'Granny Smith apples, 18kg carton', unit: 58.4 },
  { desc: 'Iceberg lettuce, box of 12', unit: 31.2 },
  { desc: 'Spring onions, 5 bunch bundle', unit: 12.8 },
]

const BANKING = {
  bankName: 'Commonwealth Bank of Australia',
  bsb: '062-000',
  accountNumber: '1024 8873',
  swiftCode: 'CTBAAU2S',
  remittanceName: 'Golden Valley Produce Co.',
  remittanceContact: 'remittance@goldenvalleyproduce.com.au',
}

/** Every invoice in the demo, laid out explicitly so the KPI mix is intentional. */
type InvoiceSpec = {
  customer: string
  number: string
  /** Days before today the invoice was issued. */
  issuedDaysAgo: number
  /** Negative = due in the future (i.e. not yet outstanding). */
  dueDaysAgo: number
  amount: number
  currency?: string
  /** Fraction of the amount already paid. 1 = settled. */
  paidFraction?: number
  /**
   * Days before today the payment landed. Defaults to just after the due date, which for
   * the long-overdue rows falls outside lib/forecasting.ts's 42-day collections window —
   * set it explicitly on a few invoices so the "Collected (42d)" tile is not near-empty.
   */
  paidDaysAgo?: number
  status: 'stored' | 'pending' | 'queued' | 'calling' | 'resolved' | 'failed' | 'cancelled'
  notes?: string
}

// The mix is chosen so the dashboard is not uniform:
//   - outstanding (past due + unpaid) drives the headline KPI
//   - two non-AUD rows exercise the per-currency bucketing in lib/money.ts (which never
//     sums across currencies), so the tile renders "$… + USD …" rather than one figure
//   - future-dated unpaid rows must NOT count as outstanding — they prove the rule
//   - one cancelled row proves cancelled is excluded regardless of balance
//   - a few open (pending/queued) rows are due in the NEXT 14 days, which is the only thing
//     lib/forecasting.ts counts as "Upcoming due" — future-dated `stored` rows do not qualify
const INVOICES: InvoiceSpec[] = [
  { customer: 'harbourview', number: 'GV-10241', issuedDaysAgo: 96, dueDaysAgo: 66, amount: 8420.55, status: 'resolved', paidFraction: 1, notes: 'Weekly produce run — Sydney CBD stores.' },
  { customer: 'harbourview', number: 'GV-10288', issuedDaysAgo: 74, dueDaysAgo: 44, amount: 6180.0, status: 'failed', paidFraction: 0.25, paidDaysAgo: 30, notes: 'Partial payment received; balance disputed on carton count.' },
  { customer: 'harbourview', number: 'GV-10352', issuedDaysAgo: 51, dueDaysAgo: 21, amount: 11245.9, status: 'pending' },
  { customer: 'harbourview', number: 'GV-10461', issuedDaysAgo: 12, dueDaysAgo: -5, amount: 4310.25, status: 'queued' },

  { customer: 'riverside', number: 'GV-10259', issuedDaysAgo: 88, dueDaysAgo: 74, amount: 15980.4, status: 'resolved', paidFraction: 1 },
  { customer: 'riverside', number: 'GV-10334', issuedDaysAgo: 58, dueDaysAgo: 44, amount: 9420.75, status: 'calling', notes: 'Escalated — third chase attempt.' },
  { customer: 'riverside', number: 'GV-10402', issuedDaysAgo: 31, dueDaysAgo: 17, amount: 7250.0, status: 'pending' },

  { customer: 'kingsford', number: 'GV-10276', issuedDaysAgo: 80, dueDaysAgo: 50, amount: 3890.6, status: 'resolved', paidFraction: 1, paidDaysAgo: 40 },
  { customer: 'kingsford', number: 'GV-10391', issuedDaysAgo: 36, dueDaysAgo: 6, amount: 5125.3, status: 'pending' },
  { customer: 'kingsford', number: 'GV-10470', issuedDaysAgo: 8, dueDaysAgo: -22, amount: 2740.0, status: 'stored' },

  { customer: 'bayside', number: 'GV-10301', issuedDaysAgo: 68, dueDaysAgo: 47, amount: 4460.85, status: 'failed', paidFraction: 0, notes: 'Number disconnected — needs a contact update.' },
  { customer: 'bayside', number: 'GV-10418', issuedDaysAgo: 27, dueDaysAgo: 6, amount: 3180.4, status: 'queued' },
  { customer: 'bayside', number: 'GV-10482', issuedDaysAgo: 5, dueDaysAgo: -25, amount: 2870.6, status: 'stored' },

  { customer: 'northgate', number: 'GV-10233', issuedDaysAgo: 102, dueDaysAgo: 57, amount: 24310.0, status: 'resolved', paidFraction: 0.6, paidDaysAgo: 20, notes: 'Instalment plan agreed: 60% paid, remainder end of quarter.' },
  { customer: 'northgate', number: 'GV-10345', issuedDaysAgo: 55, dueDaysAgo: 10, amount: 18775.5, status: 'pending' },
  { customer: 'northgate', number: 'GV-10455', issuedDaysAgo: 15, dueDaysAgo: -11, amount: 12900.0, status: 'pending' },

  { customer: 'sunset', number: 'GV-10312', issuedDaysAgo: 64, dueDaysAgo: 50, amount: 1985.25, status: 'resolved', paidFraction: 1, paidDaysAgo: 35 },
  { customer: 'sunset', number: 'GV-10429', issuedDaysAgo: 24, dueDaysAgo: 10, amount: 2410.9, status: 'pending' },
  { customer: 'sunset', number: 'GV-10444', issuedDaysAgo: 19, dueDaysAgo: 5, amount: 1620.0, status: 'cancelled', notes: 'Order cancelled before dispatch — credit note issued.' },

  // Export accounts — deliberately non-AUD.
  { customer: 'meridian', number: 'GV-10267', issuedDaysAgo: 85, dueDaysAgo: 55, amount: 7440.0, currency: 'USD', status: 'pending', notes: 'Export account — invoiced in USD.' },
  { customer: 'meridian', number: 'GV-10381', issuedDaysAgo: 41, dueDaysAgo: 11, amount: 3220.5, currency: 'NZD', status: 'pending', notes: 'Auckland depot transfer.' },
  { customer: 'meridian', number: 'GV-10437', issuedDaysAgo: 21, dueDaysAgo: -9, amount: 6650.0, status: 'pending' },

  { customer: 'palmgrove', number: 'GV-10294', issuedDaysAgo: 72, dueDaysAgo: 42, amount: 9860.75, status: 'failed', paidFraction: 0.5, paidDaysAgo: 12, notes: 'Half paid; AP contact on leave.' },
  { customer: 'palmgrove', number: 'GV-10412', issuedDaysAgo: 29, dueDaysAgo: 1, amount: 5540.2, status: 'queued' },
]

// ── Wipe ─────────────────────────────────────────────────────────────────────

/**
 * Remove every row belonging to this owner, children first so no FK is left dangling.
 * `Payment`/`InvoiceLineItem`/`CallInvoice` cascade from their parents, but they are
 * deleted explicitly anyway — relying on cascade order is the kind of assumption that
 * breaks silently the next time the schema changes.
 */
async function wipeOwner(owner: string): Promise<void> {
  await prisma.ticket.deleteMany({ where: { ownerId: owner } })
  await prisma.callInvoice.deleteMany({ where: { call: { ownerId: owner } } })
  await prisma.call.deleteMany({ where: { ownerId: owner } })
  await prisma.payment.deleteMany({ where: { ownerId: owner } })
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { ownerId: owner } } })
  await prisma.invoice.deleteMany({ where: { ownerId: owner } })
  await prisma.note.deleteMany({ where: { ownerId: owner } })
  await prisma.customer.deleteMany({ where: { ownerId: owner } })
  await prisma.salesPerson.deleteMany({ where: { ownerId: owner } })
  await prisma.location.deleteMany({ where: { ownerId: owner } })
}

/**
 * Count rows in this workspace that this seeder did not create.
 *
 * The wipe above is scoped by ownerId, which is the right blast radius for a workspace the
 * seeder owns outright — but a demo workspace can acquire real rows afterwards (e.g.
 * scripts/migrate-owner.ts folding another owner's data in, or someone uploading an invoice
 * through the UI). Those would be deleted silently on the next re-seed. Everything the
 * seeder creates is recognisable — invoices are numbered `GV-…` and customers carry a known
 * account code — so anything else is treated as foreign and makes the run stop.
 */
async function foreignRowCount(owner: string): Promise<{ invoices: number; customers: number }> {
  const demoAccountCodes = CUSTOMERS.map((c) => c.accountCode)
  const [invoices, customers] = await Promise.all([
    prisma.invoice.count({ where: { ownerId: owner, NOT: { invoiceNumber: { startsWith: 'GV-' } } } }),
    prisma.customer.count({ where: { ownerId: owner, NOT: { accountCode: { in: demoAccountCodes } } } }),
  ])
  return { invoices, customers }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  const owner = args.email

  const problem = passwordProblem(args.password)
  if (problem) {
    console.error(`✖ ${problem}`)
    process.exit(1)
  }

  // Guard: never silently rebuild a workspace this script did not create.
  const existing = await prisma.tenant.findUnique({ where: { ownerId: owner } })
  if (existing && !args.force) {
    const data = (existing.data ?? {}) as unknown as Record<string, unknown>
    if (data.demoSeed !== true) {
      console.error(
        `✖ ${owner} already owns a workspace ("${existing.businessName ?? '—'}") that was NOT created by this\n` +
          `  seeder. Refusing to wipe it. Use a different --email, or --force if you are certain.`
      )
      process.exit(1)
    }
  }

  // Guard: never silently destroy rows that arrived from somewhere other than this seeder.
  if (!args.force) {
    const foreign = await foreignRowCount(owner)
    if (foreign.invoices > 0 || foreign.customers > 0) {
      console.error(
        `✖ ${owner} holds rows this seeder did not create: ` +
          `${foreign.invoices} invoice(s), ${foreign.customers} customer(s).\n` +
          `  Re-seeding wipes the whole workspace by ownerId, which would delete them.\n` +
          `  Move them to another owner first (scripts/migrate-owner.ts), or pass --force to\n` +
          `  discard them deliberately.`
      )
      process.exit(1)
    }
  }

  console.log(`Seeding demo workspace for ${owner} …`)
  await wipeOwner(owner)

  // 1) The login itself. isOwner=true is what /api/signup would have set; without it a
  //    user with no tenant is refused by lib/access.ts. The Tenant row below is what
  //    actually makes them an owner, but both are set so the account is coherent either way.
  await prisma.user.upsert({
    where: { id: owner },
    create: {
      id: owner,
      email: owner,
      name: 'Demo Owner',
      passwordHash: await hashPassword(args.password),
      isOwner: true,
      emailVerified: new Date(),
    },
    update: {
      passwordHash: await hashPassword(args.password),
      isOwner: true,
      name: 'Demo Owner',
      emailVerified: new Date(),
    },
  })

  // 2) Tenant + settings, so /app never bounces to /onboarding.
  //    `onboarded: true` mirrors what the wizard writes; `demoSeed` is the marker the
  //    guard above reads on re-runs.
  await prisma.tenant.upsert({
    where: { ownerId: owner },
    create: {
      ownerId: owner,
      businessName: args.business,
      // Deliberately null: Tenant.phoneNumber is the caller-id and it WINS over the
      // TWILIO_PHONE_NUMBER env var (see lib/credentials.ts resolveDispatchConfig). A
      // hardcoded placeholder here silently shadows a correctly-configured real Twilio
      // number and makes every dial-out fail. Leave it unset so env is used; set a real
      // owned number via Settings → caller-id if a tenant needs its own.
      phoneNumber: null,
      data: {
        demoSeed: true,
        onboarded: true,
        industry: 'Fresh produce wholesale',
        objectiveDefault: 'Chase overdue invoices politely and confirm a payment date.',
        addressLine: 'Unit 7, Sydney Markets, Flemington NSW 2140',
        website: 'https://goldenvalleyproduce.example',
      },
      members: [],
    },
    update: {
      businessName: args.business,
      data: {
        demoSeed: true,
        onboarded: true,
        industry: 'Fresh produce wholesale',
        objectiveDefault: 'Chase overdue invoices politely and confirm a payment date.',
        addressLine: 'Unit 7, Sydney Markets, Flemington NSW 2140',
        website: 'https://goldenvalleyproduce.example',
      },
    },
  })
  await prisma.settings.upsert({
    where: { ownerId: owner },
    create: { ownerId: owner, timezone: 'Australia/Sydney', schedulerOn: false },
    // schedulerOn=false so a demo seeding never starts dialling real numbers.
    update: { schedulerOn: false },
  })

  // 3) CRM reference rows.
  const salesIds: Record<string, string> = {}
  for (const name of SALES_PEOPLE) {
    const row = await prisma.salesPerson.create({ data: { ownerId: owner, name } })
    salesIds[name] = row.id
  }
  const locationIds: Record<string, string> = {}
  for (const loc of LOCATIONS) {
    const row = await prisma.location.create({ data: { ownerId: owner, code: loc.code, name: loc.name } })
    locationIds[loc.code] = row.id
  }

  // 4) Customers.
  const customerIds: Record<string, string> = {}
  for (const c of CUSTOMERS) {
    const row = await prisma.customer.create({
      data: {
        ownerId: owner,
        accountCode: c.accountCode,
        businessName: c.businessName,
        addressLine: c.address,
        city: c.city,
        state: c.state,
        postCode: c.postCode,
        contactPerson: c.contactPerson,
        contactPhone: c.phone,
        email1: c.email,
        abn: c.abn,
        paymentTermsDays: c.terms,
        creditLimit: c.creditLimit,
        isActive: true,
        salesPersonId: salesIds[c.salesPerson],
        locationId: locationIds[c.location],
      },
    })
    customerIds[c.key] = row.id
  }

  // 5) Invoices + line items + payments.
  const invoiceIds: Record<string, string> = {}
  const pdfJobs: { name: string; body: Buffer; invoiceId: string }[] = []

  for (const spec of INVOICES) {
    const c = CUSTOMERS.find((x) => x.key === spec.customer)!
    const currency = spec.currency ?? 'AUD'
    const paid = money(spec.amount * (spec.paidFraction ?? 0))

    // Line items are generated to sum to the invoice total, with the rounding drift parked
    // on the last line so the parts always reconcile against the header amount.
    const lineCount = randInt(2, 4)
    const chosen = Array.from({ length: lineCount }, () => pick(PRODUCE))
    const weights = chosen.map(() => 0.5 + rand())
    const weightSum = weights.reduce((a, b) => a + b, 0)
    const lines = chosen.map((p, i) => {
      const target = spec.amount * (weights[i] / weightSum)
      const qty = Math.max(1, Math.round(target / p.unit))
      return { description: p.desc, quantity: qty, unitPrice: p.unit, lineTotal: money(qty * p.unit) }
    })
    const drift = money(spec.amount - lines.reduce((s, l) => s + l.lineTotal, 0))
    lines[lines.length - 1].lineTotal = money(lines[lines.length - 1].lineTotal + drift)

    const issued = daysAgo(spec.issuedDaysAgo)
    const due = spec.dueDaysAgo >= 0 ? daysAgo(spec.dueDaysAgo) : daysAhead(-spec.dueDaysAgo)

    const invoice = await prisma.invoice.create({
      data: {
        ownerId: owner,
        customerId: customerIds[spec.customer],
        contactBusiness: c.businessName,
        contactPerson: c.contactPerson,
        toNumber: c.phone,
        abn: c.abn,
        groupKey: computeGroupKey(c.abn, c.businessName),
        userName: 'Riley',
        voice: 'iris',
        manner: 'warm',
        objective: `Follow up on payment for invoice ${spec.number}. Confirm whether payment has been made or arrange a settlement date.`,
        invoiceNumber: spec.number,
        invoiceDate: isoDay(issued),
        dueDate: isoDay(due),
        amountDue: spec.amount,
        totalAmount: spec.amount,
        paidAmount: paid,
        currency,
        invoiceNotes: spec.notes,
        ...BANKING,
        chaseAfter: daysAgo(spec.dueDaysAgo > 0 ? spec.dueDaysAgo - 1 : 0),
        status: spec.status,
        attempts: spec.status === 'failed' ? 2 : spec.status === 'calling' ? 1 : 0,
        createdAt: issued,
        updatedAt: issued,
        lineItems: { create: lines },
      },
    })
    invoiceIds[spec.number] = invoice.id

    if (paid > 0) {
      // Full settlements are recorded as two instalments so the payment history panel has
      // more than a single row to show.
      const instalments = spec.paidFraction === 1 ? 2 : 1
      const each = money(paid / instalments)
      const firstPaid = spec.paidDaysAgo ?? spec.dueDaysAgo
      for (let i = 0; i < instalments; i++) {
        const amount = i === instalments - 1 ? money(paid - each * (instalments - 1)) : each
        // Instalments run oldest-first, a week apart, and never land in the future.
        const when = daysAgo(Math.max(1, firstPaid - i * 7))
        await prisma.payment.create({
          data: {
            ownerId: owner,
            invoiceId: invoice.id,
            payAmount: amount,
            payDate: isoDay(when),
            paymentType: pick(['EFT', 'Direct debit', 'Credit card', 'BPAY']),
            createdAt: when,
          },
        })
      }
    }

    if (args.withPdfs) {
      const body: PdfLine[] = [
        { text: args.business, size: 18, bold: true },
        { text: 'Unit 7, Sydney Markets, Flemington NSW 2140', size: 9 },
        { text: 'ABN 74 552 108 993   ·   accounts@goldenvalleyproduce.example', size: 9 },
        { text: 'TAX INVOICE', size: 14, bold: true, gap: 18 },
        { text: `Invoice number: ${spec.number}`, gap: 8 },
        { text: `Invoice date: ${isoDay(issued)}` },
        { text: `Due date: ${isoDay(due)}` },
        { text: `Currency: ${currency}` },
        { text: 'Bill to', size: 11, bold: true, gap: 14 },
        { text: c.businessName, gap: 4 },
        { text: `${c.address}, ${c.city} ${c.state} ${c.postCode}` },
        { text: `Attn: ${c.contactPerson}   ·   ABN ${c.abn}` },
        { text: 'Description', size: 10, bold: true, gap: 18 },
        { text: 'Qty', size: 10, bold: true, x: 330 },
        { text: 'Unit', size: 10, bold: true, x: 400 },
        { text: 'Amount', size: 10, bold: true, x: 470 },
      ]
      // Each line item is drawn as one row: the description advances the cursor, the three
      // numeric columns are placed at fixed x with gap:-14 to sit back on that same row.
      for (const l of lines) {
        body.push({ text: l.description, size: 10, gap: 2 })
        body.push({ text: String(l.quantity), size: 10, x: 330, gap: -14 })
        body.push({ text: l.unitPrice.toFixed(2), size: 10, x: 400, gap: -14 })
        body.push({ text: l.lineTotal.toFixed(2), size: 10, x: 470, gap: -14 })
      }
      body.push({ text: `Total due: ${currency} ${spec.amount.toFixed(2)}`, size: 12, bold: true, gap: 20 })
      if (paid > 0) body.push({ text: `Less payments received: ${currency} ${paid.toFixed(2)}`, size: 10 })
      if (paid > 0) body.push({ text: `Balance outstanding: ${currency} ${money(spec.amount - paid).toFixed(2)}`, size: 11, bold: true })
      body.push({ text: 'Payment details', size: 11, bold: true, gap: 20 })
      body.push({ text: `${BANKING.bankName}`, size: 10, gap: 4 })
      body.push({ text: `BSB ${BANKING.bsb}   Account ${BANKING.accountNumber}   SWIFT ${BANKING.swiftCode}`, size: 10 })
      body.push({ text: `Please quote ${spec.number} as the payment reference.`, size: 10, gap: 6 })
      if (spec.notes) body.push({ text: `Note: ${spec.notes}`, size: 9, gap: 12 })

      pdfJobs.push({ name: `${spec.number}.pdf`, body: buildInvoicePdf(body), invoiceId: invoice.id })
    }
  }

  // 6) Calls + the ticket each one produces.
  //    Statuses are spread across the whole outbound lifecycle so the kanban has cards in
  //    every lane and the outcome donut has every slice.
  type CallSpec = {
    customer: string
    invoice: string
    daysAgo: number
    status: string
    outcome: string | null
    ticketStatus: string
    summary: string | null
    endedReason?: string
    transcript?: { who: 'envoy' | 'them'; text: string }[]
    voicemailScript?: string
  }

  const CALLS: CallSpec[] = [
    {
      customer: 'harbourview', invoice: 'GV-10241', daysAgo: 63, status: 'completed', outcome: 'success',
      ticketStatus: 'Resolved', summary: 'Accounts payable confirmed the invoice was approved and scheduled in the Friday payment run.',
      transcript: [
        { who: 'envoy', text: 'Hi, this is Riley calling on behalf of Golden Valley Produce about invoice GV-10241 for $8,420.55.' },
        { who: 'them', text: 'Let me check — yes, that one cleared approval last week.' },
        { who: 'envoy', text: 'That is great to hear. Are you able to confirm the payment date?' },
        { who: 'them', text: 'It will go out in Friday’s run, so you should see it Monday.' },
        { who: 'envoy', text: 'Perfect, I have noted Friday. Thanks very much for your time.' },
      ],
    },
    {
      customer: 'riverside', invoice: 'GV-10259', daysAgo: 71, status: 'completed', outcome: 'success',
      ticketStatus: 'Resolved', summary: 'Payment had already been remitted the previous day; remittance advice re-sent to confirm.',
      transcript: [
        { who: 'envoy', text: 'Good morning, calling about invoice GV-10259 for $15,980.40.' },
        { who: 'them', text: 'That was paid yesterday actually, I can forward the remittance.' },
        { who: 'envoy', text: 'Wonderful, thank you. I will mark it as settled on our side.' },
      ],
    },
    {
      customer: 'northgate', invoice: 'GV-10233', daysAgo: 54, status: 'completed', outcome: 'partial',
      ticketStatus: 'Resolved', summary: 'Cash-flow constraint raised. Agreed a 60/40 instalment plan; first instalment paid, remainder due end of quarter.',
      transcript: [
        { who: 'envoy', text: 'Hi, I am following up on invoice GV-10233 for $24,310.00, now 57 days overdue.' },
        { who: 'them', text: 'We are aware. Cash flow has been tight since the refurbishment.' },
        { who: 'envoy', text: 'Understood. Would a part payment now with the balance at quarter end work?' },
        { who: 'them', text: 'We could do sixty percent this week and the rest by the end of the quarter.' },
        { who: 'envoy', text: 'That works. I will record sixty percent this week and the balance at quarter end.' },
      ],
    },
    {
      customer: 'kingsford', invoice: 'GV-10276', daysAgo: 47, status: 'completed', outcome: 'success',
      ticketStatus: 'Resolved', summary: 'Invoice paid during the call via BPAY; reference provided.',
    },
    {
      customer: 'sunset', invoice: 'GV-10312', daysAgo: 44, status: 'completed', outcome: 'success',
      ticketStatus: 'Resolved', summary: 'Owner confirmed payment was sent the same morning.',
    },
    {
      customer: 'palmgrove', invoice: 'GV-10294', daysAgo: 38, status: 'completed', outcome: 'partial',
      ticketStatus: 'In Progress', summary: 'Half the balance paid. AP contact on leave until next week; callback scheduled.',
    },
    {
      customer: 'harbourview', invoice: 'GV-10288', daysAgo: 33, status: 'completed', outcome: 'partial',
      ticketStatus: 'In Progress', summary: 'Carton count on two lines disputed. Credit note requested before the balance will be released.',
      transcript: [
        { who: 'envoy', text: 'Calling about the outstanding balance on invoice GV-10288.' },
        { who: 'them', text: 'We short-received two cartons on that delivery, so we held the balance back.' },
        { who: 'envoy', text: 'Thanks for flagging it — I will raise a credit note request for the two cartons.' },
      ],
    },
    {
      customer: 'meridian', invoice: 'GV-10267', daysAgo: 27, status: 'completed', outcome: 'no-answer',
      ticketStatus: 'In Progress', endedReason: 'voicemail',
      summary: 'No answer — voicemail left requesting a callback about the USD balance.',
      voicemailScript: 'Hi, this is Riley from Golden Valley Produce regarding invoice GV-10267 for USD 7,440.00, now overdue. Please call us back on 02 5550 0100 to arrange payment. Thank you.',
    },
    {
      customer: 'bayside', invoice: 'GV-10301', daysAgo: 21, status: 'failed', outcome: 'failed',
      ticketStatus: 'In Progress', endedReason: 'customer-busy',
      summary: 'Line busy on two consecutive attempts. Contact number may be out of date.',
    },
    {
      customer: 'sunset', invoice: 'GV-10429', daysAgo: 14, status: 'completed', outcome: 'success',
      ticketStatus: 'Resolved', summary: 'Confirmed payment scheduled for the end of the week.',
    },
    {
      customer: 'northgate', invoice: 'GV-10345', daysAgo: 9, status: 'completed', outcome: 'no-answer',
      ticketStatus: 'In Progress', endedReason: 'no-answer',
      summary: 'Rang out — no voicemail available. Queued for retry.',
    },
    {
      customer: 'palmgrove', invoice: 'GV-10412', daysAgo: 5, status: 'completed', outcome: 'success',
      ticketStatus: 'Resolved', summary: 'AP confirmed the invoice is approved and in the next payment run.',
    },
    {
      customer: 'meridian', invoice: 'GV-10381', daysAgo: 2, status: 'completed', outcome: 'partial',
      ticketStatus: 'In Progress', summary: 'Requested a copy of the invoice and remittance details before releasing payment.',
    },
    // Live now — gives the dashboard's Live Activity rail and the /app/calls/live screen
    // something in flight to render.
    {
      customer: 'riverside', invoice: 'GV-10334', daysAgo: 0, status: 'in-progress', outcome: null,
      ticketStatus: 'In Progress', summary: null,
    },
  ]

  let seq = 0
  for (const spec of CALLS) {
    seq++
    const c = CUSTOMERS.find((x) => x.key === spec.customer)!
    const invSpec = INVOICES.find((x) => x.number === spec.invoice)!
    const when = daysAgo(spec.daysAgo)

    const call = await prisma.call.create({
      data: {
        ownerId: owner,
        customerId: customerIds[spec.customer],
        contactBusiness: c.businessName,
        contactPerson: c.contactPerson,
        toNumber: c.phone,
        objective: `Follow up on payment for invoice ${spec.invoice}. Confirm whether payment has been made or arrange a settlement date.`,
        userName: 'Riley',
        voice: 'iris',
        manner: 'warm',
        invoiceNumber: spec.invoice,
        invoiceDate: isoDay(daysAgo(invSpec.issuedDaysAgo)),
        dueDate: isoDay(invSpec.dueDaysAgo >= 0 ? daysAgo(invSpec.dueDaysAgo) : daysAhead(-invSpec.dueDaysAgo)),
        amountDue: invSpec.amount,
        currency: invSpec.currency ?? 'AUD',
        invoiceNotes: invSpec.notes,
        ...BANKING,
        // Marked as a demo id so nothing here can be mistaken for a real Vapi call record.
        vapiCallId: `demo-seed-${seq}-${owner.split('@')[0]}`,
        status: spec.status,
        outcome: spec.outcome ?? undefined,
        durationSec: spec.status === 'in-progress' ? undefined : randInt(45, 260),
        endedReason: spec.endedReason,
        summary: spec.summary ?? undefined,
        transcript: spec.transcript ? (spec.transcript as unknown as object) : undefined,
        voicemailScript: spec.voicemailScript,
        createdAt: when,
        updatedAt: when,
      },
    })

    await prisma.callInvoice.create({ data: { callId: call.id, invoiceId: invoiceIds[spec.invoice] } })

    await prisma.ticket.create({
      data: {
        ownerId: owner,
        customerId: customerIds[spec.customer],
        callId: call.id,
        channel: 'phone',
        status: spec.ticketStatus,
        tags: ['outbound', 'collections'],
        title: `${c.businessName} · ${spec.invoice}`,
        requester: c.businessName,
        aiSummary: spec.summary,
        transcript: spec.transcript ? (spec.transcript as unknown as object) : undefined,
        createdAt: when,
        updatedAt: when,
      },
    })
  }

  // 7) Queued tickets with no call yet — the "Incoming" lane, which would otherwise be
  //    empty because every ticket above is attached to a call that already happened.
  for (const spec of INVOICES.filter((i) => i.status === 'queued' || i.status === 'pending').slice(0, 4)) {
    const c = CUSTOMERS.find((x) => x.key === spec.customer)!
    const when = daysAgo(randInt(0, 3))
    await prisma.ticket.create({
      data: {
        ownerId: owner,
        customerId: customerIds[spec.customer],
        callId: null,
        channel: 'phone',
        status: 'Incoming',
        tags: ['outbound', 'collections'],
        title: `${c.businessName} · ${spec.number}`,
        requester: c.businessName,
        aiSummary: 'Queued for chasing — awaiting a free call slot.',
        createdAt: when,
        updatedAt: when,
      },
    })
  }

  // 8) Historical ticket volume across the last 42 days. lib/forecasting.ts builds its
  //    trend + day-of-week seasonality + AR(1) model from ticket createdAt within that
  //    window, and lib/analytics.ts segments by the channel tag — with only the ~18 tickets
  //    above, both render as flat lines. Weekday-weighted volume gives the seasonality term
  //    something real to find, and the inbound rows make the channel-mix donut two-sided.
  const historical: {
    ownerId: string; customerId: string; channel: string; status: string
    tags: string[]; title: string; requester: string; aiSummary: string
    createdAt: Date; updatedAt: Date
  }[] = []

  for (let d = 41; d >= 0; d--) {
    const day = daysAgo(d)
    const dow = day.getDay()
    const isWeekend = dow === 0 || dow === 6
    // Mild upward trend over the window so the projection is not a flat line.
    const base = isWeekend ? randInt(0, 1) : randInt(2, 5) + Math.floor((41 - d) / 20)
    for (let k = 0; k < base; k++) {
      const c = pick(CUSTOMERS)
      const inbound = rand() < 0.35
      const at = new Date(day)
      at.setHours(randInt(8, 17), randInt(0, 59), 0, 0)
      historical.push({
        ownerId: owner,
        customerId: customerIds[c.key],
        channel: 'phone',
        status: rand() < 0.72 ? 'Resolved' : 'In Progress',
        tags: [inbound ? 'inbound' : 'outbound', 'collections'],
        title: inbound
          ? `${c.businessName} · payment query`
          : `${c.businessName} · chase call`,
        requester: c.businessName,
        aiSummary: inbound
          ? 'Customer called in to query an invoice balance.'
          : 'Outbound chase call logged.',
        createdAt: at,
        updatedAt: at,
      })
    }
  }
  await prisma.ticket.createMany({ data: historical })

  // 9) Customer notes.
  const NOTES: { customer: string; type: string; text: string }[] = [
    { customer: 'harbourview', type: 'Call', text: 'Prefers to be contacted before 11am — AP desk is unattended in the afternoons.' },
    { customer: 'harbourview', type: 'Dispute', text: 'Recurring short-delivery claims on truss tomatoes. Warehouse investigating.' },
    { customer: 'riverside', type: 'Account', text: 'Group AP consolidated to Southbank office as of last quarter.' },
    { customer: 'northgate', type: 'Arrangement', text: 'Instalment plan agreed on GV-10233: 60% paid, balance due end of quarter.' },
    { customer: 'bayside', type: 'Data', text: 'Listed phone number failed twice — needs verification with the account manager.' },
    { customer: 'meridian', type: 'Account', text: 'Invoiced in USD and NZD for export lines; AUD for domestic deliveries.' },
    { customer: 'palmgrove', type: 'Call', text: 'Primary AP contact on leave; escalate to the finance manager if unreachable.' },
    { customer: 'sunset', type: 'Account', text: 'Small account, pays reliably within terms. Low chase priority.' },
  ]
  for (const n of NOTES) {
    await prisma.note.create({
      data: { ownerId: owner, customerId: customerIds[n.customer], noteType: n.type, noteText: n.text },
    })
  }

  // 10) Optional: push the generated PDFs to Supabase Storage and link them to their rows.
  //     Gated because SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are separate from the
  //     Postgres connection strings — the DB can be reachable while storage is not.
  let pdfNote = 'skipped (--with-pdfs not passed)'
  if (args.withPdfs) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // Storage credentials are absent, but the PDFs are already built in memory. Write them
      // to disk rather than discarding them, so adding the env vars later is a re-run away
      // and the files can be inspected/uploaded by hand in the meantime.
      const outDir = join(process.cwd(), 'demo-invoices')
      mkdirSync(outDir, { recursive: true })
      for (const job of pdfJobs) writeFileSync(join(outDir, job.name), job.body)
      pdfNote = `${pdfJobs.length} written to ./demo-invoices (NOT uploaded — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset)`
      console.warn(
        `\n⚠ Supabase Storage env is missing, so no PDF was attached to any invoice.\n` +
          `  The ${pdfJobs.length} generated PDFs were written to ./demo-invoices instead.\n` +
          `  Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env and re-run with --with-pdfs to attach them.`
      )
    } else {
      const { uploadInvoiceFile, ensureInvoiceBucket } = await import('@/lib/storage')
      await ensureInvoiceBucket()
      for (const job of pdfJobs) {
        const path = await uploadInvoiceFile(owner, job.name, job.body)
        await prisma.invoice.update({ where: { id: job.invoiceId }, data: { sourceFilePath: path } })
      }
      pdfNote = `${pdfJobs.length} uploaded to the invoices bucket`
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const [nCust, nInv, nCall, nTicket, nPay, nNote] = await Promise.all([
    prisma.customer.count({ where: { ownerId: owner } }),
    prisma.invoice.count({ where: { ownerId: owner } }),
    prisma.call.count({ where: { ownerId: owner } }),
    prisma.ticket.count({ where: { ownerId: owner } }),
    prisma.payment.count({ where: { ownerId: owner } }),
    prisma.note.count({ where: { ownerId: owner } }),
  ])
  const byStatus = await prisma.invoice.groupBy({
    by: ['status'],
    where: { ownerId: owner },
    _count: { _all: true },
  })

  console.log(`\n✔ Demo workspace ready — "${args.business}"`)
  console.log(`  Login:      ${owner} / ${args.password}`)
  console.log(`  Customers:  ${nCust}`)
  console.log(`  Invoices:   ${nInv}  (${byStatus.map((s) => `${s.status}=${s._count._all}`).join(', ')})`)
  console.log(`  Payments:   ${nPay}`)
  console.log(`  Calls:      ${nCall}`)
  console.log(`  Tickets:    ${nTicket}`)
  console.log(`  Notes:      ${nNote}`)
  console.log(`  PDFs:       ${pdfNote}`)
  console.log(`\n  Scheduler is OFF for this tenant, so seeding cannot start real calls.\n`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
