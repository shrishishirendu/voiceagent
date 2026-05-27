import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const EXTRACTION_PROMPT = `You are extracting information from a business invoice to pre-fill a call brief. We sent this invoice to a client and are calling them to chase payment.

Return ONLY a valid JSON object with exactly these fields, no other text, no markdown, no code fences:
{
  "contactName": "the client name or business name we are calling",
  "toNumber": "client phone number in international format e.g. +61412345678",
  "invoiceNumber": "invoice reference number e.g. INV-001",
  "invoiceDate": "date invoice was issued e.g. 2024-01-15",
  "dueDate": "payment due date e.g. 2024-02-15",
  "amountDue": "outstanding amount due as a number e.g. 750.00",
  "currency": "currency code e.g. AUD",
  "lineItems": [
    {
      "description": "item description",
      "quantity": 1,
      "unitPrice": 100.00,
      "amount": 100.00
    }
  ],
  "invoiceNotes": "any payment terms or notes on the invoice"
}

If you cannot find a field, use null. Never invent information.`;

const LineItemSchema = z.object({
  description: z.string().nullable(),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  amount: z.number().nullable(),
});

const ParsedInvoiceSchema = z.object({
  contactName: z.string().nullable(),
  toNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  amountDue: z.number().nullable(),
  currency: z.string().nullable(),
  lineItems: z.union([z.array(LineItemSchema), z.string(), z.null()]),
  invoiceNotes: z.string().nullable(),
});

type ParsedInvoice = z.infer<typeof ParsedInvoiceSchema>;

const GeminiResponseSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.object({
        parts: z.array(z.object({ text: z.string() })),
      }),
    })
  ),
});

function normaliseParsedInvoice(parsed: ParsedInvoice) {
  return {
    contactName: parsed.contactName,
    toNumber: parsed.toNumber,
    invoiceNumber: parsed.invoiceNumber,
    invoiceDate: parsed.invoiceDate,
    dueDate: parsed.dueDate,
    amountDue: parsed.amountDue,
    currency: parsed.currency,
    lineItems:
      parsed.lineItems == null
        ? null
        : typeof parsed.lineItems === "string"
          ? parsed.lineItems
          : JSON.stringify(parsed.lineItems),
    invoiceNotes: parsed.invoiceNotes,
  };
}

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });
  }

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

  let base64Document: string;
  try {
    const arrayBuffer = await file.arrayBuffer();
    base64Document = Buffer.from(arrayBuffer).toString("base64");
  } catch {
    return NextResponse.json({ error: "Failed to read uploaded PDF" }, { status: 400 });
  }

  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: "application/pdf",
                    data: base64Document,
                  },
                },
                { text: EXTRACTION_PROMPT },
              ],
            },
          ],
          generationConfig: { maxOutputTokens: 1200, temperature: 0 },
        }),
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetch error";
    return NextResponse.json({ error: `Gemini request failed: ${message}` }, { status: 502 });
  }

  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();
    return NextResponse.json(
      { error: `Gemini request failed: ${geminiResponse.status} ${errorText}` },
      { status: 502 }
    );
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
    return NextResponse.json(
      { error: "Parsed invoice JSON did not match the expected shape" },
      { status: 502 }
    );
  }

  return NextResponse.json(normaliseParsedInvoice(parsedInvoice.data));
}
