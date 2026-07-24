import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { sumOutstandingByCurrency, isOutstanding, type MoneyByCurrency } from '@/lib/money'

// Customer (CRM) data-access, ownerId-first and owner-scoped throughout — the master
// Customers screen + Customer detail tab both read through here. A "customer" is the
// debtor entity; the old Contacts screen is folded into this (a contact = a customer
// surfaced with just its contact fields).

export type CustomerSummary = {
  id: string
  accountCode: string | null
  businessName: string
  contactPerson: string | null
  contactPhone: string | null
  email: string | null
  email2: string | null
  abn: string | null
  addressLine: string | null
  city: string | null
  state: string | null
  postCode: string | null
  deliveryInstructions: string | null
  paymentTermsDays: number | null
  creditLimit: number | null
  balanceAmount: number
  ignoreMinPrice: boolean
  ignoreProductMinPrice: boolean
  hideInvoice: boolean
  isActive: boolean
  salesPersonId: string | null
  salesPersonName: string | null
  locationId: string | null
  locationCode: string | null
  locationName: string | null
  invoiceCount: number
  openInvoiceCount: number // count of outstanding (unpaid + past-due) invoices
  ticketCount: number
  callCount: number
  outstanding: MoneyByCurrency // unpaid + past-due amounts, bucketed per currency
}

// Fields needed to decide/aggregate outstanding for a set of invoices.
const OUTSTANDING_SELECT = { customerId: true, amountDue: true, paidAmount: true, currency: true, dueDate: true, status: true } as const

// Relations + counts every summary read pulls in.
const customerInclude = {
  _count: { select: { invoices: true, tickets: true, calls: true } },
  salesPerson: { select: { name: true } },
  location: { select: { code: true, name: true } },
} satisfies Prisma.CustomerInclude

function toSummary(
  c: Prisma.CustomerGetPayload<{ include: typeof customerInclude }> & {
    openInvoiceCount?: number
    outstanding?: MoneyByCurrency
  }
): CustomerSummary {
  return {
    id: c.id,
    accountCode: c.accountCode,
    businessName: c.businessName,
    contactPerson: c.contactPerson,
    contactPhone: c.contactPhone,
    email: c.email1,
    email2: c.email2,
    abn: c.abn,
    addressLine: c.addressLine,
    city: c.city,
    state: c.state,
    postCode: c.postCode,
    deliveryInstructions: c.deliveryInstructions,
    paymentTermsDays: c.paymentTermsDays,
    creditLimit: c.creditLimit,
    balanceAmount: c.balanceAmount,
    ignoreMinPrice: c.ignoreMinPrice,
    ignoreProductMinPrice: c.ignoreProductMinPrice,
    hideInvoice: c.hideInvoice,
    isActive: c.isActive,
    salesPersonId: c.salesPersonId,
    salesPersonName: c.salesPerson?.name ?? null,
    locationId: c.locationId,
    locationCode: c.location?.code ?? null,
    locationName: c.location?.name ?? null,
    invoiceCount: c._count.invoices,
    openInvoiceCount: c.openInvoiceCount ?? 0,
    ticketCount: c._count.tickets,
    callCount: c._count.calls,
    outstanding: c.outstanding ?? [],
  }
}

export async function getCustomers(ownerId: string): Promise<CustomerSummary[]> {
  const customers = await prisma.customer.findMany({
    where: { ownerId },
    orderBy: { businessName: 'asc' },
    include: customerInclude,
  })

  // Outstanding = unpaid + past-due, computed in code (text dates + multi-currency can't be
  // aggregated in SQL). Fetch the candidate invoices once and group by customer.
  const now = new Date()
  const rows = await prisma.invoice.findMany({
    where: { ownerId, customerId: { not: null } },
    select: OUTSTANDING_SELECT,
  })
  const byCustomer = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = r.customerId as string
    const list = byCustomer.get(key) ?? []
    list.push(r)
    byCustomer.set(key, list)
  }

  return customers.map((c) => {
    const list = byCustomer.get(c.id) ?? []
    return toSummary({
      ...c,
      openInvoiceCount: list.filter((r) => isOutstanding(r, now)).length,
      outstanding: sumOutstandingByCurrency(list, now),
    })
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
    totalAmount: number | null
    paidAmount: number | null
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
    include: customerInclude,
  })
  if (!c) return null

  const [invoices, tickets, calls] = await Promise.all([
    prisma.invoice.findMany({
      where: { ownerId, customerId: id },
      orderBy: { dueDate: 'asc' },
      select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, amountDue: true, totalAmount: true, paidAmount: true, currency: true, status: true, sourceFilePath: true, toNumber: true, groupKey: true },
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
  ])

  // Outstanding = unpaid + past-due, computed from the fetched invoices (no extra query).
  const now = new Date()
  const openInvoiceCount = invoices.filter((r) => isOutstanding(r, now)).length
  const outstanding = sumOutstandingByCurrency(invoices, now)

  return {
    customer: toSummary({ ...c, openInvoiceCount, outstanding }),
    invoices,
    tickets: tickets.map((t) => ({ ...t, tags: Array.isArray(t.tags) ? (t.tags as string[]) : [] })),
    calls,
  }
}

