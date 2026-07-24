import { z } from 'zod'

// Shared invoice-parse contract (Phase 3-B). Both the deterministic template path
// (lib/invoice-templates.ts) and the Gemini fallback (api/calls/parse-document) produce
// a `ParsedInvoice` and run it through `normaliseParsedInvoice`, so the response shape is
// identical no matter which path parsed the PDF.

export const LineItemSchema = z.object({
  description: z.string().nullable(),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  amount: z.number().nullable(),
})

export const PaymentDetailsSchema = z.object({
  bankName: z.string().nullable().optional(),
  bsb: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  swiftCode: z.string().nullable().optional(),
  abn: z.string().nullable().optional(),
  remittanceName: z.string().nullable().optional(),
  remittanceContact: z.string().nullable().optional(),
})

export const ParsedInvoiceSchema = z.object({
  vendorName: z.string().nullable(),
  contactBusiness: z.string().nullable(),
  contactPerson: z.string().nullable().optional(),
  toNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  amountDue: z.number().nullable(),
  currency: z.string().nullable(),
  lineItems: z.union([z.array(LineItemSchema), z.string(), z.null()]),
  invoiceNotes: z.string().nullable(),
  paymentDetails: PaymentDetailsSchema.nullable().optional(),
})

export type LineItem = z.infer<typeof LineItemSchema>
export type ParsedInvoice = z.infer<typeof ParsedInvoiceSchema>
export type NormalisedInvoice = ReturnType<typeof normaliseParsedInvoice>

const PHONE_MIN_DIGITS = 9

export function normalisePhone(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || /[A-Za-z]/.test(trimmed)) return null
  const digits = trimmed.replace(/\D/g, '')
  return digits.length >= PHONE_MIN_DIGITS ? trimmed : null
}

function looksLikeBusinessName(value: string | null): value is string {
  if (!value) return false
  const trimmed = value.trim()
  return !!trimmed && /[A-Za-z]/.test(trimmed) && !trimmed.includes('@') && trimmed.length <= 120
}

function looksLikeContactHandle(value: string | null): boolean {
  if (!value) return true
  const trimmed = value.trim()
  return trimmed.includes('@') || (/^[A-Za-z0-9._-]+$/.test(trimmed) && trimmed.includes('.'))
}

export function normaliseParsedInvoice(parsed: ParsedInvoice) {
  const pd = parsed.paymentDetails ?? null
  const toNumber = normalisePhone(parsed.toNumber)
  const contactBusiness =
    !toNumber && looksLikeBusinessName(parsed.toNumber) && looksLikeContactHandle(parsed.contactBusiness ?? null)
      ? parsed.toNumber.trim()
      : parsed.contactBusiness ?? null

  return {
    vendorName: parsed.vendorName,
    contactBusiness,
    contactPerson: parsed.contactPerson ?? null,
    toNumber,
    invoiceNumber: parsed.invoiceNumber,
    invoiceDate: parsed.invoiceDate,
    dueDate: parsed.dueDate,
    amountDue: parsed.amountDue,
    currency: parsed.currency,
    lineItems:
      parsed.lineItems == null
        ? null
        : typeof parsed.lineItems === 'string'
          ? parsed.lineItems
          : JSON.stringify(parsed.lineItems),
    invoiceNotes: parsed.invoiceNotes,
    bankName: pd?.bankName ?? null,
    bsb: pd?.bsb ?? null,
    accountNumber: pd?.accountNumber ?? null,
    swiftCode: pd?.swiftCode ?? null,
    abn: pd?.abn ?? null,
    remittanceName: pd?.remittanceName ?? null,
    remittanceContact: pd?.remittanceContact ?? null,
  }
}
