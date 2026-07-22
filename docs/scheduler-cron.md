# Outbound scheduler — dispatch wiring

The scheduler groups each tenant's pending, due invoices by debtor and places one aggregated
outbound call per debtor, within that tenant's business hours and free call slots. There are
two ways to drive it — pick one per environment.

## 1. Local dev — the always-on worker

```bash
npm run scheduler          # runs scripts/scheduler.ts (tsx + node-cron)
# or run the web app + worker together:
npm run dev:all
```

It ticks every minute (override with `SCHEDULER_CRON`), calling `runAllTenantsTick()` — the
same multi-tenant entrypoint the HTTP endpoint uses. It stays quiet on idle ticks. Requires a
running Postgres/Supabase (`DATABASE_URL`/`DIRECT_URL`) and, for real dial-out, the outbound
credentials (`VAPI_PRIVATE_KEY`, `TWILIO_*`, `ANTHROPIC_API_KEY`, `PUBLIC_URL`) — or per-tenant
credentials set in **Settings → Outbound credentials**.

## 2. Serverless / hosted — external scheduler → `POST /api/cron/dispatch`

A serverless host can't run an always-on worker, so an external scheduler pokes an endpoint
instead. The route is in middleware's `PUBLIC_ROUTES` (no session) and is guarded by a shared
secret in the `Authorization` header — set `CRON_SECRET` in the environment.

**Vercel Cron** — `vercel.json` (already in the repo) schedules it every minute. Set `CRON_SECRET`
in the Vercel project; Vercel Cron includes it automatically when configured.

```json
{ "crons": [{ "path": "/api/cron/dispatch", "schedule": "* * * * *" }] }
```

**cron-job.org / any external cron** — schedule a `POST` with the bearer header:

```bash
curl -X POST https://<your-host>/api/cron/dispatch \
  -H "Authorization: Bearer $CRON_SECRET"
```

- Wrong/missing secret → `401`.
- `?force=1` ignores business hours (useful for a manual test dispatch).
- Response: `{ tenants, dispatched, perTenant }`.

Only one driver should be active at a time — don't run the always-on worker *and* an external
cron against the same database, or a debtor could be dialed twice in one window.
