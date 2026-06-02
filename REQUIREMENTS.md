# Envoy — Product Requirements Document

## Overview

Envoy is a web application that dispatches AI-powered outbound phone calls on behalf of a business user. Its primary use case is **invoice collection**: parsing a supplier invoice PDF, then placing a call to the supplier's accounts team to follow up on payment, confirm bank details, or query line items. It also supports general-purpose outbound calls (scheduling, outreach) via a freeform brief.

---

## Functional Requirements

### 1. Call Dispatch
- Users must be able to compose and dispatch an outbound AI phone call by providing: recipient phone number, business name, a call objective, a voice persona, and a conversational manner (warm / crisp / formal).
- The system must create a call record, route it through Vapi → Twilio → Claude, and update status in real time.
- Call status lifecycle: `dispatching → ringing → in-progress → completed | failed`.

### 2. Invoice Parsing
- Users must be able to upload a PDF invoice; the system must extract structured fields via Google Gemini (vendor name, contact, phone, invoice number, date, due date, amount, currency, line items, payment details).
- Extracted fields must be presented in an editable review form before dispatch.
- An objective must be auto-generated from the parsed invoice data.

### 3. Bulk Invoice Dispatch
- Users must be able to upload or select multiple PDF invoices and dispatch calls for each.
- Bulk dispatch must serialise calls with backpressure (max concurrent calls configurable; default 1 for Twilio trial accounts).
- Each invoice item must show an independent status badge (Reading / Ready / Dispatching / Dispatched / outcome).

### 4. Google Drive Integration
- Users must be able to browse and select invoice PDFs stored in a linked Google Drive folder.
- Contact data (business name, phone, ABN, email) must be readable from and writable to a linked Google Sheets spreadsheet.
- Phone number resolution order: PDF parse → Sheets lookup → manual entry.

### 5. Live Call Monitoring
- During a call, the app must display real-time status, an elapsed timer, and a live-updating transcript (speaker-labelled).
- On completion, an AI-generated summary must be shown inline.

### 6. Call History & Detail
- The home screen must list all past calls with outcome badges, contact name, and relative timestamps.
- A detail view must show full transcript, outcome, duration, call objective, and a link to the recording.
- Voicemail calls must be detected and display only the message left, not a full transcript.

### 7. Contact Management
- The system must auto-append newly discovered contact details to the Sheets contact list after a successful call.
- Phone number lookup must support fuzzy matching by business name or invoice number.

---

## Non-Functional Requirements

| Concern | Requirement |
|---|---|
| **Reliability** | Stale calls (ringing >5 min, in-progress >12 min) must be auto-failed to prevent stuck states |
| **Concurrency** | `MAX_CONCURRENT_CALLS` env var must gate simultaneous Twilio call creation; write-lock must serialise Sheets updates |
| **Privacy** | Transcripts and invoice data stored locally (SQLite); no sensitive data sent to third parties beyond the configured integrations |
| **Scalability** | SQLite is development-only; production deployment must use PostgreSQL (provider swap in Prisma schema) |
| **Accessibility** | Public URL (`PUBLIC_URL`) must be set and reachable for Vapi webhooks to function |

---

## Integrations Required

| Service | Purpose | Credential |
|---|---|---|
| **Vapi** | Voice call orchestration (STT, LLM, TTS, transcripts) | `VAPI_PRIVATE_KEY` |
| **Twilio** | PSTN phone line for outbound calls | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| **Anthropic Claude** | LLM brain powering the AI agent's conversation | `ANTHROPIC_API_KEY` |
| **Google Gemini** | Vision model for PDF invoice field extraction | `GEMINI_API_KEY` |
| **Google Drive / Sheets** | Invoice PDF storage; contact database | `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_DRIVE_FOLDER_ID` |

---

## User Flows (Summary)

1. **General call**: Home → Compose (fill brief) → Live (monitor) → Detail (review transcript)
2. **Single invoice call**: Home → Select Invoice → Upload/Drive tab → Review form → Live → Detail
3. **Bulk invoice dispatch**: Home → Select Invoice → select multiple PDFs → Bulk Summary (monitor all) → Detail per call

---

## Out of Scope

- Inbound call handling
- Multi-user / authentication (single-user local tool)
- SMS or email follow-up channels
- Real-time voice playback in browser
