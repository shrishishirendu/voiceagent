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
type VoiceId = "iris" | "arjun" | "theo";
type Language = "en" | "hi";
type Gender = "m" | "f"; // drives gendered Hindi verb forms

// ElevenLabs TTS tuning, applied to every voice for a more natural, human feel.
// Lower stability = more expressive/varied prosody (less robotic). style adds
// emphasis but raises latency if pushed high, so keep it modest. Individual
// voices can override any of these via their `settings` in VOICE_MAP.
const DEFAULT_VOICE_SETTINGS = {
  model: "eleven_turbo_v2_5",
  stability: 0.45,
  similarityBoost: 0.75,
  style: 0.35,
  useSpeakerBoost: true,
};

type VoiceSettings = Partial<typeof DEFAULT_VOICE_SETTINGS>;

// Map our friendly voice IDs to actual 11labs/Vapi voice provider IDs.
// arjun is a community Voice Library voice: it only resolves once your own PAID
// ElevenLabs key is connected in Vapi (Provider Keys) AND the voice has been added
// to your ElevenLabs library so it syncs. iris and theo are ElevenLabs *premade*
// voices, so they work on Vapi's bundled key with no paid plan. Audition + swap IDs
// at https://elevenlabs.io/app/voice-library if a different one sounds better.
// `language` drives the STT model, greeting/voicemail wording, and the prompt;
// `gender` drives gendered Hindi verb forms.
const VOICE_MAP: Record<VoiceId, { provider: string; voiceId: string; language: Language; gender: Gender; settings?: VoiceSettings }> = {
  // Warm female — Sarah (ElevenLabs premade; works on Vapi's bundled key, no paid
  // plan). TEMPORARY working default for demos until a paid key is connected for aria.
  iris:  { provider: "11labs", voiceId: "EXAVITQu4vr4xnSDxMaL", language: "en", gender: "f" },
  // Natural, conversational Indian male — Aarav J (community; needs paid ElevenLabs key)
  arjun: { provider: "11labs", voiceId: "jpdt2U2ncF4tVZvy35oY", language: "en", gender: "m" },
  // Premade UK male (Liam) — works on Vapi's bundled key (no paid plan). Set to
  // Hindi so it converses in Hindi/Hinglish (non-native accent, usable for testing).
  theo:  { provider: "11labs", voiceId: "TX3LPaxmHKxFdv7VOQHJ", language: "hi", gender: "m" },
};

// The dispatch route stores a voicemail script before calling Vapi, so it needs to
// know the voice's language/gender too. Defaults are safe for unknown/legacy voices.
export function getVoiceLanguage(voice: string): Language {
  return (VOICE_MAP as Record<string, { language: Language }>)[voice]?.language ?? "en";
}

export function getVoiceGender(voice: string): Gender {
  return (VOICE_MAP as Record<string, { gender: Gender }>)[voice]?.gender ?? "m";
}

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

interface BuildVoicemailMessageArgs {
  contactBusiness: string;
  userName: string;
  invoiceNumber?: string | null;
  amountDue?: number | null;
  currency?: string | null;
  dueDate?: string | null;
  // When > 1, use aggregate phrasing ("N outstanding invoices"). Defaults to 1 if
  // an invoiceNumber is present, else 0 (no-invoice phrasing).
  invoiceCount?: number;
  language?: Language;
  gender?: Gender;
}

