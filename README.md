# Envoy

AI agent that places phone calls on your behalf. Built on Next.js + Vapi + Twilio + Claude + Gemini.

## What you need before starting

You should already have:
- ✅ A Vapi account with a **private API key**
- ✅ A Twilio account with **Account SID**, **Auth Token**, and a **phone number** (+1 815 283 5864 if you're following along)
- ✅ Your own mobile **verified as a Caller ID in Twilio** (required for trial accounts)
- ✅ An **Anthropic API key** from console.anthropic.com (for Claude — Vapi forwards call LLM requests to Anthropic)
- ✅ A **Google Gemini API key** from aistudio.google.com (for invoice PDF parsing)
- ✅ Node.js 18+ installed (`node --version` to check)

## 1. Install

```bash
cd envoy-backend
npm install
```

This auto-runs `prisma generate` so the database client is built.

## 2. Configure your environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

```
VAPI_PRIVATE_KEY=...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+18152835864
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=    # from aistudio.google.com → API Keys
PUBLIC_URL=        # leave blank for now, we'll set this in step 4
DATABASE_URL="file:./envoy.db"
```

## 3. Initialise the database

```bash
npx prisma db push
```

This creates `envoy.db` and the `Call` table.

## 4. Get a public URL for webhooks (local dev)

Vapi needs to POST webhooks back to your machine when calls end. Your laptop isn't on the public internet, so we use **ngrok** to make it reachable.

### Install ngrok (one-time)
```bash
brew install ngrok           # macOS
# OR download from https://ngrok.com/download
```

You'll need to sign up at ngrok.com (free) and run:
```bash
ngrok config add-authtoken YOUR_NGROK_TOKEN
```

### Start ngrok in a separate terminal
```bash
ngrok http 3000
```

You'll see something like:
```
Forwarding   https://abc123xyz.ngrok-free.app -> http://localhost:3000
```

**Copy that `https://...ngrok-free.app` URL** and paste it into `.env`:
```
PUBLIC_URL=https://abc123xyz.ngrok-free.app
```

> ⚠️ Each time you restart ngrok the URL changes. Update `.env` and restart `npm run dev` whenever this happens. (Or pay $8/mo for a static domain.)

## 5. Run the app

```bash
npm run dev
```

Open **http://localhost:3000** in your browser. You should see Envoy with no calls yet.

## 6. Place your first call

1. Tap **Place a new call**
2. Fill in:
   - **Number to call**: your own verified mobile (e.g. `+61 4xx xxx xxx`)
   - **Contact**: e.g. "Me, testing"
   - **Your name**: what you want Envoy to call you
   - **Objective**: try → `"Confirm this is a working test call. Ask me what I had for breakfast, and respond appropriately. Then end the call."`
3. Pick a voice and manner.
4. Tap **Dispatch Envoy**.
5. Your phone will ring within ~5 seconds. Pick up and talk!
6. When the call ends, the summary appears in the app.

## Vendor contact database

Envoy maintains an internal contact database so it can automatically look up a client's phone number when an invoice doesn't include one.

### First-time setup

```bash
# Copy the example template (prisma/contacts.json is gitignored)
cp prisma/contacts.example.json prisma/contacts.json
```

Edit `prisma/contacts.json` and add entries for your clients. Use the short name as Gemini would extract it (e.g. `"iSoft"` not `"iSoft Software Technologies Pty Ltd"`):

```json
[
  {
    "name": "Client Short Name",
    "phone": "+61400000000",
    "abn": "12345678901",
    "invoiceNumbers": ["INV-001", "INV-002"]
  }
]
```

- **`phone`** — leave empty (`""`) if unknown; fill it in and re-seed later
- **`abn`** — optional; used as a lower-priority fallback match
- **`invoiceNumbers`** — past invoice numbers for this client; enables the most precise match

Then seed the database:

```bash
npm install    # installs tsx if you haven't already
npm run db:seed
```

> `contacts.json` is gitignored — your client names and phone numbers are never committed.

**Re-seeding:** edit `contacts.json` and run `npm run db:seed` again. Entries are upserted, so it's safe to run multiple times.

### How the lookup works

After parsing an invoice, if no phone number was extracted, Envoy queries `GET /api/contacts/lookup` using the parsed client name and invoice number. Matching priority:

1. Invoice number (most precise — same document seen before)
2. Normalized client name (exact)
3. ABN (fallback — payment detail)
4. Partial name match (if unambiguous)

A small **"Found in contacts"** label appears below the phone field when the number came from the database. Editing the field manually clears it.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Dispatch failed: 401" from Vapi | Wrong `VAPI_PRIVATE_KEY` |
| "Number not verified" error | Trial Twilio — verify the destination number in Twilio Console |
| Phone rings but call drops immediately | Vapi can't reach Twilio — check Twilio SID/Auth Token |
| Call connects but no AI voice | Anthropic key invalid, OR ElevenLabs voice ID issue (check `src/lib/vapi.ts`) |
| Call completes but no summary | Webhook not reaching your machine. Verify `PUBLIC_URL` matches your live ngrok URL, and ngrok is still running |
| Invoice parsing fails | `GEMINI_API_KEY` missing or invalid — check aistudio.google.com |
| ngrok shows "tunnel offline" | Restart it. Free tier is sometimes flaky. |

## File map

```
src/
├── app/
│   ├── api/calls/
│   │   ├── dispatch/route.ts        # POST: place a new call via Vapi
│   │   ├── webhook/route.ts         # POST: receives Vapi events (call ended, etc.)
│   │   ├── route.ts                 # GET:  list all calls (home screen)
│   │   └── [id]/route.ts            # GET:  single call (polled by live screen)
│   ├── api/contacts/
│   │   └── lookup/route.ts          # GET:  look up client phone by name/invoice
│   ├── page.tsx                     # The Envoy UI (Home/Compose/Live/Detail)
│   ├── layout.tsx                   # Root layout, fonts
│   └── globals.css                  # Design tokens (cream/burgundy theme)
├── lib/
│   ├── prisma.ts                    # DB client
│   ├── vapi.ts                      # Vapi integration + system prompt builder
│   └── vendor.ts                    # Vendor name/ABN normalization utilities
prisma/
├── schema.prisma                    # Call + Vendor models
├── seed.ts                          # Seeds Vendor table from contacts.json
└── contacts.example.json            # Template — copy to contacts.json and fill in
```

## The system prompt

The "brain" of Envoy lives in `src/lib/vapi.ts` → `buildSystemPrompt()`. This is what tells Claude how to behave on calls. Tweak it freely — this is where 80% of the product quality lives.

## Deploying to Vercel (when you're ready)

```bash
npm install -g vercel
vercel
```

Follow the prompts. Once deployed:
1. Set the same env vars in Vercel Dashboard → Project Settings → Environment Variables
2. Set `PUBLIC_URL` to your Vercel URL (e.g. `https://envoy-xyz.vercel.app`)
3. Redeploy

> ⚠️ Vercel's serverless DB doesn't persist SQLite. For production, swap to Postgres (Vercel Postgres or Supabase). Edit `prisma/schema.prisma` → `provider = "postgresql"` and update `DATABASE_URL`.

## What this app does *not* do (yet)

- Live transcript streaming (transcript only appears after call ends — Vapi supports live websocket transcripts, can add later)
- Call recording playback in-app (link only — could embed an audio player)
- Multi-user / auth (single-user tool — add NextAuth if needed)
- Calendar integrations / SMS follow-ups
- Calling from a real AU number (you'll need to upgrade Twilio and complete AU regulatory verification)

These are all 1–2 day adds. Open issues, not blockers.

## Cost per call (rough)

- Twilio outbound (US to AU mobile): ~$0.20/min
- Vapi platform fee: ~$0.05/min
- Deepgram (STT): ~$0.005/min (included in Vapi)
- ElevenLabs (TTS): ~$0.06/min (included in Vapi)
- Claude (LLM): ~$0.01/min (via your Anthropic key)

**~$0.32/min** for a US→AU call. Most personal calls are 2–4 mins → ~$1–1.30 each.
For AU→AU once you have a real AU number, that drops to ~$0.12/min.
