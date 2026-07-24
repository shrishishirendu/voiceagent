import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { computeGroupKey, normalisePhone, resolveCustomerId, parseLineItemRows, getSettings } from '@/lib/dispatcher'
import { companyNamesMatch } from '@/lib/nameUtils'

// Shared invoice-persistence path used by every ingest surface: the website upload
// (POST /api/invoices), the bulk JSON/PDF import (scripts/import-invoices.ts + the import
// route), and any future seeder. Keeping the customer-resolve + dedup + groupKey + line-item
// logic in ONE place means the three paths can never diverge in how they write the DB —
// and because dispatch reads purely from these columns, a persisted invoice is dispatchable
// later with zero re-parse.

type DbClient = Prisma.TransactionClient | typeof prisma

// An invoice can rest in the library as `stored` (uploaded/parsed but not scheduled) or
// enter the active call queue as `pending`. Both are counted as "already ingested" for
// dedup so re-uploading the same invoice number collapses onto the existing row.
export const INGESTED_STATUSES = ['stored', 'pending', 'queued', 'calling'] as const

export type InvoiceRowInput = {
  contactBusiness: string
  contactPerson?: string | null
  toNumber?: string | null
  objective: string
  voice?: string
  manner?: string
  userName?: string
  invoiceNumber?: string | null
  invoiceDate?: string | null
  dueDate?: string | null
  amountDue?: number | null
  currency?: string | null
  lineItems?: string | null // serialized JSON string (see dispatcher.serializeLineItems)
  invoiceNotes?: string | null
  bankName?: string | null
  bsb?: string | null
  accountNumber?: string | null
  swiftCode?: string | null
  abn?: string | null
  remittanceName?: string | null
  remittanceContact?: string | null
  sourceFilePath?: string | null
}

export type CreateInvoiceResult = {
  duplicate: boolean
  id: string
  groupKey: string
  chaseAfter: Date
}

// chaseAfter = dueDate + offsetDays (00:00 recipient-naive). No/invalid dueDate ⇒
// eligible immediately (chaseAfter = now). Only meaningful once a row is `pending`.
export function computeChaseAfter(dueDate: string | null | undefined, offsetDays: number): Date {
  if (!dueDate) return new Date()
  const d = new Date(`${dueDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return new Date()
  d.setDate(d.getDate() + offsetDays)
  return d
}

/**
 * Create (or dedup onto an existing) invoice row + its line-item rows, resolving the debtor
 * Customer along the way. MUST be called inside a transaction (`db` = the tx client) so the
 * fuzzy group-key resolution + dup check + insert can't race a concurrent create for the same
 * business (bulk uploads fire many of these in quick succession).
 */
export async function createInvoiceRow(
  db: DbClient,
  ownerId: string,
  input: InvoiceRowInput,
  opts: { status: 'stored' | 'pending'; dueOffsetDays: number }
): Promise<CreateInvoiceResult> {
  const chaseAfter = computeChaseAfter(input.dueDate, opts.dueOffsetDays)
  const fallbackGroupKey = computeGroupKey(input.abn ?? undefined, input.contactBusiness)

  const activeInvoices = await db.invoice.findMany({
    where: { ownerId, status: { in: [...INGESTED_STATUSES] } },
    select: { groupKey: true, contactBusiness: true },
  })
  const matchedGroup = activeInvoices.find((i) => companyNamesMatch(i.contactBusiness, input.contactBusiness))
  const resolvedGroupKey = matchedGroup?.groupKey ?? fallbackGroupKey

  // Idempotent: if an already-ingested invoice with the same number exists for this debtor, return it.
  if (input.invoiceNumber) {
    const dup = await db.invoice.findFirst({
      where: { ownerId, groupKey: resolvedGroupKey, invoiceNumber: input.invoiceNumber, status: { in: [...INGESTED_STATUSES] } },
    })
    if (dup) return { duplicate: true, id: dup.id, groupKey: resolvedGroupKey, chaseAfter: dup.chaseAfter }
  }

  const normalisedPhone = input.toNumber ? normalisePhone(input.toNumber) : null
  const customerId = await resolveCustomerId(db, {
    ownerId,
    abn: input.abn ?? undefined,
    businessName: input.contactBusiness,
    contactPerson: input.contactPerson ?? undefined,
    phone: normalisedPhone,
  })

  const invoice = await db.invoice.create({
    data: {
      ownerId,
      customerId,
      contactBusiness: input.contactBusiness,
      contactPerson: input.contactPerson ?? null,
      toNumber: normalisedPhone,
      abn: input.abn ?? null,
      groupKey: resolvedGroupKey,
      userName: input.userName ?? 'the caller',
      voice: input.voice ?? 'iris',
      manner: input.manner ?? 'warm',
      objective: input.objective,
      invoiceNumber: input.invoiceNumber ?? null,
      invoiceDate: input.invoiceDate ?? null,
      dueDate: input.dueDate ?? null,
      amountDue: input.amountDue ?? null,
      totalAmount: input.amountDue ?? null,
      currency: input.currency ?? null,
      invoiceNotes: input.invoiceNotes ?? null,
      bankName: input.bankName ?? null,
      bsb: input.bsb ?? null,
      accountNumber: input.accountNumber ?? null,
      swiftCode: input.swiftCode ?? null,
      remittanceName: input.remittanceName ?? null,
      remittanceContact: input.remittanceContact ?? null,
      sourceFilePath: input.sourceFilePath ?? null,
      chaseAfter,
      status: opts.status,
    },
  })

  const rows = parseLineItemRows(input.lineItems ?? undefined)
  if (rows.length > 0) {
    await db.invoiceLineItem.createMany({ data: rows.map((r) => ({ ...r, invoiceId: invoice.id })) })
  }

  return { duplicate: false, id: invoice.id, groupKey: resolvedGroupKey, chaseAfter }
}

/** Convenience for callers outside a request that already have an owner: wraps in a transaction. */
export async function persistInvoice(
  ownerId: string,
  input: InvoiceRowInput,
  opts: { status: 'stored' | 'pending'; dueOffsetDays?: number }
): Promise<CreateInvoiceResult> {
  const dueOffsetDays = opts.dueOffsetDays ?? (await getSettings(ownerId)).dueOffsetDays
  return prisma.$transaction((tx) => createInvoiceRow(tx, ownerId, input, { status: opts.status, dueOffsetDays }))
}
