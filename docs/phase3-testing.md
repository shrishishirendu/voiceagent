# Phase 3 — local testing guide

Everything below runs **locally with no third-party services** (no real Vapi/Twilio/Resend/Google).
Sign-in uses the magic-link **console mock**: when `RESEND_API_KEY` is unset, the sign-in link is
printed to the `npm run dev` terminal instead of emailed — copy it from there.

There are **no schema changes in Phase 3**, so you do **not** need to run `prisma db push`. If you
haven't set up the DB before: `npm install` then ensure `.env` has `DATABASE_URL` + `DIRECT_URL`.

## 0. Start the app

```bash
npm run dev            # http://localhost:3010
# optional, for scheduler tests: npm run scheduler   (separate terminal)
```

Sign in: open `/login`, enter your email, submit. Watch the dev terminal for a line like
`sign-in link: http://localhost:3010/api/auth/callback/...` — open that URL to complete sign-in.
A brand-new email is routed to `/onboarding`; finish it to reach `/app`.

Throughout, "owner" = the email you signed in as (lowercased) — it's your workspace/tenant id.

---

## 3C — Team & Access (roles + field-hiding)

**Where:** Settings → *Team & access* card (owner/admin only).

1. **Invite a member.** In *Team & access*, invite `agent@test.com` with role **Agent** and
   `viewer@test.com` with role **Viewer**. They appear in the list as "Invited — pending first sign-in".
2. **Field-hiding on the wire (the important one).** With a customer that has banking/PII on an
   invoice, compare API payloads by role:
   - As **owner**, in the browser devtools/Network (or `curl` with your session cookie) hit
     `GET /api/customers` and `GET /api/invoices` — you see `contactPhone`, `email`, `abn`,
     `bankName`, `bsb`, `accountNumber`, etc.
   - Sign in as `agent@test.com` (new browser/incognito, console-link mock) and hit the same
     endpoints — those keys are **absent** from the JSON (deleted server-side, not just hidden in UI).
     `viewer@test.com` behaves the same.
3. **Role enforcement (403/401).**
   - As `viewer@test.com`, `PUT /api/settings` or `POST /api/customers` → **403**.
   - As `agent@test.com`, `POST /api/customers` → **200**, but `GET /api/members` → **403** (admin+).
   - Signed out, any `/api/*` → **401**.
4. **Manage roles.** Back as owner, change a member's role in the dropdown (toast confirms) and
   remove one (trash icon). `GET /api/members` reflects the change.

> Quick check without a second browser: `GET /api/me` returns your `role` + `canSeeSensitive`.

---

## 3G — Per-tenant credentials + caller-id

**Where:** Settings → *Outbound credentials & caller-id* card (**owner only**).

1. **Save a caller-id + keys.** Enter a caller-id number (e.g. `+61 2 5943 7289`) and paste dummy
   values into the key fields, Save. Reload — the number persists and each key shows
   `Set (••••1234)`; untouched fields show *Using server default* (env fallback) or *Not set*.
2. **Secrets never leave the server.** `GET /api/credentials` returns only masked values +
   booleans — never the raw keys. `curl` it with your cookie to confirm.
3. **Encryption at rest (optional).** Without `CREDENTIALS_SECRET` in `.env`, the card shows an
   amber "stored unencrypted (dev only)" note and values are stored `plain:`-prefixed. Set
   `CREDENTIALS_SECRET=<any-long-string>`, restart, re-save — values are now AES-256-GCM
   (`enc:v1:…`) in the `tenant.credentials` column (inspect via Supabase/psql to confirm).
4. **Used at dispatch (fallback logic).** With **no** `.env` outbound keys and **no** tenant keys,
   a dispatch attempt (New Call → dispatch, or a scheduler tick) returns a clear
   `missing config: …` error listing what's absent — proving `resolveDispatchConfig` gates dispatch.
   Fill either the tenant fields **or** `.env` and the message clears. (A real dial-out still needs
   real Vapi/Twilio credentials.)

---

## 3F — Payments consolidation

**Where:** *Payments* tab (sidebar) + Customer detail → *Payments* sub-tab.

1. **Record a payment.** You need at least one open invoice (Invoices → add one, or use an existing
   queued invoice). On *Payments*, click **Record payment**, pick the invoice, enter an amount, Save.
2. **Ledger + summary update.** The entry appears in the ledger tagged with its method; the
   **Received** and **Outstanding** tiles change. `GET /api/payments` shows the merged ledger + summary.
