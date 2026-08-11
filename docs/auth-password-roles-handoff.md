# Auth rework: login/signup split + password auth + roles — handoff

**Status:** feature-complete and passing tests, **committed and pushed, not deployed.**
**Branch:** `feature/auth-password-roles`, cut from `origin/main` @ `1f84718`. Everything below was
committed in `937cf85` on 2026-08-05.
**Date paused:** 2026-08-05
**Date committed:** 2026-08-05 (`937cf85`)

---

## Why this work exists

Two problems on https://voiceagent-iota-silk.vercel.app/:

1. **Login was completely broken.** Every `/api/auth/*` endpoint returned HTTP 500
   `"There was a problem with the server configuration"` — including `/api/auth/csrf`, which touches no
   provider. That is an Auth.js v5 config-level failure from a **missing `AUTH_SECRET`** on Vercel. Both
   Google and magic-link failed before they started. **This is an env-var fix, not a code fix, and it is
   still outstanding** (see "What's left", item 1).

2. **No real distinction between signing up and logging in.** One `/login` page did both implicitly, and
   `src/lib/access.ts` ended with a "new-owner fallback": *any* authenticated email with no tenant and no
   membership silently became the owner of a brand-new empty workspace. An employee who was never invited
   — or who typo'd their address — would land in their own private empty app with no indication anything
   was wrong. That fallback was the actual bug behind the second complaint.

## Decisions taken (from the user, don't re-litigate)

- **Email + password only.** Google and magic-link removed entirely.
- **Open self-serve signup** — anyone can create a company at `/signup` and become its owner.
- **Roles unchanged:** `owner` / `admin` / `agent` / `viewer`.
- **Invited employees get an emailed "set your password" link.** This makes Resend a hard dependency.
- **Existing DB data was throwaway** — test tenants were deleted rather than migrated.

---

## What was built

### Core auth
- `src/auth.config.ts` — now **edge-safe with `providers: []`**. Middleware builds its own NextAuth
  instance from this file, and the Edge runtime cannot load Prisma or bcrypt. The real provider lives in
  `auth.ts`. Middleware only decodes the session JWT, which is provider-independent, so this costs nothing.
- `src/auth.ts` — single `Credentials` provider, **id `password`** (note: the NextAuth callback path is
  therefore `/api/auth/callback/password`, not `.../credentials`). **No adapter** — adapters persist OAuth
  accounts and sessions, and with credentials + JWT neither exists. User rows are created explicitly by
  `/api/signup` and the invite flow, which is where the company rules have to be enforced anyway.
- Deleted: `src/lib/auth-adapter.ts`, `src/lib/email-provider.ts`, `src/app/verify-email/`.
- `src/middleware.ts` — added `/api/signup`, `/api/invite/accept`, `/api/password/forgot`,
  `/api/password/reset` to `PUBLIC_ROUTES` (all necessarily run signed out; each enforces its own rules).

### Schema (`prisma db push` already applied to Supabase)
- `User.passwordHash` (nullable — **null means "invited but hasn't accepted"**), `User.isOwner`,
  `User.createdAt`.
- **`Account` model dropped** (no OAuth).
- `VerificationToken` repurposed for invite + reset tokens. `identifier` is `"<purpose>:<email>"`;
  `token` stores a **SHA-256 hash** of the emailed secret, never the secret. A leaked DB row can't be
  replayed.

### New libraries
| File | Purpose |
|---|---|
| `src/lib/passwords.ts` | bcryptjs hash/verify. **Server only.** Compares against a dummy hash when `passwordHash` is null so "invited" isn't distinguishable by timing from "wrong password". |
| `src/lib/password-rules.ts` | `MIN_PASSWORD_LENGTH` + `passwordProblem`, **no crypto import** — client forms import this so bcryptjs never enters the browser bundle. |
| `src/lib/auth-tokens.ts` | `issueToken` / `peekToken` / `consumeToken` / `revokeTokens` / `tokenLink`. Single-use, hashed, expiring (invite 7d, reset 1h). Re-issuing invalidates the previous link. |
| `src/lib/invites.ts` | `ensureInvitedUser` / `sendInvite` / `revokeInvite`. Kept separate from `members.ts` so the roster stays a pure data module — `mutateMembers` runs in a transaction, and emailing from inside one risks announcing a change that then rolls back. |
| `src/lib/permissions.ts` | **The role matrix, single source of truth.** No server-only imports, so the client sidebar and the API routes are gated by the same definitions. |
| `src/lib/page-guard.ts` | `requirePageAccess(can)` for a server `layout.tsx` beside a client page. |

### Access control (`src/lib/access.ts`)
- **New-owner fallback removed.** `resolveAccessResult()` now returns a typed `AccessDenial`
  (`'unauthenticated' | 'no-workspace'`). Rules: has tenant → owner; on a member list → that role;
  `User.isOwner` but no tenant → owner mid-signup, route to onboarding; **otherwise no access.**
- `resolveAccess()` kept as a thin wrapper so existing call sites are untouched.
- Added `requireCapability(access, can, msg)`. Takes a **non-null** `Access` so callers do their own
  `if (!access) return unauthorized()` first — that preserves TypeScript narrowing.
- `Role` moved to `permissions.ts`, re-exported here for compatibility.

### APIs
New: `/api/signup`, `/api/invite/accept` (GET peek + POST redeem), `/api/password/forgot`,
`/api/password/reset` (GET peek + POST), `/api/members/[id]/resend`.

Modified:
- `/api/members` POST — now also creates the User row, issues a token, and emails the invite. Returns
  `emailSent: false` + a warning rather than silently leaving someone with no way in.
