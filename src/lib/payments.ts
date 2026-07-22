import { prisma } from '@/lib/prisma'

// Unified payments ledger (Phase 3-F). demo3.0 tracks *received* payments against
// invoices in the `payment` table (AR); EnvoyIn tracks *inbound-initiated* Stripe
// payments in a ticket's `payment` jsonb. This merges both into one per-owner ledger so
// the merged app has a single payments view — outbound AR receipts + inbound ticket
// payments — keyed to the customer. Everything is ownerId-first and owner-scoped.

export type LedgerEntry = {
  id: string
  source: 'ar' | 'inbound'
  customerId: string | null
  customerName: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  amount: number
  currency: string | null
  date: string // ISO
  type: string | null
  note: string | null
}

export type PaymentSummary = {
  totalReceived: number
  totalCredits: number
  outstanding: number
  entryCount: number
}

const OPEN_INVOICE_STATUSES = ['pending', 'queued', 'calling', 'failed']

// A ticket's `payment` jsonb counts as an inbound payment when it records a non-zero
// amount (mirrors EnvoyIn's Stripe blob shape: { amount, currency, status, paidAt }).
function ticketPaymentEntry(t: {
  id: string
  customerId: string | null
  payment: unknown
  createdAt: Date
  title: string | null
  customer: { businessName: string } | null
}): LedgerEntry | null {
  const p = t.payment
  if (!p || typeof p !== 'object') return null
  const rec = p as Record<string, unknown>
  const amount = typeof rec.amount === 'number' ? rec.amount : Number(rec.amount)
  if (!amount || Number.isNaN(amount)) return null
  const paidAt = typeof rec.paidAt === 'string' ? rec.paidAt : null
  return {
    id: `ticket:${t.id}`,
    source: 'inbound',
    customerId: t.customerId,
    customerName: t.customer?.businessName ?? null,
    invoiceId: null,
    invoiceNumber: null,
    amount,
    currency: typeof rec.currency === 'string' ? rec.currency : null,
    date: (paidAt ?? t.createdAt.toISOString()),
    type: typeof rec.status === 'string' ? rec.status : 'stripe',
    note: t.title,
  }
}

export async function getPaymentsLedger(ownerId: string, customerId?: string): Promise<LedgerEntry[]> {
  const [payments, tickets] = await Promise.all([
    prisma.payment.findMany({
      where: { ownerId, ...(customerId ? { invoice: { customerId } } : {}) },
      include: { invoice: { select: { invoiceNumber: true, currency: true, customerId: true, customer: { select: { businessName: true } } } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.ticket.findMany({
      where: { ownerId, ...(customerId ? { customerId } : {}) },
      select: { id: true, customerId: true, payment: true, createdAt: true, title: true, customer: { select: { businessName: true } } },
    }),
  ])

  const arEntries: LedgerEntry[] = payments.map((p) => ({
    id: p.id,
    source: 'ar',
    customerId: p.invoice?.customerId ?? null,
    customerName: p.invoice?.customer?.businessName ?? null,
    invoiceId: p.invoiceId,
    invoiceNumber: p.invoice?.invoiceNumber ?? null,
    amount: p.payAmount + p.creditAmount,
    currency: p.invoice?.currency ?? null,
    date: (p.payDate ? new Date(`${p.payDate}T00:00:00`).toISOString() : p.createdAt.toISOString()),
    type: p.paymentType ?? (p.creditAmount > 0 && p.payAmount === 0 ? 'credit' : 'payment'),
    note: null,
  }))

  const inboundEntries = tickets.map(ticketPaymentEntry).filter((e): e is LedgerEntry => e !== null)

  return [...arEntries, ...inboundEntries].sort((a, b) => b.date.localeCompare(a.date))
}

export async function getPaymentSummary(ownerId: string, customerId?: string): Promise<PaymentSummary> {
  const [agg, outstandingAgg, ledger] = await Promise.all([
    prisma.payment.aggregate({
      where: { ownerId, ...(customerId ? { invoice: { customerId } } : {}) },
      _sum: { payAmount: true, creditAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { ownerId, status: { in: OPEN_INVOICE_STATUSES }, ...(customerId ? { customerId } : {}) },
      _sum: { amountDue: true, paidAmount: true },
    }),
    getPaymentsLedger(ownerId, customerId),
  ])
  const outstanding = (outstandingAgg._sum.amountDue ?? 0) - (outstandingAgg._sum.paidAmount ?? 0)
  return {
    totalReceived: agg._sum.payAmount ?? 0,
    totalCredits: agg._sum.creditAmount ?? 0,
    outstanding: Math.max(0, outstanding),
    entryCount: ledger.length,
  }
}

export type RecordPaymentInput = {
  invoiceId: string
  payAmount: number
  creditAmount?: number
  payDate?: string | null
  paymentType?: string | null
}

// Record a received payment against one of THIS owner's invoices (IDOR-guarded by
// id + ownerId), advance the invoice's paidAmount, and mark it resolved once fully paid.
export async function recordPayment(ownerId: string, input: RecordPaymentInput) {
  const inv = await prisma.invoice.findFirst({ where: { id: input.invoiceId, ownerId } })
  if (!inv) return null

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        ownerId,
        invoiceId: inv.id,
        payAmount: input.payAmount,
        creditAmount: input.creditAmount ?? 0,
        payDate: input.payDate ?? new Date().toISOString().slice(0, 10),
        paymentType: input.paymentType ?? 'payment',
      },
    })
    const newPaid = (inv.paidAmount ?? 0) + input.payAmount + (input.creditAmount ?? 0)
    const fullyPaid = inv.amountDue != null && newPaid >= inv.amountDue
    await tx.invoice.update({
      where: { id: inv.id },
      data: { paidAmount: newPaid, ...(fullyPaid ? { status: 'resolved' } : {}) },
    })
    return payment
  })
}
