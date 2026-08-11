/**
 * A dependency-free single-page PDF writer, used only by scripts/seed-demo-workspace.ts
 * to generate the demo invoice PDFs.
 *
 * Why hand-rolled: the repo ships no sample PDFs and adding pdfkit/puppeteer just to
 * produce a few pages of demo text would put a native/headless-Chrome dependency into
 * package.json for something that never runs in production. A PDF containing nothing but
 * Helvetica text is small enough to emit directly, and pdf-parse (already a dependency)
 * can read the result back, so the generated files still exercise the real parse path.
 *
 * Deliberately minimal: one page, the two base-14 Helvetica fonts (which every reader has
 * built in, so no font embedding), no compression, no images.
 */

const PAGE_WIDTH = 595 // A4 at 72dpi
const PAGE_HEIGHT = 842

export type PdfLine = {
  text: string
  /** Points from the left edge. */
  x?: number
  size?: number
  bold?: boolean
  /** Extra vertical gap (points) before this line. */
  gap?: number
}

// PDF string literals are delimited by parentheses, so those and the escape character
// itself must be escaped or the content stream becomes unparseable.
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

// Base-14 Helvetica is Latin-1 encoded; characters outside that range would need a font
// with a Unicode CMap, so fold the few typographic ones we actually emit and drop the rest.
function toLatin1(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
}

/** Render lines top-to-bottom into a one-page A4 PDF. */
export function buildInvoicePdf(lines: PdfLine[]): Buffer {
  let cursorY = PAGE_HEIGHT - 64
  const ops: string[] = []

  for (const line of lines) {
    const size = line.size ?? 10
    cursorY -= (line.gap ?? 0) + size + 4
    const font = line.bold ? '/F2' : '/F1'
    const x = line.x ?? 56
    ops.push(
      `BT ${font} ${size} Tf 1 0 0 1 ${x} ${cursorY.toFixed(2)} Tm (${escapeText(toLatin1(line.text))}) Tj ET`
    )
  }

  const content = Buffer.from(ops.join('\n'), 'latin1')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    null, // object 6 is the content stream, assembled below
  ]

  const chunks: Buffer[] = []
  // The xref table stores each object's absolute byte offset, so track the running length
  // as we append rather than trying to compute it afterwards.
  const offsets: number[] = []
  let length = 0
  const push = (b: Buffer | string) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b
    chunks.push(buf)
    length += buf.length
  }

  push('%PDF-1.4\n')

  objects.forEach((body, i) => {
    const num = i + 1
    offsets[num] = length
    if (body === null) {
      push(`${num} 0 obj\n<< /Length ${content.length} >>\nstream\n`)
      push(content)
      push('\nendstream\nendobj\n')
    } else {
      push(`${num} 0 obj\n${body}\nendobj\n`)
    }
  })

  const xrefOffset = length
  const count = objects.length + 1 // +1 for the mandatory free object 0
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let n = 1; n < count; n++) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  return Buffer.concat(chunks)
}
