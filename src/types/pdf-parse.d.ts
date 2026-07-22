// pdf-parse ships no types for its inner entrypoint (we import the library file directly
// to avoid the debug harness in the package index). Minimal declaration for what we use.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string
    numpages: number
    info: unknown
    metadata: unknown
    version: string
  }
  function pdf(dataBuffer: Buffer | Uint8Array): Promise<PdfParseResult>
  export default pdf
}
