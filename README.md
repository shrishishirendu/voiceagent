# Envoy

AI agent that places phone calls on your behalf. Built on Next.js + Vapi + Twilio + Claude + Gemini. Supports single calls, bulk invoice dispatch, and Google Drive invoice ingestion with automatic contact management.

**Three flows:**

| Flow | How to trigger |
|---|---|
| **Single call** | Fill in the brief manually → Dispatch |
| **Invoice batch** | Select invoices (Drive tab or file upload) → parse with Gemini → dispatch one call per invoice |
| **Retry failures** | After a batch settles, hit **Retry failed** — "no phone" items re-resolve from the spreadsheet first so adding a number and retrying is seamless |

> When a call goes to voicemail, Envoy leaves a tailored message automatically and marks the call **No answer**.

## What you need before starting

- ✅ A **Vapi** account with a private API key
- ✅ A **Twilio** account with Account SID, Auth Token, and a phone number
- ✅ Your own mobile **verified as a Caller ID in Twilio** (required for trial accounts)
- ✅ An **Anthropic** API key (console.anthropic.com) — Claude is the call AI brain
- ✅ A **Google Gemini** API key (aistudio.google.com) — for invoice PDF parsing
- ✅ A **Google Cloud** service account with Drive + Sheets API enabled (for Google Drive invoice flow)
- ✅ Node.js 18+

## 1. Install

```bash
npm install
```

## 2. Configure your environment

```bash
cp .env.example .env
```

Fill in `.env`:

```
VAPI_PRIVATE_KEY=...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+18152835864
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
PUBLIC_URL=            # set in step 4
DATABASE_URL="file:./envoy.db"

# Google Drive (required for Drive invoice flow)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
GOOGLE_DRIVE_FOLDER_ID=<your-folder-id>
# GOOGLE_DRIVE_CONTACTS_SHEET_NAME=Business Contact Details   # optional override
```

## 3. Initialise the database

```bash
npx prisma db push
```

## 4. Get a public URL for webhooks (local dev)

Vapi POSTs webhooks to your machine when calls end. Use **ngrok** to expose it:

```bash
ngrok http 3000
```

Copy the `https://...ngrok-free.app` URL into `.env` as `PUBLIC_URL`.

> Each time you restart ngrok the URL changes — update `.env` and restart `npm run dev`.

## 5. Run the app

```bash
npm run dev
```

Open **http://localhost:3000**.

---

## Google Drive integration setup

The Drive invoice flow requires a Google Cloud service account and a contacts spreadsheet. One-time setup:

### 5a. Create a Google Cloud service account

1. Go to **console.cloud.google.com → IAM & Admin → Service Accounts**
2. Create a new service account, then create a **JSON key** for it
3. Paste the entire JSON (single line) as `GOOGLE_SERVICE_ACCOUNT_KEY` in `.env`
4. In the Google Cloud console, enable two APIs for your project:
   - **Google Drive API** (`drive.googleapis.com`)
   - **Google Sheets API** (`sheets.googleapis.com`)

### 5b. Set up your Drive folder

1. Create (or designate) a Google Drive folder for invoices
2. **Share that folder** with the service account's `client_email` address as **Editor**
3. Copy the folder ID from the URL (`https://drive.google.com/drive/folders/<FOLDER_ID>`) into `GOOGLE_DRIVE_FOLDER_ID`
4. Upload your invoice PDFs into this folder

### 5c. Create the contacts spreadsheet

1. Inside the same folder, create a **native Google Sheet** (not an uploaded .xlsx) named exactly:
   ```
   Business Contact Details
   ```
2. Add a header row in row 1. Minimum required columns:
   ```
   Business Name | ABN | Phone
   ```
   Optional additional columns (recommended):
   ```
   Email | Contact Person
   ```
3. **Share the spreadsheet** with the service account `client_email` as **Editor** (separate from the folder share)
4. Leave the Phone column blank — Envoy fills in Business Name and ABN from invoices; you add phone numbers manually

### Phone number format in the spreadsheet

You do **not** need a leading `+` — the app normalises numbers to E.164 automatically:

| You type | Sent to Twilio |
|---|---|
| `0412345678` | `+61412345678` |
| `61412345678` | `+61412345678` |
| `+61412345678` | `+61412345678` |
| `04 1234 5678` | `+61412345678` |

> Google Sheets treats a leading `+` as a formula and rejects it. Just type the number without it.