export function buildVoicemailMessage(args: BuildVoicemailMessageArgs): string {
  const { contactBusiness, userName, invoiceNumber, amountDue, currency, dueDate, language = "en", gender = "m" } = args;
  const count = args.invoiceCount ?? (invoiceNumber ? 1 : 0);
  if (language === "hi") {
    const rahaHai = gender === "f" ? "रही है" : "रहा है"; // "Envoy is calling"
    if (count > 1) {
      return `नमस्ते, ${contactBusiness} के लिए एक संदेश है। एनवॉय, ${userName} की ओर से ${count} बकाया इनवॉइसों${amountDue != null ? ` (कुल ${fmtAmount(currency, amountDue)})` : ""} के बारे में कॉल कर ${rahaHai}। कृपया जब समय मिले हमें वापस कॉल करें। धन्यवाद।`;
    }
    return count === 1
      ? `नमस्ते, ${contactBusiness} के लिए एक संदेश है। एनवॉय, ${userName} की ओर से एक बकाया इनवॉइस${amountDue != null ? ` (${fmtAmount(currency, amountDue)})` : ""}${dueDate ? ` जिसकी देय तिथि ${dueDate} है,` : ""} के बारे में कॉल कर ${rahaHai}। कृपया जब समय मिले हमें वापस कॉल करें। धन्यवाद।`
      : `नमस्ते, ${contactBusiness} के लिए एक संदेश है। एनवॉय, ${userName} की ओर से कॉल कर ${rahaHai}। हम आपसे संपर्क नहीं कर पाए। कृपया जब समय मिले हमें वापस कॉल करें। धन्यवाद।`;
  }
  if (count > 1) {
    return `Hi, this is a message for ${contactBusiness}. Envoy is calling on behalf of ${userName} regarding ${count} outstanding invoices${amountDue != null ? ` totaling ${fmtAmount(currency, amountDue)}` : ""}. Please give us a call back at your earliest convenience. Thank you.`;
  }
  return count === 1
    ? `Hi, this is a message for ${contactBusiness}. Envoy is calling on behalf of ${userName} regarding an outstanding invoice${amountDue != null ? ` of ${fmtAmount(currency, amountDue)}` : ""}${dueDate ? `, due ${dueDate}` : ""}. Please give us a call back at your earliest convenience. Thank you.`
    : `Hi, this is a message for ${contactBusiness}. Envoy is calling on behalf of ${userName}. We tried to reach you but weren't able to connect. Please give us a call back at your earliest convenience. Thank you.`;
}

// Sum invoice amounts when they share a single currency; null if mixed/none.
// Used for aggregate voicemail/summary phrasing.
function sumSingleCurrency(invoices: InvoiceBlock[]): { amount: number; currency?: string } | null {
  const buckets = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.amountDue == null) continue;
    const c = (inv.currency ?? "").trim().toUpperCase();
    const key = c === "" || c === "AUD" ? "AUD" : c;
    buckets.set(key, (buckets.get(key) ?? 0) + inv.amountDue);
  }
  if (buckets.size !== 1) return null;
  const [key, amount] = Array.from(buckets.entries())[0];
  return { amount: Number(amount.toFixed(2)), currency: key };
}

// The spoken opening line, localized to the voice's language (and gender for Hindi).
// When `brief` is provided the agent states the reason in the very first line instead
// of asking for a generic chat — "regarding an overdue invoice of $500" etc.
export function buildFirstMessage(userName: string, language: Language = "en", gender: Gender = "m", brief?: string): string {
  if (language === "hi") {
    return brief
      ? `नमस्ते, मैं ${userName} की ओर से ${brief} के बारे में बात करने के लिए एनवॉय बोल ${gender === "f" ? "रही" : "रहा"} हूँ — क्या अभी बात हो सकती है?`
      : `नमस्ते, मैं ${userName} की ओर से एनवॉय बोल ${gender === "f" ? "रही" : "रहा"} हूँ — क्या अभी थोड़ी बात हो सकती है?`;
  }
  return brief
    ? `Hi, this is Envoy calling on behalf of ${userName} regarding ${brief}. Are you available to talk about this?`
    : `Hi, this is Envoy calling on behalf of ${userName}. Is now an okay time for a quick chat?`;
}

