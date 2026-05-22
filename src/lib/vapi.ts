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

interface BuildSystemPromptArgs {
  userName: string;
  contactName: string;
  objective: string;
  manner: Manner;
}

/**
 * This is the actual "brain" content of Envoy.
 * Tweak this prompt to change how Envoy behaves on calls.
 */
export function buildSystemPrompt(args: BuildSystemPromptArgs): string {
  const { userName, contactName, objective, manner } = args;

  return `You are Envoy, a polite AI agent placing a phone call on behalf of ${userName}. You're calling ${contactName}.

# Your objective
${objective}

# How to behave
${MANNER_GUIDANCE[manner]}

# Critical rules
- You ARE an AI agent. If asked directly whether you're a person or AI, say "I'm an AI agent calling on behalf of ${userName}." Don't volunteer it unprompted unless local law requires it.
- Speak naturally. You are on a real phone call — no markdown, no lists, no formal headers, just spoken sentences. Use commas and pauses, not bullets.
- Keep your turns short (1-2 sentences) unless explaining something complex. Let the other person talk.
- If the other person asks you something you don't know about ${userName}, say honestly: "I don't have that detail — I can check with them and have them call back. Would that work?"
- If you achieve the objective, confirm the result clearly back to them ("So just to confirm, that's Tuesday the 19th at 2:30pm — perfect, thank you."), then politely end the call.
- If you can't achieve the objective (closed, no availability, wrong number, etc.), say so honestly and end the call politely.
- Never make commitments on behalf of ${userName} beyond what's explicitly in the objective. If asked something you can't decide, defer: "I'll need to check with them and get back to you."

# Ending the call
When the objective is resolved (success OR a clear no), say goodbye naturally and end the call. Don't drag it out.

# Opening line
Start the call with: "Hi, this is Envoy calling on behalf of ${userName}. ${
    objective.length < 100
      ? `They're hoping to ${objective.toLowerCase().replace(/^to /, "")}.`
      : "I'm calling about something they'd like sorted — can I run you through it?"
  } Is now an okay time?"`;
}

interface CreateCallArgs {
  toNumber: string;
  contactName: string;
  objective: string;
  voice: VoiceId;
  manner: Manner;
  userName: string;
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
    contactName: args.contactName,
    objective: args.objective,
    manner: args.manner,
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
        // Pass your Anthropic key through — Vapi forwards LLM calls to Anthropic on your behalf
        // (If you don't pass this, Vapi bills you for LLM usage at their markup. With key, you pay Anthropic direct.)
      },
      // Text-to-speech
      voice: {
        provider: voice.provider,
        voiceId: voice.voiceId,
      },
      // Behaviour
      maxDurationSeconds: 600, // 10 min hard cap
      silenceTimeoutSeconds: 30,
      endCallPhrases: ["goodbye", "talk to you later", "bye now", "have a good one"],
      // Webhook target
      server: {
        url: `${args.publicUrl}/api/calls/webhook`,
      },
    },
    // Webhook for this specific call
    // server: { url: `${process.env.PUBLIC_URL}/api/calls/webhook` },
  };

  const res = await fetch(`${VAPI_BASE}/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vapi dispatch failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<VapiCallResponse>;
}

/**
 * Fetch the latest state of a call from Vapi (used for polling the live screen).
 */
export async function getVapiCall(vapiCallId: string): Promise<VapiCallResponse> {
  const res = await fetch(`${VAPI_BASE}/call/${vapiCallId}`, {
    headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Vapi getCall failed: ${res.status}`);
  }
  return res.json() as Promise<VapiCallResponse>;
}