- `/api/members/[id]` DELETE — revokes the outstanding invite and deletes the placeholder account;
  PATCH busts the access cache so a role change lands immediately.
- **`/api/onboarding` — closed a real security hole.** It had *no* role check, and `access.ownerId`
  resolves to the **owner's** tenant for members too, so any agent could POST and overwrite their
  employer's business identity, hours and call defaults. Now owner-only and once-only.
- `/api/payments` — GET is `agent+` (an agent must know a debt is settled before chasing it),
  POST is `admin+`.

### Pages
- `/login` rewritten — password only, generic "Incorrect email or password" (no account-existence oracle),
  links to signup + forgot-password, and tells employees to use their invite link.
- New: `/signup`, `/invite/accept`, `/forgot-password`, `/reset-password`, `/no-workspace`.
- `src/components/auth/AuthShell.tsx` + `SignOutButton.tsx` — shared frame so the five screens can't drift.
- Landing page: single "Launch Envoy" CTA replaced with **Log in** / **Get started**.
- `app/app/layout.tsx` — three-way gate (no-workspace / onboarding / render), passes `role` + `email`
  into the sidebar.
- New role guards as server layouts: `payments`, `queue`, `invoices`, `settings`, `calls/new`.
- `AppShellChrome` — nav filtered by role, plus a signed-in identity + role block in the footer.
- **Bug fixed:** `EnvoyLogo` is itself a `<Link>`; `AuthShell` wrapped it in another, producing nested
  `<a>` and a hydration failure on every auth page. `Logo.tsx` gained `href` + `onDark` props.

### Scripts
- `scripts/test-auth-flows.ts` — **44-check E2E suite** against a running dev server. Drives real HTTP +
  the real NextAuth CSRF/cookie dance. Run with `npx tsx scripts/test-auth-flows.ts`.
- `scripts/auth-state.ts` — prints who can sign in, which workspace they resolve to, outstanding tokens.
- `scripts/set-owner-password.ts` — backfill/lockout escape hatch for an **existing** owner.

---

## Verified

- `npx tsc --noEmit` clean; `npm run build` clean (all routes).
- **44/44 E2E checks pass**, including the two headline behaviours: an uninvited user gets
  `/no-workspace` instead of a silent new workspace, and an invited agent lands in the **owner's**
  workspace with the agent role and never sees the onboarding wizard.
- Resend key confirmed working — a real test email was delivered to `shreyank.sinha@isoftanz.com.au`.
- Test accounts created during the run were cleaned up afterwards.

> ⚠️ The E2E suite has **not been re-run** since the `Logo.tsx` / `AuthShell.tsx` hydration fix.
> `tsc` passes, but re-run it first thing.

---

## What's left

1. **Set the Vercel env vars — this is the actual production fix.** Nothing above helps the deployed site
   until this is done. Production, Preview and Development:
   - `AUTH_SECRET` = `wbfS7VbkCxf2dA4vrR5gqt/FHUpG0ZAJW6JbGualWSo=` (generated for this work)
   - `PUBLIC_BASE_URL` = `https://voiceagent-iota-silk.vercel.app`
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
   - Confirm `DATABASE_URL` / `DIRECT_URL` are present. **Delete `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`** — unused now.
   - Do **not** set `NEXTAUTH_URL`; v5 with `trustHost: true` ignores it.

2. **Verify a Resend domain.** The shared `onboarding@resend.dev` sender only delivers to your own Resend
   account address — confirmed by test: sending to `@example.com` fails with *"Invalid `to` field"*.
   **Real employee invites will silently fail until a domain is verified.**

3. **Finish browser QA.** It was interrupted after finding the nested-anchor bug. Re-check all five auth
   screens render correctly and are console-clean. Dev server is currently stopped
   (`npm run dev`, port 3010). Note the Windows quirk: run `npm run build` with the dev server **stopped**
   (Prisma engine DLL lock → `EPERM`).

4. **Two known UI gaps in the payments role gating.** The API correctly rejects these with 403, but the
   UI doesn't hide them, so an agent sees a button that fails:
   - `src/app/app/payments/page.tsx:64` — "Record payment" button
   - `src/app/app/customers/[id]/page.tsx:258` — "Mark paid" action

   Also unverified: the customer-detail **Payments sub-tab** does `GET /api/payments?customerId=`, which
   is now `agent+`, so a **viewer** opening that tab will 403. Decide whether to hide the tab or relax the gate.

5. **The existing owner is locked out.** `shreyank.sinha@isoftanz.com.au` owns the "iSoft Collections"
   tenant with real customer/invoice data but has no password (it predates password auth). Fix with:
   ```
   npx tsx scripts/set-owner-password.ts shreyank.sinha@isoftanz.com.au <password>
   ```

6. ~~**Docs + commit.**~~ Done 2026-08-11: code committed as `937cf85`; `README.md` and the `CLAUDE.md`
   changelog updated to match (Google/magic-link/`ALLOW_DEV_LOGIN` references removed, `set-owner-password.ts`
   documented as the local-seeding login step). `.env.example` was already rewritten in the same commit
   (Google + `ALLOW_DEV_LOGIN` removed, Resend marked required).

7. Optional: add an npm script for the E2E suite — there isn't one.

## Gotchas for whoever picks this up

- `auth.config.ts` must stay free of Prisma/bcrypt/Resend, directly **or transitively** — middleware
  bundles it for the Edge runtime.
- Any new client component that needs the password length must import `lib/password-rules.ts`,
  **never** `lib/passwords.ts`.
- `passwordHash === null` is meaningful state (invited, not yet accepted). Don't "clean it up".
- Sign-in must use a **hard navigation** (`window.location.assign`), not `router.push` — the `/app`
  layout gate is a server component and the client router cache would serve the pre-login result.