3. **Invoice auto-resolve.** Record a payment ≥ the invoice's amount due — the invoice flips to
   `resolved` (check Queue / Customer → Invoices). Partial payments increment `paidAmount` without resolving.
4. **Per-customer view.** Open the customer (Customers → a customer → *Payments* sub-tab) — it shows
   only that customer's entries (`GET /api/payments?customerId=<id>`).
5. **IDOR.** `POST /api/payments` with an `invoiceId` belonging to a different owner → **404**.

---

## 3A — Scheduler / cron dispatch

1. **Guarded endpoint.**
   ```bash
   curl -i -X POST http://localhost:3010/api/cron/dispatch            # 401 (no secret)
   curl -i -X POST http://localhost:3010/api/cron/dispatch -H "Authorization: Bearer $CRON_SECRET"
   ```
   The second returns `{ tenants, dispatched, perTenant }`. Add `?force=1` to ignore business hours.
   (`CRON_SECRET` must be set in `.env`.)
2. **Local worker.** `npm run scheduler` ticks every minute across all tenants with due invoices;
   it logs only when it dispatches. See `docs/scheduler-cron.md` for Vercel Cron / cron-job.org wiring.
   Don't run the worker **and** the cron endpoint against the same DB at once.

---

## 3D — Forecasting

**Where:** *Forecast* tab (sidebar).

1. **It renders from live data.** The chart shows outbound **tickets/day** history (last 42 days)
   with a dashed 14-day forecast + confidence band; hover for per-day values. The tiles show
   projected activity, upcoming invoice due (next 14d), and recent collections.
2. **Data sensitivity.** Make a few (mock) calls so `Ticket` rows exist across recent days — the
   history line and forecast fill in. With < 3 days of data the API returns history only (no
   projection) and the chart says so. `GET /api/forecasting` returns the raw series + numbers.
3. **Cash tiles.** Add an open invoice with a due date in the next two weeks → *Upcoming due* tile
   rises. Record a payment (3F) → *Collected* tile rises.

---

## 3B — Deterministic invoice parser (recurring vendors → no Gemini call)

**Where:** Invoices → upload a PDF (uses `/api/calls/parse-document`).

1. **Unit test the templates** (no PDF needed):
   ```bash
   npx tsx scripts/test-invoice-templates.ts     # expect 5/5 passed
   ```
   Covers Spiced Tea Chai, Quest Software, Altus Financial, Green Design, Vertel — asserting
   invoice number, dates, total, ABN, BSB/account, and line-item counts.
2. **Run the real PDFs through the exact route pipeline** (pdf-parse → template match):
   ```bash
   npx tsx scripts/parse-invoice-pdf.ts "path/to/Invoice INV-22050 SPICED TEA.pdf"
   # multiple at once, and --text to also dump the extracted text:
   npx tsx scripts/parse-invoice-pdf.ts --text "path/to/one.pdf"
   ```
   Each known vendor prints `→ template: <id> (valid=true)` and the normalised fields. An
   **unknown** vendor prints `→ no template matched (would fall back to Gemini)`.
3. **End-to-end via the UI:** upload one of these PDFs on the Invoices screen — the brief
   pre-fills from the deterministic path (server log: `[parse-document] template hit: <id>`),
   **no Gemini call and no `GEMINI_API_KEY` required**. Upload an unrecognised vendor's PDF and,
   if `GEMINI_API_KEY` is set, it falls back to Gemini; if not, you get a clear 422 asking you to
   enter details manually or add a template.

## 3E — Analytics (inbound/outbound segmentation)

**Where:** *Analytics* tab (sidebar).

1. Make a few outbound calls so tickets exist. The page shows channel mix (donut), outbound status
   mix, resolution rate, and per-day small-multiple bars (one per channel). `GET /api/analytics`
   returns the raw segmented numbers.
2. Segmentation is by the ticket `tags` jsonb (`outbound`/`inbound`). Everything here is outbound
   today; the **Inbound** series stays at zero with an explanatory note until EnvoyIn's inbound
   tickets share the workspace after the merge — that's expected, not a bug.

## Regression / build

```bash
npm run build          # prisma generate + next build — must be clean
npx tsc --noEmit       # type-only check
```

## Still needs real third-party creds (not locally mockable)

Real Vapi dial-out, real Resend email delivery, Google OAuth sign-in, and a genuine >1-tenant
dispatch with distinct per-tenant Vapi/Twilio accounts. The code paths are in place and gated;
they just need live keys to exercise end-to-end.
