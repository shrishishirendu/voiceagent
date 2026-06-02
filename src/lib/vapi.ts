/**
 * Vapi integration layer.
 *
 * Vapi is the AI voice orchestrator: it does STT (Deepgram), LLM (Claude),
 * TTS (ElevenLabs/etc.) and connects them to a Twilio phone line.
 *
 * Our backend's job is to:
 *  1. Build an "assistant" config from the user's brief (objective, manner, voice)
 *  2. Tell Vapi: "place an outbound call to {toNumber} using {assistant}"
 *  3. Receive a webhook when the call ends, with transcript + summary
 */

const VAPI_BASE = "https://api.vapi.ai";

const VAPI_MAX_RETRIES = 4;
const VAPI_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Manner = "warm" | "crisp" | "formal";
type VoiceId = "marcus" | "iris" | "theo";

// Map our friendly voice IDs to actual 11labs/Vapi voice provider IDs.
// You can swap these for any ElevenLabs voice. To browse voices, see
// https://elevenlabs.io/app/voice-library (Vapi uses ElevenLabs by default).
const VOICE_MAP: Record<VoiceId, { provider: string; voiceId: string }> = {
  // Sober, steady male — works well for AU calling
  marcus: { provider: "11labs", voiceId: "pNInz6obpgDQGcFmaJgB" }, // Adam
  // Warm female
  iris:   { provider: "11labs", voiceId: "EXAVITQu4vr4xnSDxMaL" }, // Sarah
  // Crisp UK male
  theo:   { provider: "11labs", voiceId: "TX3LPaxmHKxFdv7VOQHJ" }, // Liam
};

const MANNER_GUIDANCE: Record<Manner, string> = {
  warm:
    "Be warm and conversational. Use natural human filler words sparingly (right, yeah, okay). Match the energy of the person you're speaking to.",
  crisp:
    "Be direct and time-efficient. Keep sentences short. Don't pad with pleasantries beyond what's polite.",
  formal:
    "Be professional and precise. Use complete sentences. Avoid contractions and filler words.",
};

const fmtAmount = (currency: string | null | undefined, amount: number | string | null | undefined): string => {
  if (amount == null || amount === "") return "not specified";
  const c = (currency ?? "").trim().toUpperCase();
  if (c === "" || c === "AUD") return `$${amount}`;
  return `${c} ${amount}`;
};

function formatLineItems(lineItems: string, currency: string): string {
  try {
    const items = JSON.parse(lineItems);
    if (!Array.isArray(items)) return `Line items: ${lineItems}`;
    const c = (currency ?? "").trim().toUpperCase();
    const curr = (c === "" || c === "AUD") ? "$" : `${c} `;
    const lines = items.map((item: {
      description?: string | null;
      quantity?: number | null;
      unitPrice?: number | null;
      amount?: number | null;
    }) => {
      const label = item.description ?? "Item";
      const details: string[] = [];
      if (item.quantity != null) details.push(`${item.quantity} units`);
      if (item.unitPrice != null) details.push(`${curr}${item.unitPrice.toFixed(2)}/unit`);
      if (item.amount != null) details.push(`${curr}${item.amount.toFixed(2)} total`);
      return `- ${label}: ${details.join(", ")}`;
    });
    return `Line items:\n${lines.join("\n")}`;
  } catch {
    return `Line items: ${lineItems}`;
  }
}

interface BuildSystemPromptArgs {
  userName: string;
  contactBusiness: string;
  contactPerson?: string;
  objective: string;
  manner: Manner;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  amountDue?: number;
  currency?: string;
  lineItems?: string;
  invoiceNotes?: string;
  bankName?: string;
  bsb?: string;
  accountNumber?: string;
  swiftCode?: string;
  abn?: string;
  remittanceName?: string;
  remittanceContact?: string;
}

/**
 * This is the actual "brain" content of Envoy.
 * Tweak this prompt to change how Envoy behaves on calls.
 */
export function buildSystemPrompt(args: BuildSystemPromptArgs): string {
  const {
    userName,
    contactBusiness,
    contactPerson,
    objective,
    manner,
    invoiceNumber,
    invoiceDate,
    dueDate,
    amountDue,
    currency,
    lineItems,
    invoiceNotes,
  } = args;

  return `You are Envoy, a polite AI agent placing a phone call on behalf of ${userName}. You're calling ${contactBusiness}.${
    contactPerson
      ? ` If it becomes clear from the caller's response that they are not the right person and are asking who the call should go to (e.g. a gatekeeper or receptionist routing the call), ask to speak with ${contactPerson}. Do not volunteer ${contactPerson}'s name proactively or ask to be transferred in any other situation — if the caller is ready to talk, proceed directly to the call objective.`
      : ` If it becomes clear from the caller's response that they are not the right person and are asking who the call should go to (e.g. a gatekeeper or receptionist routing the call), ask for the Accounts Payable or Finance team. Do not ask to be transferred in any other situation — if the caller is ready to talk, proceed directly to the call objective.`
  }

# Your objective
${objective}

