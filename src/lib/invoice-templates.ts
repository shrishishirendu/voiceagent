import type { LineItem, ParsedInvoice } from '@/lib/invoice-parse'

// Deterministic invoice-template registry (Phase 3-B). Recurring vendors have a stable
// layout, so instead of paying for a Gemini vision call every time we fingerprint the
// extracted PDF text against a known vendor and pull the fields with regex. If no
// template matches (or the extraction fails validation) the caller falls back to Gemini.
// Everything here is pure string→struct: no I/O, unit-testable against fixture text.

// ── shared helpers ───────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}
const pad = (n: number) => String(n).padStart(2, '0')
const y4 = (y: string) => {
  const n = Number(y)
  return n < 100 ? 2000 + n : n
}

// Parse the date formats these vendors use → YYYY-MM-DD (or null).
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  let m: RegExpMatchArray | null
  // 6 May 2026 / 15 Jun 2026
  if ((m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{2,4})/))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mo) return `${y4(m[3])}-${pad(mo)}-${pad(Number(m[1]))}`
  }
  // 19-DEC-2025 / 18-JAN-26
  if ((m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/))) {
    const mo = MONTHS[m[2].toLowerCase()]
    if (mo) return `${y4(m[3])}-${pad(mo)}-${pad(Number(m[1]))}`
  }
  // 30/11/2025 / 1/05/2026
  if ((m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) {
    return `${y4(m[3])}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`
  }
  // already ISO
  if ((m = s.match(/(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const n = Number(String(raw).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const endOfMonth = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
}

const first = (text: string, re: RegExp): string | null => {
  const m = text.match(re)
  return m ? m[1].trim() : null
}
// Largest $-amount in the text — a robust "grand total" when the label is ambiguous.
const maxAmount = (text: string): number | null => {
  const nums = [...text.matchAll(/([\d,]+\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, '')))
  return nums.length ? Math.max(...nums) : null
}

// The recipient/debtor on every sample is iSoft — pull it when present, else null.
const recipient = (text: string): string | null => (/i-?soft/i.test(text) ? 'iSoft' : null)

// ── template type ────────────────────────────────────────────────────────────
export type InvoiceTemplate = {
  id: string
  label: string
  detect: (text: string) => boolean
  extract: (text: string) => ParsedInvoice
}

const base = (): ParsedInvoice => ({
  vendorName: null, contactBusiness: null, contactPerson: null, toNumber: null,
  invoiceNumber: null, invoiceDate: null, dueDate: null, amountDue: null, currency: 'AUD',
  lineItems: null, invoiceNotes: null, paymentDetails: null,
})

// ── templates ────────────────────────────────────────────────────────────────
const TEMPLATES: InvoiceTemplate[] = [
  {
    id: 'spiced-tea-chai',
    label: 'Spiced Tea Chai (Xero)',
    detect: (t) => /spiced\s*tea\s*chai/i.test(t),
    extract: (t) => {
      const items: LineItem[] = [...t.matchAll(/([A-Za-z][A-Za-z ]+?Tea)\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+GST Free\s+(\d+\.\d{2})/g)].map((m) => ({
        description: m[1].trim(), quantity: Number(m[2]), unitPrice: Number(m[3]), amount: Number(m[4]),
      }))
      return {
        ...base(),
        vendorName: 'Spiced Tea',
        contactBusiness: recipient(t),
        invoiceNumber: first(t, /\b(INV-\d{3,})\b/),
        invoiceDate: parseDate(first(t, /Invoice Date\s*([0-9]{1,2}\s+[A-Za-z]+\s+\d{4})/i)),
        dueDate: parseDate(first(t, /Due Date:\s*([0-9]{1,2}\s+[A-Za-z]+\s+\d{4})/i)),
        amountDue: parseAmount(first(t, /TOTAL\s+AUD\s*([\d,]+\.\d{2})/i)),
        lineItems: items.length ? items : null,
        paymentDetails: {
          bankName: /Commonwealth Bank of Australia/i.test(t) ? 'Commonwealth Bank of Australia' : null,
          bsb: first(t, /Account BSB:\s*(\d{3}-\d{3})/i),
          accountNumber: first(t, /Account Number:\s*(\d{6,})/i),
          remittanceName: first(t, /Account Name:\s*([A-Za-z][A-Za-z ]+?Pty Ltd)/i),
        },
      }
    },
  },
  {
    id: 'quest-software',
    label: 'Quest Software International',
    detect: (t) => /Quest Software International/i.test(t),
    extract: (t) => ({
      ...base(),
      vendorName: 'Quest Software',
      contactBusiness: recipient(t),
      contactPerson: first(t, /ISOFT SOFTWARE TECHNOLOGIES PTY LTD\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/),
      invoiceNumber: first(t, /\b(4\d{9})\b/),
      invoiceDate: parseDate(first(t, /\b(\d{1,2}-[A-Z]{3}-\d{4})\b/)),
      dueDate: parseDate(first(t, /\b(\d{1,2}-[A-Z]{3}-\d{2})\b/)),
      amountDue: parseAmount(first(t, /Total\s+([\d,]+\.\d{2})\s+AUD/i)),
      lineItems: (() => {
        const m = t.match(/(\d{1,3})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+0\.00/)
        const desc = first(t, /(ERWIN DATA MODELER[\s\S]*?LICENSE\/MAINT)/i)
        if (!m) return null
        return [{ description: desc ? desc.replace(/\s+/g, ' ').trim() : null, quantity: Number(m[1]), unitPrice: parseAmount(m[2]), amount: parseAmount(m[3]) }]
      })(),
      paymentDetails: {
        bankName: /Deutsche Bank AG/i.test(t) ? 'Deutsche Bank AG' : null,
        bsb: first(t, /Branch#?\s*(\d{6})/i),
        accountNumber: first(t, /BSB Account#?\s*(\d{6,})/i),
        swiftCode: first(t, /Swift Code:\s*([A-Z0-9]{8,11})/i),
        abn: first(t, /ABN\s*#?\s*([\d ]{11,14})/i),
        remittanceName: 'Quest Software International Limited',
      },
    }),
  },
  {
    id: 'altus-financial',
    label: 'Altus Financial',
    detect: (t) => /Altus (Financial|Business Advisers)/i.test(t),
    extract: (t) => {
      const invoiceDate = parseDate(first(t, /Invoice Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i))
      const fee = parseAmount(first(t, /Total Fee\s*\$?([\d,]+\.\d{2})/i))
      return {
        ...base(),
        vendorName: 'Altus',
        contactBusiness: recipient(t),
        invoiceNumber: first(t, /Invoice #:\s*(\d{5,})/i),
        invoiceDate,
        dueDate: invoiceDate ? addDays(invoiceDate, 14) : null, // "Strictly 14 days from date of Tax Invoice"
        amountDue: parseAmount(first(t, /Amount Due\s*\$?([\d,]+\.\d{2})/i)),
        lineItems: fee != null ? [{ description: 'Monthly fee for professional services as per annual agreement', quantity: null, unitPrice: fee, amount: fee }] : null,
        invoiceNotes: 'Please quote invoice # in the payment reference.',
        paymentDetails: {
          bsb: first(t, /BSB:\s*(\d{3} ?\d{3})/i),
          accountNumber: first(t, /Account:\s*([\d ]+\d)/i),
          remittanceName: first(t, /Account Name:\s*(Altus[A-Za-z ]+?Pty Ltd)/i),
          remittanceContact: first(t, /Remittance:\s*([^\s]+@[^\s]+)/i),
          abn: first(t, /ABN\s*([\d ]{9,14})/i),
        },
      }
    },
  },
  {
    id: 'green-design',
    label: 'Green Design Indoor Plant Hire',
    detect: (t) => /Green Design/i.test(t),
    extract: (t) => {
      const invoiceDate = parseDate(first(t, /Date:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i))
      const inc = parseAmount(first(t, /Plant rental[^\n]*?([\d,]+\.\d{2})\s*$/im)) ?? maxAmount(t)
      return {
        ...base(),
        vendorName: 'Green Design',
        contactBusiness: recipient(t),
        invoiceNumber: first(t, /\b(\d{7})\b/),
        invoiceDate,
        dueDate: invoiceDate ? endOfMonth(invoiceDate) : null, // "paid before the end of that month"
        amountDue: maxAmount(t), // Including-GST total is the largest figure
        lineItems: inc != null ? [{ description: 'Plant rental for the current month', quantity: null, unitPrice: null, amount: inc }] : null,
        paymentDetails: {
          bsb: first(t, /BSB Number:\s*(\d{3} ?\d{3})/i),
          accountNumber: first(t, /Account Number:\s*(\d{6,})/i),
          swiftCode: first(t, /Swift Code:\s*([A-Z]{4}\s?[A-Z]{2}\s?[A-Z0-9]{4,6})/i),
          abn: first(t, /ABN:\s*([\d ]{9,14})/i),
          remittanceName: 'Green Design Indoor Plant Hire Pty Ltd',
        },
      }
    },
  },
  {
    id: 'vertel',
    label: 'Vertel / Vertical Telecoms',
    detect: (t) => /Vertical Telecoms|vertel/i.test(t),
    extract: (t) => {
      const items: LineItem[] = [...t.matchAll(/(VERT\d+:[^\n]+?)\s+EA\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/g)].map((m) => ({
        description: m[1].replace(/\s+/g, ' ').trim(), quantity: null, unitPrice: parseAmount(m[2]), amount: parseAmount(m[3]),
      }))
      return {
        ...base(),
        vendorName: 'Vertel',
        contactBusiness: recipient(t),
        invoiceNumber: first(t, /Invoice number\s*:?\s*([A-Z0-9]{6,})/i),
        invoiceDate: parseDate(first(t, /\bDate\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)),
        dueDate: parseDate(first(t, /Due Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)),
        amountDue: parseAmount(first(t, /Total Including GST\s*([\d,]+\.\d{2})/i)),
        lineItems: items.length ? items : null,
        paymentDetails: {
          bankName: /WESTPAC/i.test(t) ? 'Westpac' : null,
          bsb: first(t, /WESTPAC\s*(\d{3}-?\d{3})/i),
          accountNumber: first(t, /Account No\.?:?\s*(\d{5,})/i),
          abn: first(t, /ABN:\s*([\d ]{9,14})/i),
          remittanceContact: first(t, /remittance advice to\s*([^\s]+@[^\s]+)/i),
        },
      }
    },
  },
]

// A deterministic extraction is trustworthy enough to skip Gemini only when it got the
// essentials: an invoice number, an amount, and at least one date.
export function isExtractionValid(p: ParsedInvoice): boolean {
  return !!p.invoiceNumber && p.amountDue != null && !!(p.invoiceDate || p.dueDate)
}

export type TemplateMatch = { templateId: string; label: string; parsed: ParsedInvoice; valid: boolean }

// Fingerprint the text against the registry; return the first matching template's
// extraction (with a validity flag), or null if no template recognises the vendor.
export function matchTemplate(text: string): TemplateMatch | null {
  for (const tpl of TEMPLATES) {
    if (!tpl.detect(text)) continue
    const parsed = tpl.extract(text)
    return { templateId: tpl.id, label: tpl.label, parsed, valid: isExtractionValid(parsed) }
  }
  return null
}

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id)