export type CustomerInput = {
  businessName: string
  accountCode?: string | null
  contactPerson?: string | null
  contactPhone?: string | null
  email?: string | null
  email2?: string | null
  abn?: string | null
  addressLine?: string | null
  city?: string | null
  state?: string | null
  postCode?: string | null
  deliveryInstructions?: string | null
  paymentTermsDays?: number | null
  creditLimit?: number | null
  balanceAmount?: number | null
  ignoreMinPrice?: boolean
  ignoreProductMinPrice?: boolean
  hideInvoice?: boolean
  isActive?: boolean
  salesPersonId?: string | null
  locationId?: string | null
}

export async function createCustomer(ownerId: string, input: CustomerInput) {
  return prisma.customer.create({
    data: {
      ownerId,
      businessName: input.businessName,
      accountCode: input.accountCode ?? null,
      contactPerson: input.contactPerson ?? null,
      contactPhone: input.contactPhone ?? null,
      email1: input.email ?? null,
      email2: input.email2 ?? null,
      abn: input.abn ?? null,
      addressLine: input.addressLine ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postCode: input.postCode ?? null,
      deliveryInstructions: input.deliveryInstructions ?? null,
      paymentTermsDays: input.paymentTermsDays ?? null,
      creditLimit: input.creditLimit ?? null,
      salesPersonId: input.salesPersonId ?? null,
      locationId: input.locationId ?? null,
      ...(input.balanceAmount != null && { balanceAmount: input.balanceAmount }),
      ...(input.ignoreMinPrice != null && { ignoreMinPrice: input.ignoreMinPrice }),
      ...(input.ignoreProductMinPrice != null && { ignoreProductMinPrice: input.ignoreProductMinPrice }),
      ...(input.hideInvoice != null && { hideInvoice: input.hideInvoice }),
      ...(input.isActive != null && { isActive: input.isActive }),
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
      ...(input.accountCode !== undefined && { accountCode: input.accountCode }),
      ...(input.contactPerson !== undefined && { contactPerson: input.contactPerson }),
      ...(input.contactPhone !== undefined && { contactPhone: input.contactPhone }),
      ...(input.email !== undefined && { email1: input.email }),
      ...(input.email2 !== undefined && { email2: input.email2 }),
      ...(input.abn !== undefined && { abn: input.abn }),
      ...(input.addressLine !== undefined && { addressLine: input.addressLine }),
      ...(input.city !== undefined && { city: input.city }),
      ...(input.state !== undefined && { state: input.state }),
      ...(input.postCode !== undefined && { postCode: input.postCode }),
      ...(input.deliveryInstructions !== undefined && { deliveryInstructions: input.deliveryInstructions }),
      ...(input.paymentTermsDays !== undefined && { paymentTermsDays: input.paymentTermsDays }),
      ...(input.creditLimit !== undefined && { creditLimit: input.creditLimit }),
      ...(input.balanceAmount !== undefined && input.balanceAmount != null && { balanceAmount: input.balanceAmount }),
      ...(input.ignoreMinPrice !== undefined && { ignoreMinPrice: input.ignoreMinPrice }),
      ...(input.ignoreProductMinPrice !== undefined && { ignoreProductMinPrice: input.ignoreProductMinPrice }),
      ...(input.hideInvoice !== undefined && { hideInvoice: input.hideInvoice }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      ...(input.salesPersonId !== undefined && { salesPersonId: input.salesPersonId }),
      ...(input.locationId !== undefined && { locationId: input.locationId }),
    },
  })
}

// ── Reference lists (sales persons + locations) for the customer edit dropdowns ──
export async function listSalesPersons(ownerId: string) {
  return prisma.salesPerson.findMany({
    where: { ownerId, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
}

export async function listLocations(ownerId: string) {
  return prisma.location.findMany({
    where: { ownerId, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true },
  })
}