# How to behave
${MANNER_GUIDANCE[manner]}

# Critical rules
- You ARE an AI agent. If asked directly whether you're a person or AI, say "I'm an AI agent calling on behalf of ${userName}." Don't volunteer it unprompted unless local law requires it.
- Speak naturally. You are on a real phone call — no markdown, no lists, no formal headers, just spoken sentences. Use commas and pauses, not bullets.
- Keep your turns short (1-2 sentences) unless explaining something complex. Let the other person talk.
- If the contact starts speaking while you are talking, stop immediately and let them finish. Never talk over them.
- If the other person asks you something you don't know about ${userName}, say honestly: "I don't have that detail — I can check with them and have them call back. Would that work?"
- If you achieve the objective, confirm the result clearly back to them ("So just to confirm, that's Tuesday the 19th at 2:30pm — perfect, thank you."), then politely end the call.
- If you can't achieve the objective (closed, no availability, wrong number, etc.), say so honestly and end the call politely.
- Never make commitments on behalf of ${userName} beyond what's explicitly in the objective. If asked something you can't decide, defer: "I'll need to check with them and get back to you."
- When referring to ${userName} or ${contactBusiness}${contactPerson ? ` or ${contactPerson}` : ""} by name, use the short name as given — do not expand or re-add legal suffixes like "Pty Ltd" or "International Limited".
- Speak monetary amounts as natural English words, never as digit strings. State the full precise amount when first raising it or when the contact explicitly asks what they owe (e.g. "seven thousand four hundred and ninety dollars and thirty-six cents"). In later references within the same conversation, you may use the shorthand a human would reach for (e.g. "about seventy-five hundred" or "just under seventy-five hundred dollars"). The guiding principle: the contact should always be able to walk away knowing the exact amount — so if they ask directly, always give the precise figure in full.

# Date context
Today is ${new Date().toISOString().split("T")[0]}. When the invoice is overdue (due date is before today), acknowledge it is overdue and focus on arranging a future payment date. All suggested settlement dates or payment plan start dates must be after today.

# Ending the call
When the objective is resolved (success OR a clear no), say a natural farewell (e.g. "Great, I'll let you go — goodbye!") then immediately use the endCall function to hang up. Don't wait for the other person to hang up first. Don't drag it out.

