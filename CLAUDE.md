# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## What this project is

**demo3.0-UI** — the same app as `../demo2.0` (Envoy: dispatches AI-driven outbound calls via Vapi/Twilio/Claude to chase overdue invoices, with a Supabase Storage invoice-ingestion + scheduling queue), wearing the visual system of the sibling product `../../EnvoyIn` (dashboard shell with a collapsible dark sidebar, brand-red `#E31E24`, DM Sans + Bricolage Grotesque, hand-rolled component library). Data + files live in Supabase (Postgres + Storage); the Google Drive/Sheets integration that demo2.0 uses was replaced here (see Changelog).

This was a **UI-only reskin + structural rebuild**, not a feature change: the backend is byte-for-byte identical to demo2.0 (see below), and the goal was full functional parity. If demo2.0 gains a new feature, this project will not pick it up automatically — it's a separate copy, not a shared package.

## Working rules

Same convention as demo2.0: for any non-trivial task, plan first (opus sub-agent / Plan agent), get it reviewed, then execute. Ask clarifying questions rather than guessing on ambiguous points. After any commit that gets pushed, add an entry to the Changelog section below (date, what changed, why) as part of that same push.

## Relationship to demo2.0 and EnvoyIn

- **demo2.0** (`../demo2.0`) — source of truth for all functionality/business logic. This project's `src/lib/*.ts`, `src/app/api/**`, `prisma/schema.prisma`, and `scripts/scheduler.ts` were ported from there with zero logic changes. If a bug is fixed or a feature added in demo2.0's backend, it needs to be manually re-ported here — there's no shared package linking the two.
- **EnvoyIn** (`../../EnvoyIn`) — source of the visual design system (Tailwind theme, `globals.css` utility classes, sidebar shell pattern, component organization), and — as of the 2026-07-22 merge-readiness work — the source of the auth/multi-tenancy/ticket patterns this project now mirrors so it can eventually be merged INTO EnvoyIn. **This project now HAS auth + multi-tenancy** (NextAuth v5, `ownerId` = lowercased email on every table) — the old "no auth, matching demo2.0" statement is superseded (see Changelog 2026-07-22).

## First-time setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL + DIRECT_URL (Supabase) and the API keys — see below
npm run db:push        # syncs the Prisma schema to Supabase Postgres
npm run dev:all         # web server (:3010) + scheduler worker together
```

For Vapi webhooks locally: `npm run tunnel` (ngrok on :3010), set `PUBLIC_URL` in `.env` to match.

## Commands

```
npm run dev       # Next.js dev server on :3010 (not :3000 — runs alongside demo2.0)
npm run scheduler # Standalone scheduler worker (node-cron via tsx)
npm run dev:all    # dev server + scheduler worker together
npm run build      # prisma generate + next build
npm run db:push    # Push Prisma schema to Supabase Postgres (add --force-reset to rebuild clean)
npm run tunnel      # ngrok http 3010
```

## Environment / database

- **Supabase Postgres** (migrated off local SQLite on 2026-07-21 — see Changelog). Two URLs in `.env`:
  - `DATABASE_URL` — pooled connection (pgbouncer, port 6543, `?pgbouncer=true`) used at runtime.
  - `DIRECT_URL` — direct connection (port 5432) used by `prisma db push` / any DDL.
- The schema is **Prisma-owned** (`prisma db push`, no migrations dir). `--force-reset` drops & rebuilds all tables clean.
- Data is now in a **shared remote DB**, so the old SQLite file-per-app isolation is gone: if demo2.0 (still SQLite) and demo3.0 ever point at the same Supabase project they'd collide. Keep them on separate projects/schemas if both dispatch.
- `.env` holds Vapi/Twilio/Gemini credentials (same as demo2.0) plus the Supabase keys (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_INVOICE_BUCKET`). No Google credentials — the Drive/Sheets integration was removed. `PUBLIC_URL` (the ngrok tunnel Vapi posts webhooks to) can only point at one app's port at a time, so only one of demo2.0 / demo3.0-UI should be actively dispatching real calls unless you set up a second tunnel.
- **Files:** invoice PDFs live in the Supabase Storage bucket `invoices` (private; accessed server-side via `SUPABASE_SERVICE_ROLE_KEY`, proxied through `/api/files/*`). **Contacts** are `customer` rows (the old "Business Contact Details" sheet folded in), managed at `/app/contacts`. Helpers: `src/lib/storage.ts`, `src/lib/contacts.ts`.
- `.env` is gitignored and has never been committed — keep it that way (it contains live secrets).