### How the contact flow works

1. **Dispatch invoices** → the app parses each PDF, extracts business names + ABN, and writes any new businesses to the spreadsheet (Phone left blank)
2. **Add phone numbers** in the spreadsheet for each business you want to call
3. **Retry / re-dispatch** → the app resolves the phone from the sheet and places the call

Phone resolution priority per invoice: **spreadsheet Phone column** → **number found in the PDF** → fail with "No phone number found — add it to the spreadsheet"

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Dispatch failed: 401" | Wrong `VAPI_PRIVATE_KEY` |
| "Number not verified" | Trial Twilio — verify the destination in Twilio Console |
| Phone rings but call drops | Vapi can't reach Twilio — check SID/Auth Token |
| Call connects but no AI voice | Anthropic key invalid, or ElevenLabs voice ID issue |
| Call completes but no summary | `PUBLIC_URL` doesn't match live ngrok URL, or ngrok isn't running |
| Invoice parsing fails | `GEMINI_API_KEY` missing or invalid |
| Drive tab shows no files | `GOOGLE_DRIVE_FOLDER_ID` wrong, or Drive API not enabled, or folder not shared with service account |
| Contacts spreadsheet not updating | Sheets API not enabled in Google Cloud, or the sheet isn't shared with the service account as **Editor** |
| Spreadsheet writes to wrong file | You have both a `.xlsx` and a native Google Sheet with the same name — the app prefers the native Sheet; delete the stale `.xlsx` |
| Invoices stuck at "Ready" | Phone number in the sheet wasn't picked up — hit **Retry failed** after adding numbers |
| `+` rejected in Google Sheets | Don't use `+` — type `61412345678` or `0412345678` instead |

---

## File map

```
src/
├── app/
│   ├── api/calls/
│   │   ├── dispatch/route.ts           # POST: place a call via Vapi (phone normalisation here)
│   │   ├── webhook/route.ts            # POST: receives Vapi events
│   │   ├── route.ts                    # GET:  list all calls
│   │   ├── [id]/route.ts               # GET:  single call (polled by live screen)
│   │   └── parse-document/route.ts     # POST: parse invoice PDF via Gemini
│   ├── api/drive/
│   │   ├── invoices/route.ts           # GET:  list PDFs in Drive folder
│   │   ├── contacts/route.ts           # GET/POST: read/write Business Contact Details sheet
│   │   └── invoice-file/route.ts       # GET:  download a PDF by fileId
│   ├── api/contacts/
│   │   └── lookup/route.ts             # GET:  look up client phone by name/invoice
│   ├── page.tsx                        # The entire Envoy UI (all screens)
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── drive.ts                        # Google Drive + Sheets integration
│   ├── nameUtils.ts                    # Fuzzy company name matching
│   ├── prisma.ts
│   └── vapi.ts                         # Vapi integration + system prompt builder
prisma/
└── schema.prisma
```

---

## The system prompt

`src/lib/vapi.ts → buildSystemPrompt()` is the AI brain. Tweak it to change call behaviour — this is where most of the product quality lives.

---

## Deploying to Vercel

```bash
npm install -g vercel
vercel
```

Set the same env vars in Vercel Dashboard → Project Settings → Environment Variables, including all `GOOGLE_*` vars. Set `PUBLIC_URL` to your Vercel deployment URL.

> SQLite doesn't work on Vercel serverless. Swap `prisma/schema.prisma` → `provider = "postgresql"` and update `DATABASE_URL` to a Postgres connection string (Vercel Postgres or Supabase).

---

## What this app does not do (yet)

- Live transcript streaming (appears after call ends — Vapi supports live websocket transcripts)
- Call recording playback in-app (link only — could embed an audio player)
- Multi-user / auth (single-user tool — add NextAuth if needed)
- Calendar integrations / SMS follow-ups
- Calling from a real AU number (requires Twilio upgrade + AU regulatory verification)

---

## Cost per call (rough)

- Twilio outbound (US → AU mobile): ~$0.20/min
- Vapi platform fee: ~$0.05/min
- Deepgram STT: ~$0.005/min (included in Vapi)
- ElevenLabs TTS: ~$0.06/min (included in Vapi)
- Claude LLM: ~$0.01/min (via your Anthropic key)

**~$0.32/min** for US→AU. Most calls are 2–4 mins → ~$0.65–1.30 each.
AU→AU with a real AU number drops to ~$0.12/min.
