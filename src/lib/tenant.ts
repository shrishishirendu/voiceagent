import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

// Per-tenant profile/config, mirroring EnvoyIn's lib/config.js (there backed by the
// `app_config` row; here by the `tenant` table). New-owner detection is a page-level
// `hasTenant(ownerId)` check, not middleware — exactly like EnvoyIn.

export type TenantConfig = {
  ownerId: string
  businessName: string | null
  phoneNumber: string | null
  data: Record<string, unknown>
  members: unknown[]
  forecastHistory: unknown[]
}

// Keys the client must never write through saveTenant — managed by dedicated paths
// (members via lib/members.ts in Phase 3; credentials via the Settings/credentials UI).
const MANAGED_KEYS = ['members', 'credentials', 'ownerId', 'phoneNumber']

export async function hasTenant(ownerId: string): Promise<boolean> {
  const row = await prisma.tenant.findUnique({ where: { ownerId }, select: { ownerId: true } })
  return !!row
}

export async function loadTenant(ownerId: string): Promise<TenantConfig | null> {
  const row = await prisma.tenant.findUnique({ where: { ownerId } })
  if (!row) return null
  return {
    ownerId: row.ownerId,
    businessName: row.businessName,
    phoneNumber: row.phoneNumber,
    data: (row.data as Record<string, unknown>) ?? {},
    members: (row.members as unknown[]) ?? [],
    forecastHistory: (row.forecastHistory as unknown[]) ?? [],
  }
}

// Resolve the tenant that owns a given outbound caller-id number. This is NOT how the
// outbound webhook resolves tenant (that uses call.ownerId), but it is the analogue of
// EnvoyIn's getConfigByPhoneNumber for any place that needs owner-from-number.
export async function getTenantByPhoneNumber(phoneNumber: string): Promise<TenantConfig | null> {
  const row = await prisma.tenant.findUnique({ where: { phoneNumber } })
  return row ? loadTenant(row.ownerId) : null
}

// Upsert the tenant's editable config. Strips managed keys from the incoming `data`
// blob so a stale Setup/Onboarding tab can't clobber members/credentials.
export async function saveTenant(
  ownerId: string,
  input: { businessName?: string | null; data?: Record<string, unknown> }
): Promise<TenantConfig> {
  const cleanData = { ...(input.data ?? {}) }
  for (const k of MANAGED_KEYS) delete cleanData[k]
  const dataJson = cleanData as Prisma.InputJsonValue

  const row = await prisma.tenant.upsert({
    where: { ownerId },
    create: {
      ownerId,
      businessName: input.businessName ?? null,
      data: dataJson,
    },
    update: {
      ...(input.businessName !== undefined ? { businessName: input.businessName } : {}),
      data: dataJson,
    },
  })
  return (await loadTenant(row.ownerId))!
}
