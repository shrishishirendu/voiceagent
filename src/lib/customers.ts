import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

// Customer (CRM) data-access, ownerId-first and owner-scoped throughout — the master
// Customers screen + Customer detail tab both read through here. A "customer" is the
// debtor entity; the old Contacts screen is folded into this (a contact = a customer
// surfaced with just its contact fields).

export type CustomerSummary = {
  id: string
  businessName: string
  contactPerson: string | null
  contactPhone: string | null
  email: string | null
  abn: string | null
  addressLine: string | null
  city: string | null
  state: string | null
  postCode: string | null
  deliveryInstructions: string | null
  isActive: boolean
  invoiceCount: number
  openInvoiceCount: number
  ticketCount: number
  callCount: number
  outstanding: number // sum of amountDue on non-resolved/cancelled invoices
}

const OPEN_INVOICE_STATUSES = ['pending', 'queued', 'calling', 'failed']

function toSummary(
  c: Prisma.CustomerGetPayload<{ include: { _count: { select: { invoices: true; tickets: true; calls: true } } } }> & {
    openInvoiceCount?: number
    outstanding?: number
  }
): CustomerSummary {
  return {
    id: c.id,
    businessName: c.businessName,
    contactPerson: c.contactPerson,
    contactPhone: c.contactPhone,
    email: c.email1,
    abn: c.abn,
    addressLine: c.addressLine,
    city: c.city,
    state: c.state,
    postCode: c.postCode,
    deliveryInstructions: c.deliveryInstructions,
    isActive: c.isActive,
    invoiceCount: c._count.invoices,
    openInvoiceCount: c.openInvoiceCount ?? 0,
    ticketCount: c._count.tickets,
    callCount: c._count.calls,
    outstanding: c.outstanding ?? 0,
  }
}

export async function getCustomers(ownerId: string): Promise<CustomerSummary[]> {
  const customers = await prisma.customer.findMany({
    where: { ownerId },
    orderBy: { businessName: 'asc' },
    include: { _count: { select: { invoices: true, tickets: true, calls: true } } },
  })

  // Per-customer open-invoice aggregates (one grouped query, then merged in).
  const agg = await prisma.invoice.groupBy({
    by: ['customerId'],
    where: { ownerId, status: { in: OPEN_INVOICE_STATUSES }, customerId: { not: null } },
    _sum: { amountDue: true },
    _count: { _all: true },
  })
  const aggByCustomer = new Map(agg.map((a) => [a.customerId as string, a]))

  return customers.map((c) => {
    const a = aggByCustomer.get(c.id)
    return toSummary({ ...c, openInvoiceCount: a?._count._all ?? 0, outstanding: a?._sum.amountDue ?? 0 })
  })
}

export type CustomerDetail = {
  customer: CustomerSummary
  invoices: {
    id: string
    invoiceNumber: string | null
    invoiceDate: string | null
    dueDate: string | null
    amountDue: number | null
    currency: string | null
    status: string
    sourceFilePath: string | null
    toNumber: string | null
    groupKey: string
  }[]
  tickets: {
    id: string
    title: string | null
    channel: string
    status: string
    tags: string[]
    aiSummary: string | null
    createdAt: Date
  }[]
  calls: {
    id: string
    contactBusiness: string
    status: string
    outcome: string | null
    summary: string | null
    durationSec: number | null
    createdAt: Date
  }[]
}

export async function getCustomer(ownerId: string, id: string): Promise<CustomerDetail | null> {
  const c = await prisma.customer.findFirst({
    where: { id, ownerId },
    include: { _count: { select: { invoices: true, tickets: true, calls: true } } },
  })
  if (!c) return null

  const [invoices, tickets, calls, agg] = await Promise.all([
    prisma.invoice.findMany({
      where: { ownerId, customerId: id },
      orderBy: { dueDate: 'asc' },
      select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, amountDue: true, currency: true, status: true, sourceFilePath: true, toNumber: true, groupKey: true },
    }),
    prisma.ticket.findMany({
      where: { ownerId, customerId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, channel: true, status: true, tags: true, aiSummary: true, createdAt: true },
    }),
    prisma.call.findMany({
      where: { ownerId, customerId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, contactBusiness: true, status: true, outcome: true, summary: true, durationSec: true, createdAt: true },
    }),
    prisma.invoice.aggregate({
      where: { ownerId, customerId: id, status: { in: OPEN_INVOICE_STATUSES } },
      _sum: { amountDue: true },
      _count: { _all: true },
    }),
  ])

  return {
    customer: toSummary({ ...c, openInvoiceCount: agg._count._all, outstanding: agg._sum.amountDue ?? 0 }),
    invoices,
    tickets: tickets.map((t) => ({ ...t, tags: Array.isArray(t.tags) ? (t.tags as string[]) : [] })),
    calls,
  }
}

export type CustomerInput = {
  businessName: string
  contactPerson?: string | null
  contactPhone?: string | null
  email?: string | null
  abn?: string | null
  addressLine?: string | null
  city?: string | null
  state?: string | null
  postCode?: string | null
  deliveryInstructions?: string | null
}

export async function createCustomer(ownerId: string, input: CustomerInput) {
  return prisma.customer.create({
    data: {
      ownerId,
      businessName: input.businessName,
      contactPerson: input.contactPerson ?? null,
      contactPhone: input.contactPhone ?? null,
      email1: input.email ?? null,
      abn: input.abn ?? null,
      addressLine: input.addressLine ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postCode: input.postCode ?? null,
      deliveryInstructions: input.deliveryInstructions ?? null,
    },
  })
}

export async function updateCustomer(ownerId: string, id: string, input: Partial<CustomerInput>) {
  // id + ownerId — IDOR guard.
  const existing = await prisma.customer.findFirst({ where: { id, ownerId }, select: { id: true } })
  if (!existing) return null
  return prisma.customer.update({
    where: { id },
    data: {
      ...(input.businessName !== undefined && { businessName: input.businessName }),
      ...(input.contactPerson !== undefined && { contactPerson: input.contactPerson }),
      ...(input.contactPhone !== undefined && { contactPhone: input.contactPhone }),
      ...(input.email !== undefined && { email1: input.email }),
      ...(input.abn !== undefined && { abn: input.abn }),
      ...(input.addressLine !== undefined && { addressLine: input.addressLine }),
      ...(input.city !== undefined && { city: input.city }),
      ...(input.state !== undefined && { state: input.state }),
      ...(input.postCode !== undefined && { postCode: input.postCode }),
      ...(input.deliveryInstructions !== undefined && { deliveryInstructions: input.deliveryInstructions }),
    },
  })
}
