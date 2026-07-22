import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAccess, hasRole, unauthorized, forbidden } from "@/lib/access";
import { ParsedInvoiceSchema, normaliseParsedInvoice } from "@/lib/invoice-parse";
import { matchTemplate } from "@/lib/invoice-templates";

// PDF text extraction (pdf-parse) runs in the Node runtime, not Edge.
export const runtime = "nodejs";

const EXTRACTION_PROMPT = `You are extracting information from a business invoice to pre-fill a call brief. We sent this invoice to a client and are calling them to chase payment. This invoice may span multiple pages — scan all pages before responding.

Field roles:
- vendorName: OUR business name (the sender/issuer of this invoice — us). Extract only the distinctive brand or trading name.
- contactBusiness: the RECIPIENT/DEBTOR business trading name (the client we sent this invoice to, who we are now calling). Extract only the distinctive brand or trading name.
- contactPerson: a specific named individual at the recipient business if the invoice names one (e.g. an Attn: line, account manager, or AR contact); otherwise null. This is a person's name, not a business name.

Rules for vendorName and contactBusiness: extract only the distinctive brand or trading name. Drop legal suffixes (Pty Ltd, Limited, International Limited, Inc., LLC, Corp., Co.) AND generic descriptive trailing words (Indoor Plant Hire, Software Technologies, Management Services, Property Group, etc.). Use the shortest recognisable name — reproduce it exactly as it appears in the invoice header or letterhead logo, preserving any stylised capitalisation (e.g. "iSoft", not "ISoft" or "ISOFT"). Do not expand abbreviations and do not merge separate words into one. Examples: "Green Design" from "Green Design Indoor Plant Hire Pty Ltd", "Quest Software" from "Quest Software International Limited", "iSoft" from "iSoft Software Technologies Pty Ltd".

invoiceNotes: include only notes specific and directly relevant to THIS invoice — special payment instructions, dispute resolution contacts, or custom terms agreed for this deal. Omit standard legal boilerplate, generic T&Cs, GST/VAT/tax disclaimers, and any text that appears identically on every invoice. Return null if no genuinely relevant notes exist.

Return all dates (invoiceDate, dueDate) in YYYY-MM-DD format regardless of how they appear in the document. Return null for any field not found. Never invent information.`;

const GeminiResponseSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.object({
        parts: z.array(z.object({ text: z.string() })),
      }),
    })
  ),
});

// Extract the embedded text layer from a PDF buffer. Imported dynamically from the
// library entrypoint (not the package index, which runs a debug harness on import).
async function extractPdfText(buf: Buffer): Promise<string> {
  try {
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    const pdf = (mod as unknown as { default: (b: Buffer) => Promise<{ text: string }> }).default;
    const data = await pdf(buf);
    return data.text ?? "";
  } catch (err) {
    console.error("[parse-document] PDF text extraction failed:", err);
    return "";
  }
}

export async function POST(req: NextRequest) {
  const access = await resolveAccess();
  if (!access) return unauthorized();
  if (!hasRole(access, "agent")) return forbidden();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("document");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "document" file' }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Document must be a PDF" }, { status: 400 });
  }
  const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "PDF must be under 20 MB" }, { status: 413 });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Failed to read uploaded PDF" }, { status: 400 });
  }

  // ── Deterministic path: fingerprint against known vendor templates ──────────
  // If a template recognises the vendor and the extraction has the essentials, we
  // return it directly — no Gemini call (fast, free, and stable for recurring vendors).
  const text = await extractPdfText(buffer);
  if (text) {
    const match = matchTemplate(text);
    if (match && match.valid) {
      console.log(`[parse-document] template hit: ${match.templateId}`);
      return NextResponse.json({ ...normaliseParsedInvoice(match.parsed), _source: "template", _templateId: match.templateId });
    }
    if (match) {
      console.log(`[parse-document] template ${match.templateId} matched but incomplete — falling back to Gemini`);
    }
  }

  // ── Fallback path: Gemini vision extraction ─────────────────────────────────
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "No template matched this invoice and GEMINI_API_KEY is not set, so it can't be parsed automatically. Enter the details manually or add a template for this vendor." },
      { status: 422 }
    );
  }

  const base64Document = buffer.toString("base64");

  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY!,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: "application/pdf", data: base64Document } },
                { text: EXTRACTION_PROMPT },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 4096,
            temperature: 0,
            response_mime_type: "application/json",
            response_schema: {
              type: "object",
              properties: {
                vendorName: { type: "string", nullable: true },
                contactBusiness: { type: "string", nullable: true },
                contactPerson: { type: "string", nullable: true },
                toNumber: { type: "string", nullable: true },
                invoiceNumber: { type: "string", nullable: true },
                invoiceDate: { type: "string", nullable: true },
                dueDate: { type: "string", nullable: true },
                amountDue: { type: "number", nullable: true },
                currency: { type: "string", nullable: true },
                lineItems: {
                  type: "array",
                  nullable: true,
                  items: {
                    type: "object",
                    properties: {
                      description: { type: "string", nullable: true },
                      quantity: { type: "number", nullable: true },
                      unitPrice: { type: "number", nullable: true },
                      amount: { type: "number", nullable: true },
                    },
                  },
                },
                invoiceNotes: { type: "string", nullable: true },
                paymentDetails: {
                  type: "object",
                  nullable: true,
                  properties: {
                    bankName: { type: "string", nullable: true },
                    bsb: { type: "string", nullable: true },
                    accountNumber: { type: "string", nullable: true },
                    swiftCode: { type: "string", nullable: true },
                    abn: { type: "string", nullable: true },
                    remittanceName: { type: "string", nullable: true },
                    remittanceContact: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
        }),
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetch error";
    return NextResponse.json({ error: `Gemini request failed: ${message}` }, { status: 502 });
  }

  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();
    console.error("[parse-document] Gemini error:", geminiResponse.status, errorText);
    return NextResponse.json({ error: "Document parsing failed — please try again" }, { status: 502 });
  }

  let rawResponse: unknown;
  try {
    rawResponse = await geminiResponse.json();
  } catch {
    return NextResponse.json({ error: "Gemini returned invalid JSON" }, { status: 502 });
  }

  const message = GeminiResponseSchema.safeParse(rawResponse);
  if (!message.success) {
    return NextResponse.json({ error: "Unexpected Gemini response shape" }, { status: 502 });
  }

  const textContent = message.data.candidates[0]?.content?.parts[0]?.text?.trim() ?? "";
  if (!textContent) {
    return NextResponse.json({ error: "Gemini returned empty content" }, { status: 502 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(textContent);
  } catch {
    return NextResponse.json({ error: "Gemini did not return valid JSON" }, { status: 502 });
  }

  const parsedInvoice = ParsedInvoiceSchema.safeParse(parsedJson);
  if (!parsedInvoice.success) {
    return NextResponse.json({ error: "Parsed invoice JSON did not match the expected shape" }, { status: 502 });
  }

  return NextResponse.json({ ...normaliseParsedInvoice(parsedInvoice.data), _source: "gemini" });
}