// A single invoice's spoken-facing fields. Payment/banking details are shared at
// the debtor level (see BuildSystemPromptArgs) and rendered once, not per invoice.
export interface InvoiceBlock {
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  amountDue?: number;
  currency?: string;
  lineItems?: string;
  invoiceNotes?: string;
}

interface BuildSystemPromptArgs {
  userName: string;
  contactBusiness: string;
  contactPerson?: string;
  objective: string;
  manner: Manner;
  language?: Language;
  gender?: Gender;
  // Legacy single-invoice fields (Compose path). When `invoices` is provided it
  // takes precedence and these are ignored.
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  amountDue?: number;
  currency?: string;
  lineItems?: string;
  invoiceNotes?: string;
  // Aggregated multi-invoice list (scheduler path). One call chasing N invoices.
  invoices?: InvoiceBlock[];
  // Pre-computed opening brief injected into firstMessage and the system-prompt reminder.
  invoiceBrief?: string;
  bankName?: string;
  bsb?: string;
  accountNumber?: string;
  swiftCode?: string;
  abn?: string;
  remittanceName?: string;
  remittanceContact?: string;
}

// Sum invoice amounts, grouped by currency code (AUD/blank treated as the default
// "$" bucket). Returns a spoken total string like "$1,200.00" or, for mixed
// currencies, "$500.00 plus USD 300.00".
function totalAmountSpoken(invoices: InvoiceBlock[]): string {
  const buckets = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.amountDue == null) continue;
    const c = (inv.currency ?? "").trim().toUpperCase();
    const key = c === "" || c === "AUD" ? "AUD" : c;
    buckets.set(key, (buckets.get(key) ?? 0) + inv.amountDue);
  }
  if (buckets.size === 0) return "not specified";
  return Array.from(buckets.entries())
    .map(([c, total]) => fmtAmount(c, Number(total.toFixed(2))))
    .join(" plus ");
}