## Architecture

### Backend — call flow/scheduling logic still matches demo2.0 (read that project's CLAUDE.md for the full narrative: call flow, scheduling internals, Google Drive integration, the AI brain in `lib/vapi.ts`). Summary: Vapi (voice orchestration) → Twilio (PSTN) → Claude (LLM brain via Anthropic, configured in the Vapi assistant). `src/lib/dispatcher.ts` holds all grouping/business-hours/concurrency/dispatch logic shared by the HTTP routes and the standalone `scripts/scheduler.ts` worker.

**Persistence diverged from demo2.0 in the Supabase migration** (2026-07-21). The data model is now the normalized CRM ERD (`prisma/schema.prisma`, source ERD in `docs/database-erd.md`):
- `Customer` — the debtor (replaces demo2.0's denormalized `contactBusiness`/`abn`/`groupKey` identity). Resolved find-or-create by ABN → fuzzy name via `resolveCustomerId()` in `dispatcher.ts`.
- `Invoice` — ERD invoice columns **plus** the operational scheduling columns (`chaseAfter`, `status`, `attempts`, `groupKey`, caller config) so it still doubles as the queue.
- `InvoiceLineItem` — line items are rows now, not a JSON string; `serializeLineItems()`/`parseLineItemRows()` in `dispatcher.ts` convert at the API boundary so the parser/prompt/UI still speak the old `{description,quantity,unitPrice,amount}` JSON string.
- `Call` — ERD call columns + denormalized lead-invoice snapshot cols (amountDue/currency/banking/invoiceNumber) for the detail view + SMS. `transcript` is native `jsonb`. Linked to invoices via `CallInvoice` (join table; replaces the old `Invoice.callId`).
- `Settings` — singleton, not part of the ERD (added for the scheduler).
- `Payment`, `Note`, `SalesPerson`, `Location` — ERD tables defined for completeness; not written by the app yet.

Prisma **field names were kept identical to demo2.0** (camelCase) and `@map`'d to the ERD's snake_case columns, so the API JSON contracts and UI were left unchanged. Pragmatic type notes: money is `Float` (double, not `numeric`), dates (`invoiceDate`/`dueDate`) are `text` to preserve string-compare logic.

### UI — real routes + shared component library (the structural change from demo2.0)

demo2.0's entire UI lived in one ~4,000-line `src/app/page.tsx` with in-memory screen-switching (no routing). This project restructured that into:

```
src/app/
  app/
    layout.tsx              — ToastProvider + BulkIntakeProvider + AppShellChrome (sidebar shell)
    AppShellChrome.tsx       — collapsible dark sidebar, nav = Dashboard/New Call/Invoices/Queue/Contacts/Settings
    SchedulerStatusPill.tsx  — sidebar footer status (no auth here, so no user block — shows scheduler on/off instead)
    dashboard/page.tsx        — call history + stats (old Home)
    calls/new/page.tsx         — manual call brief (old Compose)
    calls/new/invoice/page.tsx  — single-invoice upload → dispatch (old InvoiceCompose, standalone path)
    calls/live/[id]/page.tsx    — live call view, dark full-bleed while active (old Live)
    invoices/select/page.tsx    — Supabase Storage / upload picker → queue or bulk-dispatch (old SelectInvoiceScreen)
    contacts/page.tsx            — manage contacts (customer rows): view/add/edit phone numbers
    invoices/bulk/page.tsx       — legacy immediate bulk dispatch (old BulkInvoiceScreen)
    queue/page.tsx                — scheduling queue, grouped by debtor (old QueueScreen)
    settings/page.tsx              — scheduler/business-hours/retry config (old SettingsScreen)
src/components/shared/        — Icons, Button, Card, Badge, Toast, ConfirmDialog, Skeleton, Drawer, Modal,
                                 Spinner, WaveformViz, Logo, Hairline, plus two feature-shared pieces:
                                   - InvoiceComposeForm.tsx  — the parsed-invoice review/edit form, reused by
                                     the standalone new-invoice page, the bulk-item edit drawer, and the
                                     queue-invoice edit drawer
                                   - CallDetailDrawer.tsx    — call detail, reused by Dashboard, Bulk, and Queue
                                   - BulkIntakeContext.tsx   — the in-flight bulk-upload/parse/dispatch state,
                                     lifted into a context (mounted in app/layout.tsx) so it survives navigation
                                     between /app/invoices/select and /app/invoices/bulk, since those are now
                                     two separate routes instead of one shared parent component's state
src/lib/
  format.ts, client-types.ts  — formatting helpers and frontend types, ported from demo2.0's page.tsx
  prisma.ts, vapi.ts, dispatcher.ts, sms.ts, nameUtils.ts  — ported from demo2.0
  storage.ts    — Supabase Storage (invoice PDFs); contacts.ts — contacts backed by the customer table
                  (these replace demo2.0's drive.ts)
```

The old call-history "Detail" screen and the bulk-item/queue-invoice "edit" overlays are now `Drawer` overlays (slide-in from the right) instead of full screen transitions, matching EnvoyIn's `TicketDetail` drawer pattern — inspect-in-place rather than navigate-away.

### Design tokens

`src/app/globals.css` — EnvoyIn's `@layer components` classes (`.card`, `.btn-primary/secondary/ghost/danger`, `.input`, `.label`, `.badge`, `.pill`), `.app-bg`/`.sidebar-bg` backgrounds, brand-red Tailwind extension (`tailwind.config.ts`). Demo2.0's own animations with no EnvoyIn equivalent (`wave-bar`, `dot-pulse`, `pulse-ring`, `fade-up`/`fade-in`) were kept and recolored to brand red — they're load-bearing for the Live screen. Demo2.0's cream/burgundy palette, Fraunces/Geist fonts, and `.grain` texture were dropped entirely.

## Changelog

Append-only log — one entry per push: date, what changed, why.

- **2026-07-15** — Initial build. Scaffolded the project, ported the backend verbatim from demo2.0, built the EnvoyIn-style design tokens and shared UI primitive library, built the sidebar dashboard shell, and rebuilt all 9 screens as real routes (parallelized across 5 sub-agents against shared component contracts). Verified with a clean `npm run build`, a full route smoke test, and a live round-trip against the fresh `envoy-demo3.db` (`GET/PUT /api/settings`, `GET /api/calls`, `GET /api/invoices`, `POST /api/scheduler/tick`). Not yet done: visual QA in a browser against EnvoyIn's actual dashboard, and a real end-to-end Vapi dial-out test.
- **2026-07-21** — Replaced the **Google Drive/Sheets** file+contacts integration with **Supabase**. Invoice PDFs now live in a private Supabase Storage bucket (`invoices`) via `src/lib/storage.ts` + `/api/files/*` (list/download-proxy/upload); the "Business Contact Details" sheet was folded into the `customer` table via `src/lib/contacts.ts` + `/api/contacts` (+ `/api/contacts/[id]`), with a new `/app/contacts` screen to view/add/edit contacts and a Contacts sidebar nav item. Added `Invoice.sourceFilePath` linking each queued invoice to its stored PDF; the upload flow now saves local PDFs to the bucket too. A one-time migration moved the existing 15 Drive PDFs + 2 sheet contacts across, then `src/lib/drive.ts`, `/api/drive/*`, the `googleapis`/`xlsx` deps, and all `GOOGLE_*` env were removed. Added `@supabase/supabase-js`. Verified end-to-end: file list/download, parse→queue with `source_file_path` + customer/line-item rows, contact add/edit, and phone lookup all round-trip against Supabase; `npm run build` clean.
- **2026-07-21** — Migrated persistence from local SQLite to **Supabase Postgres** onto the normalized CRM ERD (`docs/database-erd.md`): rewrote `prisma/schema.prisma` (9 ERD tables + `Settings` + operational columns), added `resolveCustomerId`/`serializeLineItems`/`parseLineItemRows` to `dispatcher.ts`, and reworked the API routes to the new tables (line items → `InvoiceLineItem` rows, `Invoice.callId` → `CallInvoice` join, `transcript` → `jsonb`). Prisma field names kept camelCase and `@map`'d to snake_case columns, so the API contracts + UI are unchanged. `.env` switched to pooled `DATABASE_URL` + `DIRECT_URL`; schema pushed with `prisma db push --force-reset`. Verified against live Supabase: queue enqueue creates customer/invoice/line-item rows, settings, dedup, and PATCH all round-trip; `npm run build` clean. Still pending: a real end-to-end Vapi dial-out test.

- **2026-07-22** — **Merge-readiness Phase 1: multi-tenancy + auth + tickets + customer_id** (branch `feature/phase1-multitenancy-auth`, pushed to remote `voiceagent1` — github.com/Shreyank-isoft/voiceagent1, commit `2359f36`). First phase of evolving this app to adopt EnvoyIn's patterns so it can later be merged INTO EnvoyIn (plan: `~/.claude/plans/i-am-working-on-modular-tiger.md`). This is the foundation that unblocks Phases 2–3.
  - **Schema** (`prisma/schema.prisma`, pushed with `--force-reset` — prior data was disposable test data, JSON backup taken first): added `ownerId` (= lowercased email, EnvoyIn's tenant key) to every aggregate root (Customer/Invoice/Call/Payment/Note/SalesPerson/Location); added an EnvoyIn-shaped **`Ticket`** model (one per outbound Call, tagged `outbound`, with a real `customerId` FK EnvoyIn's tickets lack) + a **`Tenant`** config table (EnvoyIn `app_config` analogue: profile blob, per-business `phoneNumber`, members, forecast history, credentials); re-keyed **`Settings`** from the global `id:"singleton"` row to one row per `ownerId`; added NextAuth `User`/`Account`/`VerificationToken` (JWT strategy).
  - **Auth** (mirrors EnvoyIn, adapted to TS + Prisma): NextAuth v5 (Google + magic link) — `src/auth.ts`, `src/auth.config.ts` (edge-safe), `src/middleware.ts` (gates `/app`,`/onboarding`,`/api`; PUBLIC_ROUTES = webhook + cron + `/api/auth`), `src/lib/auth-adapter.ts` (forces `user.id = lowercased email`), `src/lib/access.ts` (`resolveAccess`/`hasRole`/`forbidden`/`unauthorized` + `trim*` stubs), `src/lib/tenant.ts`, `src/lib/members.ts` (Phase-1 stub), `src/lib/email.ts`/`email-provider.ts` (Resend; falls back to logging the sign-in link to the server console when `RESEND_API_KEY` is unset), `/login` + `/verify-email` (Safe-Links inert-confirm) pages. New env in `.env.example`: `AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PUBLIC_BASE_URL`, `CRON_SECRET`. Installed `next-auth@5.0.0-beta.31` + `resend`.
  - **ownerId threading:** every `src/lib/*` data fn and **every** API route now takes/derives `ownerId` first and scopes by it; single-row reads filter by `id AND ownerId` (IDOR guard); role gates applied (agent+ to dispatch/queue/edit, admin+ to settings). `src/lib/tickets.ts` added (EnvoyIn-shaped, ownerId-first). Storage keys owner-prefixed (`<ownerId>/…`) with an IDOR guard on download.
  - **Ticket-per-call:** both dispatch paths (`/api/calls/dispatch`, `dispatcher.dispatchInvoiceGroup`) create an `outbound` Ticket; the **webhook** (`/api/calls/webhook`) resolves tenant from `call.ownerId` (with a `?owner=` fallback stamped onto the Vapi `server.url`), updates the linked ticket, and backfills the Customer (`backfillCustomerFromCall`). New `/api/tickets` + `/api/tickets/[id]`.
  - **On-demand scheduler:** `runSchedulerTick(ownerId)` + new `runAllTenantsTick()`; new secured `POST /api/cron/dispatch` (Bearer `CRON_SECRET`) for serverless/external schedulers; `scripts/scheduler.ts` now calls `runAllTenantsTick` (local dev only).
  - **Verified:** `npm run build` clean (25 routes + edge middleware); a data-layer isolation script passed **14/14** owner-scoping/IDOR checks; live route smoke passed (unauth `/api/*`→401, `/app/*`→`/login`, cron guard 401/200, `/api/auth/providers` 200).
  - **NOT yet tested (do before relying on it):** (1) full **authenticated end-to-end** — sign in (Google needs OAuth creds; magic link works via the console-logged link when Resend is unset), dispatch a real call, confirm the `outbound` Ticket is created and flipped to Resolved by the Vapi webhook. No live Vapi dial-out was run. (2) The magic-link **email** path with a real Resend key. (3) Multi-tenant dispatch with >1 real tenant. (4) Google OAuth redirect/`AUTH_SECRET` in any deployed env. Per-tenant phone number + credential consolidation are deferred to Phase 3G (dispatch still uses the shared `TWILIO_PHONE_NUMBER` env for now). [UPDATE: the magic-link sign-in flow (console-link mock) + owner-scoped data access were subsequently verified E2E during Phase 2 — see below. Still untested: real Vapi dial-out, real Resend email, Google OAuth, >1-tenant dispatch.]

- **2026-07-22** — **Merge-readiness Phase 2: Customers CRM + Outbound dashboard + Onboarding** (same branch `feature/phase1-multitenancy-auth`, pushed to remote `voiceagent1` — github.com/Shreyank-isoft/voiceagent1, commit `c6f1b3b`). Builds on Phase 1's tenancy/tickets foundation.
  - **Customers master + detail** (absorbs the old Contacts screen): `src/lib/customers.ts` (owner-scoped `getCustomers` with open-invoice/outstanding aggregates, `getCustomer` detail with nested invoices/tickets/calls, create/update with IDOR guard); `/api/customers` + `/api/customers/[id]`; `/app/customers` master table (search, add-customer drawer with delivery address) and `/app/customers/[id]` detail (header + Invoices / Tickets (both channels) / Calls / Payments sub-tabs; Payments is a Phase-3 stub). Nav: `Contacts`→`Customers`, old `/app/contacts` route now redirects to `/app/customers` (new `IconChart` added for the Outbound tab).
  - **Outbound dashboard** (`/app/outbound`, new sidebar tab): server-side aggregation `src/lib/outbound-stats.ts` + `/api/outbound/stats` (call-outcome breakdown, resolution rate, queue depth, outbound-ticket status, 14-day calls-per-day series). Hand-rolled SVG chart primitives in `src/components/shared/charts/Charts.tsx` (StatTile / DonutChart / VBar) following EnvoyIn's no-charting-library convention — built via the **dataviz skill**: form-first (stat tiles for KPIs, donut for status mix, vertical bars for time), a **validated status palette** (resolved `#10b981` / voicemail `#94a3b8` / failed `#E31E24` / active `#f59e0b` — CVD ΔE and normal-vision checks pass; each slice always carries a legend + numeric label), 2px segment gaps, hover layers.
  - **Onboarding** (`/onboarding` + `src/components/onboarding/OnboardingWizard.tsx`, framer-motion 5-step wizard: Business identity + delivery address → seed outbound Contacts → Call-moment defaults (voice/manner/objective + business hours) → Credentials placeholder → Review). `/api/onboarding` creates the Tenant row, seeds Settings business-hours, and seeds Customer rows. **New-owner gate**: `src/app/app/layout.tsx` (now an async server component) redirects owners with no Tenant row to `/onboarding`; `/onboarding` bounces already-configured owners back to `/app` — mirrors EnvoyIn's page-level onboarding check.
  - **Verified (authed E2E, via the magic-link console-link mock):** sign-in establishes a session (`session.user.id` = lowercased email); a new owner is redirected to `/onboarding`; completing onboarding creates the tenant + seeds 2 customers and unlocks `/app` (dashboard 200); `/api/customers` returns exactly the seeded owner-scoped rows; `/api/outbound/stats`, `/api/tickets?channel=outbound`, `/app/customers`, `/app/outbound` all 200; `/app/contacts`→`/app/customers` redirect works. `npm run build` clean (30 routes). Smoke-test tenant data was cleaned up afterward.
  - **Not built yet:** Phase 3 (payments consolidation, deterministic invoice parser + Gemini fallback, forecasting from live data, analytics inbound/outbound segmentation, Team & Access field-hiding, on-demand cron wiring docs, per-tenant credentials + phone number).
