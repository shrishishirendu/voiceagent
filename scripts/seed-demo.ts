/**
 * Seed a demo tenant on top of the imported invoices so every screen renders populated:
 *   - a Tenant row (so the app doesn't force onboarding) + caller-id
 *   - phone numbers on customers + their invoices (so dispatch is possible)
 *   - a handful of Call + Ticket rows across the outbound lifecycle so the Tickets board
 *     shows cards in every lane and the Outbound/Analytics dashboards have real data
 *
 *   npx tsx scripts/seed-demo.ts --owner=you@example.com
 *
 * Idempotent: clears this owner's demo calls/tickets and resets invoice statuses first.
 * Run AFTER import-invoices.ts.
 */
import 'dotenv/config'
import { prisma } from '@/lib/prisma'

type TLine = { who: 'envoy' | 'them'; text: string }

function ownerArg(): string {
  const a = process.argv.slice(2).find((x) => x.startsWith('--owner='))
  const owner = a?.slice('--owner='.length).trim().toLowerCase()
  if (!owner) {
    console.error('Usage: tsx scripts/seed-demo.ts --owner=<email>')
    process.exit(2)
  }
  return owner
}

async function main() {
  const owner = ownerArg()

  // 1) Tenant + settings so the /app gate passes.
  await prisma.tenant.upsert({
    where: { ownerId: owner },
    create: { ownerId: owner, businessName: 'iSoft Collections', phoneNumber: '+61255500000', data: { industry: 'Accounts receivable', objectiveDefault: 'Chase overdue invoices politely.' } },
    update: { businessName: 'iSoft Collections' },
  })
  await prisma.settings.upsert({
    where: { ownerId: owner },
    create: { ownerId: owner },
    update: {},
  })

  // 2) Give customers + their invoices phone numbers so they can be dispatched.
  const customers = await prisma.customer.findMany({ where: { ownerId: owner }, orderBy: { businessName: 'asc' } })
  const phones: Record<string, string> = {}
  let n = 10
  for (const c of customers) {
    const phone = `+6125550${String(n).padStart(4, '0')}`
    n += 11
    phones[c.id] = phone
    await prisma.customer.update({ where: { id: c.id }, data: { contactPhone: phone, contactPerson: c.contactPerson ?? 'Accounts Payable' } })
    await prisma.invoice.updateMany({ where: { ownerId: owner, customerId: c.id }, data: { toNumber: phone } })
  }

  // 3) Reset prior demo state so re-runs are clean.
  await prisma.ticket.deleteMany({ where: { ownerId: owner } })
  await prisma.callInvoice.deleteMany({ where: { call: { ownerId: owner } } })
  await prisma.call.deleteMany({ where: { ownerId: owner } })
  await prisma.invoice.updateMany({ where: { ownerId: owner }, data: { status: 'stored', paidAmount: 0 } })

  const byCustomer = new Map(customers.map((c) => [c.businessName, c]))
  const acme = byCustomer.get('ACME') ?? customers[0]
  const isoft = byCustomer.get('iSoft') ?? customers[1] ?? customers[0]

  const acmeInv = await prisma.invoice.findMany({ where: { ownerId: owner, customerId: acme.id }, orderBy: { invoiceNumber: 'asc' } })
  const isoftInv = await prisma.invoice.findMany({ where: { ownerId: owner, customerId: isoft.id }, orderBy: { invoiceNumber: 'asc' } })

  let seq = 0
  async function makeCallTicket(opts: {
    customerId: string
    business: string
    phone: string
    invoice?: { id: string; invoiceNumber: string | null; amountDue: number | null } | null
    callStatus: string
    outcome: string | null
    ticketStatus: string
    summary: string | null
    transcript?: TLine[]
    voicemailScript?: string
    endedReason?: string
    invoiceStatusAfter?: string
    markPaid?: boolean
  }) {
    seq++
    const call = await prisma.call.create({
      data: {
        ownerId: owner,
        customerId: opts.customerId,
        contactBusiness: opts.business,
        contactPerson: 'Accounts Payable',
        toNumber: opts.phone,
        objective: `Follow up on payment for invoice ${opts.invoice?.invoiceNumber ?? ''}. Confirm whether payment has been made or arrange a settlement date.`,
        vapiCallId: `demo-${owner.split('@')[0]}-${seq}-${Date.now()}`,
        status: opts.callStatus,
        outcome: opts.outcome ?? undefined,
        durationSec: opts.callStatus === 'completed' || opts.callStatus === 'failed' ? 60 + seq * 23 : undefined,
        endedReason: opts.endedReason,
        summary: opts.summary ?? undefined,
        transcript: opts.transcript ? (opts.transcript as unknown as object) : undefined,
        voicemailScript: opts.voicemailScript,
        invoiceNumber: opts.invoice?.invoiceNumber ?? undefined,
        amountDue: opts.invoice?.amountDue ?? undefined,
        currency: 'AUD',
      },
    })
    if (opts.invoice) {
      await prisma.callInvoice.create({ data: { callId: call.id, invoiceId: opts.invoice.id } })
      if (opts.invoiceStatusAfter) {
        await prisma.invoice.update({
          where: { id: opts.invoice.id },
          data: { status: opts.invoiceStatusAfter, ...(opts.markPaid && opts.invoice.amountDue ? { paidAmount: opts.invoice.amountDue } : {}) },
        })
      }
    }
    await prisma.ticket.create({
      data: {
        ownerId: owner,
        customerId: opts.customerId,
        callId: call.id,
        channel: 'phone',
        status: opts.ticketStatus,
        tags: ['outbound'],
        title: `${opts.business} · #${opts.invoice?.invoiceNumber ?? '—'}`,
        requester: opts.business,
        aiSummary: opts.summary,
      },
    })
  }

  // Resolved (ACME) — payment arranged, invoice marked resolved + paid.
  await makeCallTicket({
    customerId: acme.id, business: 'ACME', phone: phones[acme.id], invoice: acmeInv[0],
    callStatus: 'completed', outcome: 'success', ticketStatus: 'Resolved',
    summary: 'Spoke with accounts payable; payment confirmed as scheduled for this Friday.',
    transcript: [
      { who: 'envoy', text: `Hi, this is Envoy calling on behalf of iSoft about invoice #${acmeInv[0]?.invoiceNumber}.` },
      { who: 'them', text: 'Oh yes, that one is in our next payment run this Friday.' },
      { who: 'envoy', text: 'Perfect, I appreciate you confirming. Have a great day.' },
    ],
    invoiceStatusAfter: 'resolved', markPaid: true,
  })

  // Voicemail (ACME) — no answer, message left.
  await makeCallTicket({
    customerId: acme.id, business: 'ACME', phone: phones[acme.id], invoice: acmeInv[1],
    callStatus: 'completed', outcome: 'no-answer', ticketStatus: 'In Progress',
    endedReason: 'voicemail',
    summary: 'No answer — left a voicemail requesting a callback about the overdue balance.',
    voicemailScript: `Hi, this is Envoy calling on behalf of iSoft regarding invoice #${acmeInv[1]?.invoiceNumber}. Please call us back to arrange payment. Thank you.`,
  })

  // Failed (iSoft) — line busy.
  await makeCallTicket({
    customerId: isoft.id, business: 'iSoft', phone: phones[isoft.id], invoice: isoftInv[0],
    callStatus: 'failed', outcome: 'failed', ticketStatus: 'In Progress',
    endedReason: 'customer-busy',
    summary: 'Call could not connect (line busy). Will retry.',
    invoiceStatusAfter: 'failed',
  })

  // Calling (iSoft) — active call in progress.
  await makeCallTicket({
    customerId: isoft.id, business: 'iSoft', phone: phones[isoft.id], invoice: isoftInv[1],
    callStatus: 'in-progress', outcome: null, ticketStatus: 'In Progress',
    summary: null,
    invoiceStatusAfter: 'calling',
  })

  // Queued (ACME) — enqueued, not yet dialled (ticket with no call).
  if (acmeInv[2]) await prisma.invoice.update({ where: { id: acmeInv[2].id }, data: { status: 'pending' } })
  await prisma.ticket.create({
    data: {
      ownerId: owner, customerId: acme.id, callId: null, channel: 'phone', status: 'In Progress',
      tags: ['outbound'], title: `ACME · #${acmeInv[2]?.invoiceNumber ?? '—'}`, requester: 'ACME',
      aiSummary: 'Queued for chasing — awaiting a free call slot.',
    },
  })

  const tickets = await prisma.ticket.count({ where: { ownerId: owner } })
  const calls = await prisma.call.count({ where: { ownerId: owner } })
  const invByStatus = await prisma.invoice.groupBy({ by: ['status'], where: { ownerId: owner }, _count: { _all: true } })
  console.log(`Seeded: tenant + ${customers.length} customers, ${calls} calls, ${tickets} tickets.`)
  console.log('Invoice statuses:', JSON.stringify(invByStatus.map((s) => ({ [s.status]: s._count._all }))))
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
