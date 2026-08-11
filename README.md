# Envoy — Outbound AI Collections Voice Agent (demo3.0)

Next.js 14 (App Router) · TypeScript · Prisma · Supabase Postgres · NextAuth v5 · Vapi/Twilio

This guide gets the app running locally for testing. Auth is email + password (no OAuth) — sign-in itself needs `AUTH_SECRET` and Resend configured (see below); the voice-call integrations are separately optional and only needed to exercise those flows.

---

## Prerequisites

- **Node.js 18.18+** (Next 14 requirement; Node 20 LTS recommended)
- **npm**
- A **Supabase project** (free tier is fine) — provides the Postgres DB and the Storage bucket for invoice PDFs
- Optional, only for full end-to-end calls: **Vapi**, **Twilio**, and an **ngrok** tunnel

## 1. Install

```bash
cd voiceagent-demo3.0
npm install
```

`postinstall` runs `prisma generate` automatically.

## 2. Configure environment

Copy the template and fill it in:

```bash
cp .env.example .env
```

**Minimum to boot the UI locally:**

| Variable | Where to get it | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Supabase → Settings → Database | Pooled connection, port **6543** (`pgbouncer=true`) — used at runtime |
| `DIRECT_URL` | same page | Direct connection, port **5432** — used by `prisma db push` |
| `SUPABASE_URL` | Supabase → Settings → API | |
| `SUPABASE_SERVICE_ROLE_KEY` | same page | Server-side only — never expose to the client |
| `AUTH_SECRET` | run `npx auth secret` | Any random 32-byte base64 string. Required — every `/api/auth/*` route 500s without it. |
| `PUBLIC_BASE_URL` | — | `http://localhost:3010` for local dev. Used to build invite / password-reset links. |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | resend.com → API Keys | Required to actually send invite / password-reset emails. Without a key, links print to the dev-server console instead (fine for local dev). |

**Optional (only for the flows you want to test):**

- `VAPI_PRIVATE_KEY`, `TWILIO_*`, `ANTHROPIC_API_KEY`, `PUBLIC_URL` — live outbound calls
- `GEMINI_API_KEY` — AI invoice-PDF parsing (5 known vendors parse without it)
- `CRON_SECRET` — protects `POST /api/cron/dispatch`

See `.env.example` for the full annotated list.

## 3. Set up the database

Push the Prisma schema into your Supabase Postgres:

```bash
npm run db:push
```

> First-time / disposable DB only: `npx prisma db push --force-reset` drops and recreates. Do **not** run `--force-reset` against data you care about.

## 4. Seed demo data (optional but recommended)

Populates a tenant, customers, invoices, calls, and tickets so every screen renders with data. Pass your login email as the owner:

```bash
npm run import:invoices                                  # sample invoices
npx tsx scripts/seed-demo.ts --owner=you@example.com     # tenant + calls + tickets
npm run seed:crm -- --owner=you@example.com              # sales persons, locations, CRM detail
```

Use the **same email** here that you'll sign in with (the app is scoped per-owner by lowercased email). These scripts create the `Tenant` but not a `User` row with a password — set one before you can log in:

```bash
npx tsx scripts/set-owner-password.ts you@example.com <password>
```

(Alternatively, skip seeding and use `/signup` to create a brand-new company from scratch.)

## 5. Run

```bash
npm run dev        # app only, on http://localhost:3010
# or
npm run dev:all    # app + background scheduler/worker (concurrently)
```

Open **http://localhost:3010**, click **Log in**, and sign in at `/login` with the email + password you set above.

---

## Testing the optional integrations

- **Live outbound calls** — set the Vapi/Twilio/Anthropic keys, start an ngrok tunnel with `npm run tunnel`, and put the ngrok HTTPS URL in `PUBLIC_URL` (this is where Vapi posts call-end webhooks).
- **Invite / password-reset email** — add `RESEND_API_KEY`; without it, the links print to the dev-server console instead of being emailed.
- **Cron dispatch** — `POST /api/cron/dispatch` with header `Authorization: Bearer <CRON_SECRET>`. See `docs/scheduler-cron.md`.
- **Phase-3 features** (team access, payments, forecasting, analytics, invoice parsing) — see `docs/phase3-testing.md`.

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on :3010 |
| `npm run dev:all` | Dev server + scheduler worker |
| `npm run build` | `prisma generate` + `next build` |
| `npm run start` | Serve the production build on :3010 |
| `npm run db:push` | Apply Prisma schema to the database |
| `npm run seed:demo` | Seed demo tenant/calls/tickets |
| `npm run seed:crm` | Seed CRM reference data + detail |
| `npm run lint` | Next.js lint |

## Troubleshooting

- **`prisma db push` can't connect** — make sure `DIRECT_URL` uses port **5432** (not the pooled 6543).
- **Build fails with `EPERM` on Windows** — stop the dev server before running `npm run build`; Windows locks the Prisma engine DLL while the server holds it. Kill the :3010 process, build, then restart.
- **No data on screens** — you haven't seeded, or you seeded a different `--owner` email than the one you signed in with.
- **Can't sign in** — make sure `AUTH_SECRET` is set (every `/api/auth/*` route 500s without it), and that you've run `scripts/set-owner-password.ts` for a seeded owner (seeding alone doesn't create a `User`/password).
