import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { saveTenant } from '@/lib/tenant'
import { createCustomer } from '@/lib/customers'
import { resolveAccess, unauthorized, bustAccessCache } from '@/lib/access'

// Completes onboarding for a brand-new owner: creates their Tenant config row (which is
// what flips hasTenant() true and lets them into /app), seeds business-hours Settings,
// and seeds any outbound contacts they added as Customer rows.
const Schema = z.object({
  businessName: z.string().min(1).max(200),
  phone: z.string().max(40).optional(),
  addressLine: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  postCode: z.string().max(20).optional(),
  callMoment: z.object({
    voice: z.enum(['iris', 'arjun', 'theo']).default('iris'),
    manner: z.enum(['warm', 'crisp', 'formal']).default('warm'),
    objective: z.string().max(2000).optional(),
  }),
  businessHours: z.object({
    bhStartHour: z.number().int().min(0).max(23),
    bhEndHour: z.number().int().min(1).max(24),
    bhDays: z.string().regex(/^[1-7](,[1-7])*$/),
    timezone: z.string().min(1).max(64),
  }),
  contacts: z.array(z.object({ businessName: z.string().min(1).max(200), phone: z.string().max(40).optional() })).max(200).default([]),
})

export async function POST(req: NextRequest) {
  const access = await resolveAccess()
  if (!access) return unauthorized()
  const ownerId = access.ownerId

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid onboarding data', details: parsed.error.flatten() }, { status: 400 })
  }
  const d = parsed.data

  // 1. Tenant config row (identity + address + default call-moment rules).
  await saveTenant(ownerId, {
    businessName: d.businessName,
    data: {
      phone: d.phone ?? null,
      address: { addressLine: d.addressLine ?? null, city: d.city ?? null, state: d.state ?? null, postCode: d.postCode ?? null },
      callMoment: d.callMoment,
      onboardedAt: new Date().toISOString(),
    },
  })

  // 2. Business-hours Settings.
  await prisma.settings.upsert({
    where: { ownerId },
    create: { ownerId, ...d.businessHours },
    update: d.businessHours,
  })

  // 3. Seed outbound contacts as Customer rows.
  let seeded = 0
  for (const c of d.contacts) {
    if (!c.businessName.trim()) continue
    await createCustomer(ownerId, { businessName: c.businessName, contactPhone: c.phone || null })
    seeded++
  }

  // Owner just gained a tenant row — bust the access cache so the next request sees it.
  bustAccessCache(ownerId)
  return NextResponse.json({ ok: true, seeded })
}
