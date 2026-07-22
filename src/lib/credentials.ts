import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

// Per-tenant outbound credentials + caller-id (Phase 3-G). Each tenant can bring its own
// Vapi / Twilio / Anthropic keys and its own Twilio caller-id number; anything not set
// falls back to the process-wide env (so local single-tenant dev works with just .env).
//
// At rest, the secret values live in Tenant.credentials (jsonb), AES-256-GCM encrypted
// when CREDENTIALS_SECRET is set. Without that env var they're stored `plain:` prefixed
// and a warning is logged — fine for local dev, NOT for production. The caller-id number
// is not secret and lives in the dedicated Tenant.phoneNumber column (decision 5).

const SECRET = process.env.CREDENTIALS_SECRET || ''
const keyBuf = () => crypto.createHash('sha256').update(SECRET).digest() // 32 bytes

export function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (!SECRET) {
    console.warn('[credentials] CREDENTIALS_SECRET not set — storing tenant secret UNENCRYPTED (dev only)')
    return `plain:${plain}`
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (stored.startsWith('plain:')) return stored.slice(6)
  if (stored.startsWith('enc:v1:')) {
    if (!SECRET) return null // encrypted at rest but we have no key to read it
    const [, , ivHex, tagHex, dataHex] = stored.split(':')
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf(), Buffer.from(ivHex, 'hex'))
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
      return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
    } catch {
      return null
    }
  }
  return stored // legacy plaintext
}

// The secret credential fields kept in Tenant.credentials (the caller-id number is NOT
// here — it's the Tenant.phoneNumber column).
export const CREDENTIAL_FIELDS = ['vapiPrivateKey', 'twilioAccountSid', 'twilioAuthToken', 'anthropicKey'] as const
export type CredentialField = (typeof CREDENTIAL_FIELDS)[number]

type StoredCredentials = Partial<Record<CredentialField, string>>

async function loadStored(ownerId: string): Promise<{ creds: StoredCredentials; phoneNumber: string | null }> {
  const row = await prisma.tenant.findUnique({ where: { ownerId }, select: { credentials: true, phoneNumber: true } })
  const creds = (row?.credentials && typeof row.credentials === 'object' ? row.credentials : {}) as StoredCredentials
  return { creds, phoneNumber: row?.phoneNumber ?? null }
}

export type DispatchConfig = {
  vapiPrivateKey: string
  twilioAccountSid: string
  twilioAuthToken: string
  twilioPhoneNumber: string
  anthropicKey: string
  publicUrl: string
}

// Effective outbound config for a tenant: decrypted per-tenant overrides where present,
// otherwise the process env. Returns which fields are still missing so the dispatcher can
// bail with a clear message instead of a failed Vapi call.
export async function resolveDispatchConfig(
  ownerId: string
): Promise<{ config: DispatchConfig; missing: string[] }> {
  const { creds, phoneNumber } = await loadStored(ownerId)
  const pick = (field: CredentialField, env: string | undefined) => decryptSecret(creds[field]) || env || ''

  const config: DispatchConfig = {
    vapiPrivateKey: pick('vapiPrivateKey', process.env.VAPI_PRIVATE_KEY),
    twilioAccountSid: pick('twilioAccountSid', process.env.TWILIO_ACCOUNT_SID),
    twilioAuthToken: pick('twilioAuthToken', process.env.TWILIO_AUTH_TOKEN),
    twilioPhoneNumber: phoneNumber || process.env.TWILIO_PHONE_NUMBER || '',
    anthropicKey: pick('anthropicKey', process.env.ANTHROPIC_API_KEY),
    publicUrl: process.env.PUBLIC_URL || '',
  }

  const missing: string[] = []
  if (!config.vapiPrivateKey) missing.push('VAPI_PRIVATE_KEY')
  if (!config.twilioAccountSid) missing.push('TWILIO_ACCOUNT_SID')
  if (!config.twilioAuthToken) missing.push('TWILIO_AUTH_TOKEN')
  if (!config.twilioPhoneNumber) missing.push('TWILIO_PHONE_NUMBER / caller-id')
  if (!config.anthropicKey) missing.push('ANTHROPIC_API_KEY')
  if (!config.publicUrl) missing.push('PUBLIC_URL')
  return { config, missing }
}

// Presence/masking for the Settings UI — never returns raw secrets to the browser.
export type CredentialStatus = {
  encryptionEnabled: boolean
  phoneNumber: string | null
  fields: Record<CredentialField, { tenantSet: boolean; envFallback: boolean; masked: string | null }>
}

const mask = (v: string | null): string | null => (v ? (v.length <= 4 ? '••••' : `••••${v.slice(-4)}`) : null)

const ENV_FOR: Record<CredentialField, string | undefined> = {
  get vapiPrivateKey() {
    return process.env.VAPI_PRIVATE_KEY
  },
  get twilioAccountSid() {
    return process.env.TWILIO_ACCOUNT_SID
  },
  get twilioAuthToken() {
    return process.env.TWILIO_AUTH_TOKEN
  },
  get anthropicKey() {
    return process.env.ANTHROPIC_API_KEY
  },
}

export async function getCredentialStatus(ownerId: string): Promise<CredentialStatus> {
  const { creds, phoneNumber } = await loadStored(ownerId)
  const fields = {} as CredentialStatus['fields']
  for (const f of CREDENTIAL_FIELDS) {
    const tenantVal = decryptSecret(creds[f])
    fields[f] = {
      tenantSet: !!tenantVal,
      envFallback: !tenantVal && !!ENV_FOR[f],
      masked: mask(tenantVal),
    }
  }
  return { encryptionEnabled: !!SECRET, phoneNumber, fields }
}

export type SaveCredentialsInput = Partial<Record<CredentialField, string>> & { phoneNumber?: string | null }

// Merge-save: only non-empty secret fields are written (an empty field leaves the
// existing value untouched); phoneNumber is written to the dedicated column. Returns
// an error string for a duplicate caller-id (Tenant.phoneNumber is unique).
export async function saveCredentials(ownerId: string, input: SaveCredentialsInput): Promise<{ error?: string }> {
  const { creds } = await loadStored(ownerId)
  const next: StoredCredentials = { ...creds }
  for (const f of CREDENTIAL_FIELDS) {
    const v = input[f]
    if (typeof v === 'string' && v.trim()) next[f] = encryptSecret(v.trim())
  }

  const data: Prisma.TenantUpdateInput = { credentials: next as unknown as Prisma.InputJsonValue }
  if (input.phoneNumber !== undefined) {
    data.phoneNumber = input.phoneNumber ? input.phoneNumber.trim() : null
  }

  try {
    await prisma.tenant.update({ where: { ownerId }, data })
    return {}
  } catch (e) {
    // Unique violation on phone_number → another tenant already owns that caller-id.
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
      return { error: 'That caller-id number is already used by another workspace.' }
    }
    throw e
  }
}

// Clear a single tenant credential override (revert to env fallback).
export async function clearCredential(ownerId: string, field: CredentialField): Promise<void> {
  const { creds } = await loadStored(ownerId)
  if (!(field in creds)) return
  const next: StoredCredentials = { ...creds }
  delete next[field]
  await prisma.tenant.update({ where: { ownerId }, data: { credentials: next as unknown as Prisma.InputJsonValue } })
}