# Opening line
Your opening line has already been delivered: "Hi, this is Envoy calling on behalf of ${userName}. Is now an okay time for a quick chat?" Once they confirm, briefly state the purpose of the call in plain terms — do not repeat the greeting.${
    invoiceNumber
      ? `

# Invoice details
Invoice number: ${invoiceNumber}
Do not proactively state the invoice number to the contact. Refer to it as "the invoice" or "your invoice". Only read out the invoice number if the contact explicitly asks for it.
Invoice date: ${invoiceDate ?? "not specified"}
Due date: ${dueDate ?? "not specified"}
Amount due: ${fmtAmount(currency, amountDue)}
${lineItems ? formatLineItems(lineItems, currency ?? "") : ""}
${invoiceNotes ? `Notes: ${invoiceNotes}` : ""}${(args.bankName || args.bsb || args.accountNumber || args.swiftCode || args.abn || args.remittanceName || args.remittanceContact) ? `\nPayment details:${args.bankName ? `\nBank: ${args.bankName}` : ""}${args.bsb ? ` | BSB: ${args.bsb}` : ""}${args.accountNumber ? ` | Account: ${args.accountNumber}` : ""}${args.swiftCode ? ` | SWIFT: ${args.swiftCode}` : ""}${args.abn ? ` | ABN: ${args.abn}` : ""}${args.remittanceName ? `\nRemit to: ${args.remittanceName}` : ""}${args.remittanceContact ? `, ${args.remittanceContact}` : ""}\nDo not proactively mention payment options, banking details, or offer to share payment information at any point — wait for the contact to raise it. Only if the contact explicitly asks how they can pay or what payment options are available should you respond with the method name(s) only — for example "We can accept payment by bank transfer" — no account numbers or other details yet. Only after the contact confirms they want the details or explicitly asks for them should you share the actual account information. When you do share the details, read them out in small groups of 2–3 pieces at a time, pausing after each group to let them write it down — state the bank name and BSB first, then pause; then the account number, then pause; then any remaining details such as SWIFT code or ABN. Never read all banking fields in one go. If the contact declines the details or says they will arrange payment another way, simply acknowledge and move on — do not re-offer or volunteer anything further.` : ""}`
      : ""
  }`;
}

interface CreateCallArgs {
  toNumber: string;
  contactBusiness: string;
  contactPerson?: string;
  objective: string;
  voice: VoiceId;
  manner: Manner;
  userName: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  amountDue?: number;
  currency?: string;
  lineItems?: string;
  invoiceNotes?: string;
  bankName?: string;
  bsb?: string;
  accountNumber?: string;
  swiftCode?: string;
  abn?: string;
  remittanceName?: string;
  remittanceContact?: string;
  twilioPhoneNumber: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  publicUrl: string; // Where Vapi will POST webhooks
  anthropicKey: string;
}

interface VapiCallResponse {
  id: string;
  status: string;
  [k: string]: unknown;
}

/**
 * Place an outbound call via Vapi using BYO Twilio number.
 */
export async function dispatchVapiCall(args: CreateCallArgs): Promise<VapiCallResponse> {
  const voice = VOICE_MAP[args.voice];

  const systemPrompt = buildSystemPrompt({
    userName: args.userName,
    contactBusiness: args.contactBusiness,
    contactPerson: args.contactPerson,
    objective: args.objective,
    manner: args.manner,
    invoiceNumber: args.invoiceNumber,
    invoiceDate: args.invoiceDate,
    dueDate: args.dueDate,
    amountDue: args.amountDue,
    currency: args.currency,
    lineItems: args.lineItems,
    invoiceNotes: args.invoiceNotes,
    bankName: args.bankName,
    bsb: args.bsb,
    accountNumber: args.accountNumber,
    swiftCode: args.swiftCode,
    abn: args.abn,
    remittanceName: args.remittanceName,
    remittanceContact: args.remittanceContact,
  });

  // Vapi accepts a transient assistant inline — no need to pre-create one
  const body = {
    // Where to call FROM (your Twilio number)
    phoneNumber: {
      twilioAccountSid: args.twilioAccountSid,
      twilioAuthToken: args.twilioAuthToken,
      twilioPhoneNumber: args.twilioPhoneNumber,
    },
    // Who to call
    customer: {
      number: args.toNumber,
    },
    // The AI agent config (transient — used only for this call)
    assistant: {
      name: "Envoy",
      firstMessage: `Hi, this is Envoy calling on behalf of ${args.userName}. Is now an okay time for a quick chat?`,
      // Speech-to-text
      transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: "en",
      },
      // The LLM brain — Claude
      model: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
        ],
      },
      // Text-to-speech
      voice: {
        provider: voice.provider,
        voiceId: voice.voiceId,
      },
      // Behaviour
      maxDurationSeconds: 600, // 10 min hard cap
      silenceTimeoutSeconds: 30,
      endCallFunctionEnabled: true,
      endCallPhrases: ["goodbye", "talk to you later", "bye now", "have a good one"],
      voicemailDetection: {
        provider: "twilio",
        voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence", "machine_end_other"],
        enabled: true,
      },
      voicemailMessage: args.invoiceNumber
        ? `Hi, this is a message for ${args.contactBusiness}. Envoy is calling on behalf of ${args.userName} regarding an outstanding invoice. We're following up on payment and would appreciate a call back at your earliest convenience. Thank you.`
        : `Hi, this is Envoy calling on behalf of ${args.userName}. We tried to reach you but weren't able to connect. Please call back at your earliest convenience. Thank you.`,
      backgroundDenoisingEnabled: true,
      // Webhook target on the assistant (inline assistant config)
      server: {
        url: `${args.publicUrl}/api/calls/webhook`,
      },
      // For invoice calls, ask Vapi's post-call AI to produce a factual, call-specific summary.
      ...(args.invoiceNumber ? {
        analysisPlan: {
          summaryPrompt: `Summarize this call outcome in 2–3 sentences. Focus only on what was actually discussed and agreed — do not invent or assume. Include any concrete details that came up: dates, amounts, reference numbers, contact names, reasons given, follow-up steps. If the call went to voicemail or the contact wasn't available, state that clearly. Be factual and concise — no padding.`,
        },
      } : {}),
    },
  };

  let lastErr = "";
  for (let attempt = 0; attempt <= VAPI_MAX_RETRIES; attempt++) {
    const res = await fetch(`${VAPI_BASE}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return res.json() as Promise<VapiCallResponse>;

    const text = await res.text();
    lastErr = `Vapi dispatch failed: ${res.status} ${text}`;

    if (!VAPI_RETRYABLE_STATUS.has(res.status) || attempt === VAPI_MAX_RETRIES) {
      throw new Error(lastErr);
    }

    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
    await sleep(backoff);
  }
  throw new Error(lastErr);
}

/**
 * Fetch the latest state of a call from Vapi (used for polling the live screen).
 */
export async function getVapiCall(vapiCallId: string): Promise<VapiCallResponse> {
  const res = await fetch(`${VAPI_BASE}/call/${vapiCallId}`, {
    headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vapi getCall failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<VapiCallResponse>;
}

export type VapiCallProbe =
  | { ok: true; data: VapiCallResponse }
  | { ok: false; error: string; httpStatus?: number };

/**
 * Non-throwing wrapper around getVapiCall. Returns a discriminated union
 * so callers can branch on success/failure without try/catch.
 */
export async function probeVapiCall(vapiCallId: string): Promise<VapiCallProbe> {
  try {
    const res = await fetch(`${VAPI_BASE}/call/${vapiCallId}`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, httpStatus: res.status, error: `Vapi getCall ${res.status}: ${text}`.slice(0, 300) };
    }
    return { ok: true, data: (await res.json()) as VapiCallResponse };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
