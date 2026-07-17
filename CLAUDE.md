# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## What this project is

**demo3.0-UI** — the same app as `../demo2.0` (Envoy: dispatches AI-driven outbound calls via Vapi/Twilio/Claude to chase overdue invoices, with a Google Drive/Sheets invoice-ingestion + scheduling queue), wearing the visual system of the sibling product `../../EnvoyIn` (dashboard shell with a collapsible dark sidebar, brand-red `#E31E24`, DM Sans + Bricolage Grotesque, hand-rolled component library).

This was a **UI-only reskin + structural rebuild**, not a feature change: the backend is byte-for-byte identical to demo2.0 (see below), and the goal was full functional parity. If demo2.0 gains a new feature, this project will not pick it up automatically — it's a separate copy, not a shared package.

## Working rules

Same convention as demo2.0: for any non-trivial task, plan first (opus sub-agent / Plan agent), get it reviewed, then execute. Ask clarifying questions rather than guessing on ambiguous points. After any commit that gets pushed, add an entry to the Changelog section below (date, what changed, why) as part of that same push.

## Relationship to demo2.0 and EnvoyIn

- **demo2.0** (`../demo2.0`) — source of truth for all functionality/business logic. This project's `src/lib/*.ts`, `src/app/api/**`, `prisma/schema.prisma`, and `scripts/scheduler.ts` were ported from there with zero logic changes. If a bug is fixed or a feature added in demo2.0's backend, it needs to be manually re-ported here — there's no shared package linking the two.
- **EnvoyIn** (`../../EnvoyIn`) — source of the visual design system (Tailwind theme, `globals.css` utility classes, sidebar shell pattern, component organization). Not otherwise related functionally — EnvoyIn is a different product (inbound-call triage/ticketing, multi-tenant, has auth). This project has no auth, matching demo2.0.

## First-time setup

```bash
npm install
cp .env.example .env   # or copy demo2.0's .env and point DATABASE_URL at ./envoy-demo3.db — see below
npm run db:push
npm run dev:all         # web server (:3010) + scheduler worker together
```

For Vapi webhooks locally: `npm run tunnel` (ngrok on :3010), set `PUBLIC_URL` in `.env` to match.

## Commands

```
npm run dev       # Next.js dev server on :3010 (not :3000 — runs alongside demo2.0)
npm run scheduler # Standalone scheduler worker (node-cron via tsx)
npm run dev:all    # dev server + scheduler worker together
npm run build      # prisma generate + next build
npm run db:push    # Push Prisma schema to SQLite (creates envoy-demo3.db)
npm run tunnel      # ngrok http 3010
```

## Environment / data isolation

- `DATABASE_URL="file:./envoy-demo3.db"` — deliberately a different SQLite file from demo2.0's `envoy.db`, so the two apps never share or collide on data even if run at the same time.
- `.env` currently holds the **same** Vapi/Twilio/Gemini/Google Drive credentials as demo2.0 (copied over) — that's fine, they're the same external accounts. The one thing to watch: `PUBLIC_URL` (the ngrok tunnel Vapi posts webhooks to) can only point at one app's port at a time. Only one of demo2.0 / demo3.0-UI should be actively dispatching real calls at any given moment unless you set up a second tunnel.

## Architecture

### Backend — identical to demo2.0, read that project's CLAUDE.md for the full narrative (call flow, scheduling internals, Google Drive integration, the AI brain in `lib/vapi.ts`). Summary: Vapi (voice orchestration) → Twilio (PSTN) → Claude (LLM brain via Anthropic, configured in the Vapi assistant). `src/lib/dispatcher.ts` holds all grouping/business-hours/concurrency/dispatch logic shared by the HTTP routes and the standalone `scripts/scheduler.ts` worker. Data model (`prisma/schema.prisma`): `Call`, `Invoice` (doubles as the scheduling queue), `Settings` (singleton).

### UI — real routes + shared component library (the structural change from demo2.0)

demo2.0's entire UI lived in one ~4,000-line `src/app/page.tsx` with in-memory screen-switching (no routing). This project restructured that into:

```
src/app/
  app/
    layout.tsx              — ToastProvider + BulkIntakeProvider + AppShellChrome (sidebar shell)
    AppShellChrome.tsx       — collapsible dark sidebar, nav = Dashboard/New Call/Invoices/Queue/Settings
    SchedulerStatusPill.tsx  — sidebar footer status (no auth here, so no user block — shows scheduler on/off instead)
    dashboard/page.tsx        — call history + stats (old Home)
    calls/new/page.tsx         — manual call brief (old Compose)
    calls/new/invoice/page.tsx  — single-invoice upload → dispatch (old InvoiceCompose, standalone path)
    calls/live/[id]/page.tsx    — live call view, dark full-bleed while active (old Live)
    invoices/select/page.tsx    — Drive/upload picker → queue or bulk-dispatch (old SelectInvoiceScreen)
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
  prisma.ts, vapi.ts, dispatcher.ts, drive.ts, sms.ts, nameUtils.ts  — ported verbatim from demo2.0
```

The old call-history "Detail" screen and the bulk-item/queue-invoice "edit" overlays are now `Drawer` overlays (slide-in from the right) instead of full screen transitions, matching EnvoyIn's `TicketDetail` drawer pattern — inspect-in-place rather than navigate-away.

### Design tokens

`src/app/globals.css` — EnvoyIn's `@layer components` classes (`.card`, `.btn-primary/secondary/ghost/danger`, `.input`, `.label`, `.badge`, `.pill`), `.app-bg`/`.sidebar-bg` backgrounds, brand-red Tailwind extension (`tailwind.config.ts`). Demo2.0's own animations with no EnvoyIn equivalent (`wave-bar`, `dot-pulse`, `pulse-ring`, `fade-up`/`fade-in`) were kept and recolored to brand red — they're load-bearing for the Live screen. Demo2.0's cream/burgundy palette, Fraunces/Geist fonts, and `.grain` texture were dropped entirely.

## Changelog

Append-only log — one entry per push: date, what changed, why.

- **2026-07-15** — Initial build. Scaffolded the project, ported the backend verbatim from demo2.0, built the EnvoyIn-style design tokens and shared UI primitive library, built the sidebar dashboard shell, and rebuilt all 9 screens as real routes (parallelized across 5 sub-agents against shared component contracts). Verified with a clean `npm run build`, a full route smoke test, and a live round-trip against the fresh `envoy-demo3.db` (`GET/PUT /api/settings`, `GET /api/calls`, `GET /api/invoices`, `POST /api/scheduler/tick`). Not yet done: visual QA in a browser against EnvoyIn's actual dashboard, and a real end-to-end Vapi dial-out test.
