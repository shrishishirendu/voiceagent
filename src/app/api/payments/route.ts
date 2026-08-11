import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAccess, unauthorized, requireCapability } from '@/lib/access'
import { canRecordPayment, canViewPayments } from '@/lib/permissions'
import { getPaymentsLedger, getPaymentSummary, recordPayment } from '@/lib/payments'

export const dynamic = 'force-dynamic'

// Unified payments ledger (Phase 3-F). GET returns the merged AR + inbound-ticket ledger
// plus totals, optionally scoped to one customer (?customerId=). POST records a received
// payment against an invoice (admin+).
export async function GET(req: NextRequest) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  // Agents read the ledger — knowing whether an invoice has already been paid is exactly
  // what stops them chasing a settled debt. Only admin+ may record one (see POST).
  const denied = requireCapability(access, canViewPayments)
  if (denied) return denied
  const customerId = req.nextUrl.searchParams.get('customerId') ?? undefined
  const [ledger, summary] = await Promise.all([
    getPaymentsLedger(access.ownerId, customerId),
    getPaymentSummary(access.ownerId, customerId),
  ])
  return NextResponse.json({ ledger, summary })
}

const RecordSchema = z.object({
  invoiceId: z.string().uuid(),
  payAmount: z.number().min(0),
  creditAmount: z.number().min(0).optional(),
  payDate: z.string().max(20).nullish(),
  paymentType: z.string().max(40).nullish(),
})

export async function POST(req: NextRequest) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  // Recording a payment moves the ledger and can flip an invoice to resolved, so it sits
  // with admin/owner rather than agent — agents can read the ledger but not write to it.
  const denied = requireCapability(access, canRecordPayment)
  if (denied) return denied

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = RecordSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payment', details: parsed.error.flatten() }, { status: 400 })
  }
  if ((parsed.data.payAmount ?? 0) + (parsed.data.creditAmount ?? 0) <= 0) {
    return NextResponse.json({ error: 'Payment or credit amount must be greater than zero.' }, { status: 400 })
  }
  const payment = await recordPayment(access.ownerId, parsed.data)
  if (!payment) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  return NextResponse.json({ id: payment.id })
}
