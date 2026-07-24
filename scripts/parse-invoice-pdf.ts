/**
 * Parse a real invoice PDF through the deterministic template pipeline (Phase 3-B).
 *
 *   npx tsx scripts/parse-invoice-pdf.ts "path/to/invoice.pdf" [more.pdf ...]
 *   npx tsx scripts/parse-invoice-pdf.ts --text "path/to/invoice.pdf"   # also dump raw text
 *
 * This runs the exact same pdf-parse → matchTemplate path the /api/calls/parse-document
 * route uses, so you can confirm the templates work against the actual PDF text layer
 * (not just the fixtures in test-invoice-templates.ts). No Gemini key needed.
 */
import { readFileSync } from 'fs'
import { matchTemplate } from '@/lib/invoice-templates'
import { normaliseParsedInvoice } from '@/lib/invoice-parse'

async function extractText(buf: Buffer): Promise<string> {
  const mod = await import('pdf-parse/lib/pdf-parse.js')
  const pdf = (mod as unknown as { default: (b: Buffer) => Promise<{ text: string }> }).default
  return (await pdf(buf)).text ?? ''
}

async function main() {
  const args = process.argv.slice(2)
  const dumpText = args.includes('--text')
  const files = args.filter((a) => a !== '--text')
  if (files.length === 0) {
    console.error('Usage: npx tsx scripts/parse-invoice-pdf.ts [--text] <file.pdf> [...]')
    process.exit(2)
  }

  for (const file of files) {
    console.log(`\n=== ${file} ===`)
    let text: string
    try {
      text = await extractText(readFileSync(file))
    } catch (e) {
      console.error('  failed to read/parse:', e instanceof Error ? e.message : e)
      continue
    }
    if (dumpText) {
      console.log('--- extracted text ---')
      console.log(text)
      console.log('--- end text ---')
    }
    const match = matchTemplate(text)
    if (!match) {
      console.log('  → no template matched (would fall back to Gemini)')
      continue
    }
    console.log(`  → template: ${match.templateId} (valid=${match.valid}${match.valid ? '' : ' → would fall back to Gemini'})`)
    console.log(JSON.stringify(normaliseParsedInvoice(match.parsed), null, 2))
  }
}

main()
