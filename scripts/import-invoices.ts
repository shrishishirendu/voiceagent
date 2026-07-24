/**
 * Bulk-import invoices into Supabase as PERMANENT `stored` rows (browsable per-customer,
 * dispatchable later with zero re-parse). Two input modes:
 *
 *   # a directory of PDFs (each parsed via the same template→Gemini pipeline the website uses)
 *   npx tsx scripts/import-invoices.ts --owner=you@example.com "sample invoices"
 *
 *   # a JSON file: either [ {...}, {...} ] or { "invoices": [ {...} ] }, each entry mirroring
 *   # the parsed-invoice shape (contactBusiness, toNumber, invoiceNumber, amountDue, dueDate,
 *   # currency, lineItems, bankName/bsb/accountNumber/abn, …)
 *   npx tsx scripts/import-invoices.ts --owner=you@example.com invoices.json
 *
 * Flags: --pending (enqueue for the scheduler instead of storing), --status=stored|pending.
 * Idempotent: re-running dedupes on (debtor group + invoice number).
 */
import 'dotenv/config'
import { readFileSync, readdirSync } from 'fs'
import { join, extname, basename } from 'path'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/dispatcher'
import { persistInvoice, type InvoiceRowInput } from '@/lib/invoices'
import { parseInvoiceBuffer } from '@/lib/invoice-ingest'
import { uploadInvoiceFile } from '@/lib/storage'
import { buildBulkBrief, type InvoiceParseResult } from '@/lib/client-types'

type Args = { owner: string; path: string; status: 'stored' | 'pending' }

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let owner = ''
  let status: 'stored' | 'pending' = 'stored'
  const positional: string[] = []
  for (const a of argv) {
    if (a.startsWith('--owner=')) owner = a.slice('--owner='.length).trim().toLowerCase()
    else if (a === '--pending') status = 'pending'
    else if (a.startsWith('--status=')) status = a.slice('--status='.length) === 'pending' ? 'pending' : 'stored'
    else positional.push(a)
  }
  if (!owner) {
    console.error('Usage: tsx scripts/import-invoices.ts --owner=<email> [dirOrJson="sample invoices"] [--pending]')
    process.exit(2)
  }
  return { owner, path: positional[0] ?? 'sample invoices', status }
}

type Result = { created: number; duplicates: number; skipped: number }

function isDir(p: string): boolean {
  try {
    return readdirSync(p).length >= 0
  } catch {
    return false
  }
}

async function persistOne(owner: string, input: InvoiceRowInput, status: 'stored' | 'pending', dueOffsetDays: number, r: Result, label: string) {
  if (!input.contactBusiness) {
    console.warn(`  ⚠ ${label}: no business name parsed — skipped`)
    r.skipped++
    return
  }
  const res = await persistInvoice(owner, input, { status, dueOffsetDays })
  if (res.duplicate) {
    console.log(`  ↺ ${label}: already imported (dedup) → ${res.id}`)
    r.duplicates++
  } else {
    console.log(`  ✓ ${label}: ${input.contactBusiness} · #${input.invoiceNumber ?? '—'} → ${res.id}`)
    r.created++
  }
}

async function importDir(owner: string, dir: string, status: 'stored' | 'pending', dueOffsetDays: number, r: Result) {
  const pdfs = readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.pdf').sort()
  if (pdfs.length === 0) {
    console.error(`No PDFs found in ${dir}`)
    return
  }
  console.log(`Importing ${pdfs.length} PDF(s) from ${dir} as "${status}"…`)
  for (const file of pdfs) {
    const full = join(dir, file)
    try {
      const buffer = readFileSync(full)
      const outcome = await parseInvoiceBuffer(buffer)
      if (!outcome.ok) {
        console.warn(`  ⚠ ${file}: parse failed — ${outcome.error}`)
        r.skipped++
        continue
      }
      let sourceFilePath: string | undefined
      try {
        sourceFilePath = await uploadInvoiceFile(owner, basename(file), buffer)
      } catch (e) {
        console.warn(`  · ${file}: storage upload failed (${e instanceof Error ? e.message : e}) — importing without PDF link`)
      }
      const input = buildBulkBrief(outcome.parsed as unknown as InvoiceParseResult, sourceFilePath) as InvoiceRowInput
      await persistOne(owner, input, status, dueOffsetDays, r, `${file} [${outcome.source}]`)
    } catch (e) {
      console.error(`  ✗ ${file}: ${e instanceof Error ? e.message : e}`)
      r.skipped++
    }
  }
}

async function importJson(owner: string, jsonPath: string, status: 'stored' | 'pending', dueOffsetDays: number, r: Result) {
  const raw = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const entries: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.invoices) ? raw.invoices : []
  if (entries.length === 0) {
    console.error(`No invoices found in ${jsonPath} (expected an array or { "invoices": [...] })`)
    return
  }
  console.log(`Importing ${entries.length} invoice(s) from ${jsonPath} as "${status}"…`)
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as Partial<InvoiceParseResult> & Partial<InvoiceRowInput>
    try {
      // Accept either a raw-parsed shape (build the brief/objective) or a ready InvoiceRowInput.
      const input = (e.objective ? e : buildBulkBrief(e as InvoiceParseResult, e.sourceFilePath ?? undefined)) as InvoiceRowInput
      await persistOne(owner, input, status, dueOffsetDays, r, `entry ${i + 1}`)
    } catch (err) {
      console.error(`  ✗ entry ${i + 1}: ${err instanceof Error ? err.message : err}`)
      r.skipped++
    }
  }
}

async function main() {
  const { owner, path, status } = parseArgs()
  let dueOffsetDays = 0
  try {
    dueOffsetDays = (await getSettings(owner)).dueOffsetDays
  } catch {
    /* default 0 — only affects chaseAfter of pending rows */
  }

  const r: Result = { created: 0, duplicates: 0, skipped: 0 }
  if (extname(path).toLowerCase() === '.json') {
    await importJson(owner, path, status, dueOffsetDays, r)
  } else if (isDir(path)) {
    await importDir(owner, path, status, dueOffsetDays, r)
  } else {
    console.error(`Path not found or unsupported: ${path}`)
    process.exit(2)
  }

  console.log(`\nDone. created=${r.created} duplicates=${r.duplicates} skipped=${r.skipped}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