// Render one invoice as an indented block for the multi-invoice "# Invoices" list.
function formatOneInvoice(inv: InvoiceBlock, index: number): string {
  const today = new Date().toISOString().split("T")[0];
  const dueStatus = inv.dueDate ? (inv.dueDate < today ? "overdue" : "not yet due") : null;
  const lines = [
    `Invoice ${index + 1}${inv.invoiceNumber ? ` (number ${inv.invoiceNumber})` : ""}${dueStatus ? ` — ${dueStatus}` : ""}:`,
    `  Invoice date: ${inv.invoiceDate ?? "not specified"}`,
    `  Due date: ${inv.dueDate ?? "not specified"}`,
    `  Amount due: ${fmtAmount(inv.currency, inv.amountDue)}`,
  ];
  if (inv.lineItems) lines.push(`  ${formatLineItems(inv.lineItems, inv.currency ?? "").replace(/\n/g, "\n  ")}`);
  if (inv.invoiceNotes) lines.push(`  Notes: ${inv.invoiceNotes}`);
  return lines.join("\n");
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
    language = "en",
    gender = "m",
    invoiceNumber,
    invoiceDate,
    dueDate,
    amountDue,
    currency,
    lineItems,
    invoiceNotes,
    invoiceBrief,
  } = args;

  // Resolve the invoice list: the aggregated `invoices` array wins; otherwise fall
  // back to the legacy single-invoice fields (only when an invoice number is present,
  // matching the original behaviour).
  const invoiceList: InvoiceBlock[] = args.invoices && args.invoices.length > 0
    ? args.invoices
    : invoiceNumber
      ? [{ invoiceNumber, invoiceDate, dueDate, amountDue, currency, lineItems, invoiceNotes }]
      : [];
  const agg = invoiceList.length > 1 ? sumSingleCurrency(invoiceList) : null;

  // Explicit voicemail script so the AI says something useful rather than "Goodbye."
  const vmScript = buildVoicemailMessage({
    contactBusiness,
    userName,
    invoiceNumber: invoiceList[0]?.invoiceNumber ?? invoiceNumber,
    amountDue: invoiceList.length > 1 ? (agg?.amount ?? null) : amountDue,
    currency: invoiceList.length > 1 ? (agg?.currency ?? currency) : currency,
    dueDate: invoiceList.length > 1 ? null : dueDate,
    invoiceCount: invoiceList.length,
    language,
    gender,
  });

  // Shared payment/banking block — rendered once per call regardless of invoice count.
  const hasPayment = args.bankName || args.bsb || args.accountNumber || args.swiftCode || args.abn || args.remittanceName || args.remittanceContact;
  const paymentBlock = hasPayment
    ? `\nPayment details:${args.bankName ? `\nBank: ${args.bankName}` : ""}${args.bsb ? ` | BSB: ${args.bsb}` : ""}${args.accountNumber ? ` | Account: ${args.accountNumber}` : ""}${args.swiftCode ? ` | SWIFT: ${args.swiftCode}` : ""}${args.abn ? ` | ABN: ${args.abn}` : ""}${args.remittanceName ? `\nRemit to: ${args.remittanceName}` : ""}${args.remittanceContact ? `, ${args.remittanceContact}` : ""}\nDo not proactively mention payment options, banking details, or offer to share payment information at any point — wait for the contact to raise it. Only if the contact explicitly asks how they can pay or what payment options are available should you respond with the method name(s) only — for example "We can accept payment by bank transfer" — no account numbers or other details yet. Only after the contact confirms they want the details or explicitly asks for them should you share the actual account information. When you do share the details, read them out in small groups of 2–3 pieces at a time, pausing after each group to let them write it down — state the bank name and BSB first, then pause; then the account number, then pause; then any remaining details such as SWIFT code or ABN. Never read all banking fields in one go. If the contact declines the details or says they will arrange payment another way, simply acknowledge and move on — do not re-offer or volunteer anything further.`
    : "";

  // The invoice section: single-invoice keeps the original "# Invoice details"
  // wording; multiple invoices render a numbered "# Invoices" list with a total.
  const invoiceSection = invoiceList.length === 0
    ? ""
    : invoiceList.length === 1
      ? `

# Invoice details
Invoice number: ${invoiceList[0].invoiceNumber ?? "not specified"}
Do not proactively state the invoice number to the contact. Refer to it as "the invoice" or "your invoice". Only read out the invoice number if the contact explicitly asks for it.
Invoice date: ${invoiceList[0].invoiceDate ?? "not specified"}
Due date: ${invoiceList[0].dueDate ?? "not specified"}
Amount due: ${fmtAmount(invoiceList[0].currency, invoiceList[0].amountDue)}
${invoiceList[0].lineItems ? formatLineItems(invoiceList[0].lineItems, invoiceList[0].currency ?? "") : ""}
${invoiceList[0].invoiceNotes ? `Notes: ${invoiceList[0].invoiceNotes}` : ""}${paymentBlock}`
      : `

# Invoices
You are calling about ${invoiceList.length} outstanding invoices from this business. Do not proactively read out invoice numbers; refer to them naturally (e.g. "the oldest invoice", "the one due in March", or by amount). Only read an invoice number if the contact explicitly asks. Each invoice below is marked "overdue" or "not yet due" — lead the conversation with the overdue ones; only discuss a "not yet due" invoice if the contact brings it up themselves.

${invoiceList.map(formatOneInvoice).join("\n\n")}

Combined total across all ${invoiceList.length} invoices: ${totalAmountSpoken(invoiceList)}. Be ready to discuss the invoices individually or settle them together.${paymentBlock}`;

  const languageBlock = language === "hi"
    ? `

# Language
Conduct this entire call in Hindi. Natural Hinglish is welcome — use the common English business words Indian speakers ordinarily use (इनवॉइस, पेमेंट, अकाउंट, ड्यू डेट, फ़ॉलो-अप, कन्फ़र्म, शेड्यूल, ओके) rather than forced literal translations. Mirror the contact: if they switch to English, continue in English; if they speak Hindi, stay in Hindi. Use natural Hindi conversational fillers (हाँ, अच्छा, ठीक है) sparingly. Speak monetary amounts, dates, and numbers naturally in spoken Hindi. End with a warm Hindi farewell (e.g. "ठीक है, धन्यवाद — अलविदा!").

CRITICAL — script: Write EVERY word you say in Devanagari script, including the English/Hinglish loanwords above — spell them out phonetically in Devanagari (इनवॉइस, पेमेंट, डॉलर, कन्फ़र्म, शेड्यूल), NEVER in Roman/Latin letters. The only exception is a proper name with no common Hindi spelling (e.g. a business or person's name), which you may leave as-is. Switching between Latin and Devanagari mid-sentence makes the voice stumble and mispronounce words, so keep the script consistent throughout.

Keep each turn short — one or two sentences — and never repeat or restate what you just said.

The example phrasings shown elsewhere in this prompt are in English — use Hindi equivalents like these instead:
- If asked whether you're a person or AI: "मैं ${userName} की ओर से बात कर ${gender === "f" ? "रही" : "रहा"} एक एआई एजेंट हूँ।"
- Confirming a result back to them: "जी, बस पुष्टि कर लूँ — मंगलवार, उन्नीस तारीख़, दोपहर ढाई बजे — बढ़िया, धन्यवाद।"
- When you don't know a detail about ${userName}: "यह जानकारी मेरे पास नहीं है — मैं उनसे पूछकर आपको वापस कॉल करवा ${gender === "f" ? "देती" : "देता"} हूँ। क्या यह ठीक रहेगा?"
- When you can't decide something yourself: "मुझे उनसे पुष्टि करनी होगी, फिर मैं आपको बता ${gender === "f" ? "दूँगी" : "दूँगा"}।"
- Farewell just before hanging up: "ठीक है, मैं ${gender === "f" ? "चलती" : "चलता"} हूँ — धन्यवाद, अलविदा!"
- If asked how they can pay (method name only, no details yet): "हम बैंक ट्रांसफ़र से भुगतान स्वीकार कर सकते हैं।"`
    : "";

  return `You are Envoy, a polite AI agent placing a phone call on behalf of ${userName}. You're calling ${contactBusiness}.${
    contactPerson
      ? ` If it becomes clear from the caller's response that they are not the right person and are asking who the call should go to (e.g. a gatekeeper or receptionist routing the call), ask to speak with ${contactPerson}. Do not volunteer ${contactPerson}'s name proactively or ask to be transferred in any other situation — if the caller is ready to talk, proceed directly to the call objective.`
      : ` If it becomes clear from the caller's response that they are not the right person and are asking who the call should go to (e.g. a gatekeeper or receptionist routing the call), ask for the Accounts Payable or Finance team. Do not ask to be transferred in any other situation — if the caller is ready to talk, proceed directly to the call objective.`
  }${languageBlock}

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
- ${language === "hi"
    ? `राशि को अंकों की लड़ी की तरह नहीं, बल्कि स्वाभाविक बोले जाने वाले हिंदी शब्दों में कहें (इनवॉइस की असली करेंसी के साथ, जैसे रुपये या डॉलर)। जब पहली बार राशि बताएँ या ग्राहक स्पष्ट रूप से पूछे कि कितना बकाया है, तब पूरी सटीक राशि बताएँ (जैसे "सात हज़ार चार सौ नब्बे रुपये और छत्तीस पैसे")। बाद में उसी बातचीत में आप वैसा संक्षिप्त रूप इस्तेमाल कर सकत${gender === "f" ? "ी" : "े"} हैं जैसा कोई इंसान करता है (जैसे "करीब साढ़े सात हज़ार" या "लगभग साढ़े सात हज़ार रुपये")। मूल सिद्धांत: contact को हमेशा सटीक राशि पता होनी चाहिए — इसलिए अगर वे सीधे पूछें, तो हमेशा पूरी सटीक राशि बताएँ।`
    : `Speak monetary amounts as natural English words, never as digit strings. State the full precise amount when first raising it or when the contact explicitly asks what they owe (e.g. "seven thousand four hundred and ninety dollars and thirty-six cents"). In later references within the same conversation, you may use the shorthand a human would reach for (e.g. "about seventy-five hundred" or "just under seventy-five hundred dollars"). The guiding principle: the contact should always be able to walk away knowing the exact amount — so if they ask directly, always give the precise figure in full.`}

# Date context
Today is ${new Date().toISOString().split("T")[0]}. When an invoice is overdue (its due date is before today), acknowledge it is overdue and focus on arranging a future payment date. All suggested settlement dates or payment plan start dates must be after today.

# Ending the call
When the objective is resolved (success OR a clear no), say a natural farewell (e.g. "Great, I'll let you go — goodbye!") then immediately use the endCall function to hang up. Don't wait for the other person to hang up first. Don't drag it out.

# Voicemail / answering machine
If you hear a beep, hear phrases like "audio message", "leave a message", "record your message", "send a message after the tone", "not available", "unavailable", or any other sign that you have reached a voicemail or automated recording system: say the following word for word — "${vmScript}" — then immediately use the endCall function to hang up. Do not say anything else. Do not wait.

# Opening line
Your opening line has already been delivered: "${buildFirstMessage(userName, language, gender, invoiceBrief)}" Once they confirm availability, move directly into the specifics — do not repeat the opening line or the reason already stated.${invoiceSection}`;
}

interface CreateCallArgs {
  ownerId: string; // tenant that dispatched — carried into the webhook via server.url
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
  // Aggregated multi-invoice list (scheduler path). When provided, it supersedes the
  // single invoice fields above in the system prompt and voicemail.
  invoices?: InvoiceBlock[];
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
  const language = voice.language;
  const gender = voice.gender;

  // Aggregate context for voicemail + post-call summary when chasing multiple invoices.
  const invoiceCount = args.invoices && args.invoices.length > 0 ? args.invoices.length : args.invoiceNumber ? 1 : 0;
  const aggregate = invoiceCount > 1 ? sumSingleCurrency(args.invoices!) : null;
  const hasInvoiceContext = invoiceCount > 0;

  // One-line reason injected into the opening line so the agent states purpose upfront.
  // Only genuinely overdue invoices are counted/labelled "overdue" here — a not-yet-due
  // invoice included as context shouldn't be misrepresented in the very first thing said.
  const today = new Date().toISOString().split("T")[0];
  const overdueInvoices = (args.invoices ?? []).filter((i) => i.dueDate && i.dueDate < today);
  let invoiceBrief: string | undefined;
  if (invoiceCount > 1) {
    if (overdueInvoices.length > 0) {
      const overdueAggregate = sumSingleCurrency(overdueInvoices);
      invoiceBrief = overdueAggregate
        ? `${overdueInvoices.length} overdue invoices totalling ${fmtAmount(overdueAggregate.currency, overdueAggregate.amount)}`
        : `${overdueInvoices.length} overdue invoices`;
    } else {
      invoiceBrief = aggregate
        ? `${invoiceCount} outstanding invoices totalling ${fmtAmount(aggregate.currency, aggregate.amount)}`
        : `${invoiceCount} outstanding invoices`;
    }
  } else if (invoiceCount === 1) {
    const singleAmt = args.invoices?.[0]?.amountDue ?? args.amountDue;
    const singleCur = args.invoices?.[0]?.currency ?? args.currency;
    invoiceBrief = singleAmt != null
      ? `an overdue invoice of ${fmtAmount(singleCur, singleAmt)}`
      : "an overdue invoice";
  }

  const systemPrompt = buildSystemPrompt({
    userName: args.userName,
    contactBusiness: args.contactBusiness,
    contactPerson: args.contactPerson,
    objective: args.objective,
    manner: args.manner,
    language,
    gender,
    invoiceNumber: args.invoiceNumber,
    invoiceDate: args.invoiceDate,
    dueDate: args.dueDate,
    amountDue: args.amountDue,
    currency: args.currency,
    lineItems: args.lineItems,
    invoiceNotes: args.invoiceNotes,
    invoices: args.invoices,
    invoiceBrief,
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
      firstMessage: buildFirstMessage(args.userName, language, gender, invoiceBrief),
      // Speech-to-text. Hindi uses nova-3 "multi" so the agent can follow natural
      // Hindi/English (Hinglish) code-switching; English keeps nova-2 for accuracy.
      // endpointing: ms of silence before Deepgram marks end-of-turn (lower = faster).
      transcriber: language === "hi"
        ? { provider: "deepgram", model: "nova-3", language: "multi", endpointing: 200 }
        : { provider: "deepgram", model: "nova-2", language: "en", endpointing: 200 },
      // The LLM brain — Haiku for fast first-token latency (shorter pause after user speaks).
      model: {
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
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
        ...DEFAULT_VOICE_SETTINGS,
        ...voice.settings,
      },
      // Latency tuning: no artificial post-VAD delay.
      responseDelaySeconds: 0,
      // Behaviour
      maxDurationSeconds: 600, // 10 min hard cap
      silenceTimeoutSeconds: 30,
      endCallFunctionEnabled: true,
      // Hindi: only unambiguous farewells. नमस्ते (also the greeting) and धन्यवाद
      // (said mid-call) must NOT be here or the call hangs up early. The model can
      // also end via endCallFunction, so this list is just a backstop.
      endCallPhrases: language === "hi"
        ? ["goodbye", "अलविदा"]
        : ["goodbye", "talk to you later", "bye now", "have a good one"],
      // Vapi-native voicemail detection (hybrid Gemini + beep). Replaces legacy Twilio
      // AMD, which mis-classified human answers as voicemail (machine_end_beep) on every
      // call and triggered Twilio 15003 AMD-callback errors. Vapi's docs recommend this.
      voicemailDetection: {
        provider: "vapi",
      },
      voicemailMessage: buildVoicemailMessage({
        contactBusiness: args.contactBusiness,
        userName: args.userName,
        invoiceNumber: args.invoices?.[0]?.invoiceNumber ?? args.invoiceNumber,
        amountDue: invoiceCount > 1 ? (aggregate?.amount ?? null) : args.amountDue,
        currency: invoiceCount > 1 ? (aggregate?.currency ?? args.currency) : args.currency,
        dueDate: invoiceCount > 1 ? null : args.dueDate,
        invoiceCount,
        language,
        gender,
      }),
      backgroundDenoisingEnabled: true,
      // Webhook target on the assistant (inline assistant config). The tenant id is
      // carried in the query string so an early webhook that arrives before the Call
      // row has its vapiCallId can still resolve the owner (belt-and-suspenders — the
      // primary resolution is call.ownerId, looked up by vapiCallId in the webhook).
      server: {
        url: `${args.publicUrl}/api/calls/webhook?owner=${encodeURIComponent(args.ownerId)}`,
      },
      // For invoice calls, ask Vapi's post-call AI to produce a factual, call-specific summary.
      ...(hasInvoiceContext ? {
        analysisPlan: {
          summaryPrompt: `Write a 1–2 sentence outcome summary as a brief status note. Start with "Envoy placed a call to [business name] for [e.g. 'an overdue invoice of $X']." Then state what happened — payment promised (and when), voicemail left, contact unavailable, dispute raised, etc. Include only concrete details: dates, amounts, follow-up commitments. No hedging phrases like "it appears" or "it seems". No padding.`,
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
