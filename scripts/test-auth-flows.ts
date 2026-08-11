// End-to-end exercise of the password-auth flows against a running dev server (:3010).
// Drives the real HTTP endpoints and the real NextAuth credentials sign-in, including the
// CSRF + cookie dance, so it catches wiring that a unit test would not.
//
//   npx tsx scripts/auth-state.ts        # inspect state before/after
//   node scripts/test-auth-flows.mjs
//
// Invite/reset links are read from the DB (the token hash can't be reversed, so the script
// re-issues its own where it needs a raw value) — see getRawTokenFor.

const BASE = process.env.BASE_URL || 'http://localhost:3010';

type Jar = Map<string, string>;

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── Cookie-aware fetch ───────────────────────────────────────────────────────
// NextAuth needs the csrf cookie echoed back on sign-in, so each "browser" keeps a jar.
function newJar(): Jar {
  return new Map();
}
function jarHeader(jar: Jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function jfetch(jar: Jar, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { ...((init.headers as Record<string, string>) || {}), cookie: jarHeader(jar) },
  });
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  return res;
}

// Full NextAuth credentials sign-in: fetch csrf, post it back with the credentials.
async function login(jar: Jar, email: string, password: string) {
  const csrfRes = await jfetch(jar, '/api/auth/csrf');
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({ email, password, csrfToken, callbackUrl: `${BASE}/app/dashboard`, json: 'true' });
  // The callback path is the PROVIDER ID, which is 'password' here (see src/auth.ts) —
  // not the generic 'credentials'.
  const res = await jfetch(jar, '/api/auth/callback/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const session = await (await jfetch(jar, '/api/auth/session')).json();
  return { status: res.status, session };
}

const json = (r: Response): Promise<Record<string, unknown> & { [k: string]: never | unknown }> =>
  r.json().catch(() => ({}));

async function main() {
  const stamp = Date.now();
  const owner = `owner${stamp}@example.com`;
  const agent = `agent${stamp}@example.com`;
  const stranger = `stranger${stamp}@example.com`;
  const PW = 'CorrectHorse99';

  console.log(`\nBASE = ${BASE}\n`);

  // ── 1. NextAuth is configured at all (the deployed bug: 500 on every /api/auth/*) ──
  console.log('1. NextAuth configuration');
  const providers = await fetch(`${BASE}/api/auth/providers`);
  check('GET /api/auth/providers is 200 (AUTH_SECRET present)', providers.status === 200, `got ${providers.status}`);
  const provJson = await json(providers);
  check('only the password provider is registered', Object.keys(provJson).join(',') === 'password', Object.keys(provJson).join(','));

  // ── 2. Signup creates a company owner ──
  console.log('\n2. Signup (creates a company)');
  const ownerJar = newJar();
  const signup = await jfetch(ownerJar, '/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Owner', email: owner, password: PW, businessName: `Test Co ${stamp}` }),
  });
  check('POST /api/signup succeeds', signup.status === 200, `got ${signup.status}`);

  const dupe = await jfetch(newJar(), '/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dupe', email: owner, password: PW, businessName: 'Dupe Co' }),
  });
  check('signing up the same email twice is rejected', dupe.status === 409, `got ${dupe.status}`);

  const weak = await jfetch(newJar(), '/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Weak', email: `weak${stamp}@example.com`, password: 'short', businessName: 'Weak Co' }),
  });
  check('a too-short password is rejected', weak.status === 400, `got ${weak.status}`);

  // ── 3. Login ──
  console.log('\n3. Login');
  const badPw = await login(newJar(), owner, 'WrongPassword123');
  check('wrong password does not create a session', !badPw.session?.user, JSON.stringify(badPw.session));

  const unknown = await login(newJar(), `nobody${stamp}@example.com`, PW);
  check('unknown email does not create a session', !unknown.session?.user, JSON.stringify(unknown.session));

  const good = await login(ownerJar, owner, PW);
  check('correct password creates a session', good.session?.user?.id === owner, JSON.stringify(good.session));

  // ── 4. Owner is routed to onboarding, not into the app ──
  console.log('\n4. Onboarding gate');
  const preOnboard = await jfetch(ownerJar, '/app/dashboard');
  check(
    'owner with no tenant is redirected to /onboarding',
    preOnboard.status === 307 && (preOnboard.headers.get('location') || '').includes('/onboarding'),
    `${preOnboard.status} → ${preOnboard.headers.get('location')}`
  );

  const onboard = await jfetch(ownerJar, '/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessName: `Test Co ${stamp}`,
      callMoment: { voice: 'iris', manner: 'warm', objective: 'Chase the overdue invoice.' },
      businessHours: { bhStartHour: 9, bhEndHour: 17, bhDays: '1,2,3,4,5', timezone: 'Australia/Sydney' },
      contacts: [],
    }),
  });
  check('owner can complete onboarding', onboard.status === 200, `got ${onboard.status}`);

  const postOnboard = await jfetch(ownerJar, '/app/dashboard');
  check('owner reaches the app after onboarding', postOnboard.status === 200, `got ${postOnboard.status}`);

  const reOnboard = await jfetch(ownerJar, '/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessName: 'Hijacked Name',
      callMoment: { voice: 'iris', manner: 'warm' },
      businessHours: { bhStartHour: 9, bhEndHour: 17, bhDays: '1', timezone: 'Australia/Sydney' },
      contacts: [],
    }),
  });
  check('onboarding cannot be re-run to overwrite the company', reOnboard.status === 409, `got ${reOnboard.status}`);

  // ── 5. Uninvited stranger is refused (the silent-new-workspace bug) ──
  console.log('\n5. Uninvited user gets NO workspace');
  const strangerJar = newJar();
  // Create the identity the only other way an account can exist — via an invite that we
  // then revoke — so we have a real passworded user attached to nothing.
  const invite1 = await jfetch(ownerJar, '/api/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: stranger, role: 'viewer' }),
  });
  check('owner can invite a member', invite1.status === 200, `got ${invite1.status}`);
  const strangerToken = await getRawTokenFor(stranger);
  await jfetch(strangerJar, '/api/invite/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: stranger, token: strangerToken, password: PW }),
  });
  const members = await json(await jfetch(ownerJar, '/api/members'));
  const strangerMember = (members.members as { id: string; email: string }[])?.find(
    (m) => m.email === stranger
  )!;
  const removed = await jfetch(ownerJar, `/api/members/${strangerMember.id}`, { method: 'DELETE' });
  check('owner can remove a member', removed.status === 200, `got ${removed.status}`);

  const strangerJar2 = newJar();
  const strangerLogin = await login(strangerJar2, stranger, PW);
  check('a removed member can still authenticate', strangerLogin.session?.user?.id === stranger);
  const strangerApp = await jfetch(strangerJar2, '/app/dashboard');
  check(
    'but is sent to /no-workspace, NOT given a new empty workspace',
    strangerApp.status === 307 && (strangerApp.headers.get('location') || '').includes('/no-workspace'),
    `${strangerApp.status} → ${strangerApp.headers.get('location')}`
  );
  const strangerApi = await jfetch(strangerJar2, '/api/customers');
  check('and their API calls are refused', strangerApi.status === 401 || strangerApi.status === 403, `got ${strangerApi.status}`);

  // ── 6. Invite → set password → correct workspace + role ──
  console.log('\n6. Invite flow');
  const inv = await jfetch(ownerJar, '/api/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: agent, role: 'agent' }),
  });
  check('POST /api/members invites an agent', inv.status === 200, `got ${inv.status}`);

  const agentToken = await getRawTokenFor(agent);
  check('an invite token was issued', !!agentToken);

  const peek = await json(await fetch(`${BASE}/api/invite/accept?email=${encodeURIComponent(agent)}&token=${encodeURIComponent(agentToken)}`));
  check('the invite link validates before use', peek.valid === true, JSON.stringify(peek));

  const badToken = await json(await fetch(`${BASE}/api/invite/accept?email=${encodeURIComponent(agent)}&token=not-a-real-token`));
  check('a forged invite token is rejected', badToken.valid === false);

  const agentJar = newJar();
  const accept = await jfetch(agentJar, '/api/invite/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: agent, token: agentToken, password: PW }),
  });
  check('the agent can set a password', accept.status === 200, `got ${accept.status}`);

  const replay = await jfetch(newJar(), '/api/invite/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: agent, token: agentToken, password: 'DifferentPass99' }),
  });
  check('the invite token is single-use', replay.status === 400, `got ${replay.status}`);

  const agentJar2 = newJar();
  const agentLogin = await login(agentJar2, agent, PW);
  check('the agent can log in', agentLogin.session?.user?.id === agent);

  const agentApp = await jfetch(agentJar2, '/app/dashboard');
  check('the agent lands IN the app (no onboarding wizard)', agentApp.status === 200, `got ${agentApp.status}`);

  const me = await json(await jfetch(agentJar2, '/api/me'));
  check('the agent resolves to the OWNER\'s workspace', me.ownerId === owner, JSON.stringify(me));
  check('with the agent role', me.role === 'agent', JSON.stringify(me));

  // ── 7. Role enforcement ──
  console.log('\n7. Role enforcement (server-side, not just hidden UI)');
  const agentTeam = await jfetch(agentJar2, '/api/members');
  check('agent cannot list the team', agentTeam.status === 403, `got ${agentTeam.status}`);

  const agentInvite = await jfetch(agentJar2, '/api/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `x${stamp}@example.com`, role: 'admin' }),
  });
  check('agent cannot invite anyone', agentInvite.status === 403, `got ${agentInvite.status}`);

  const agentCreds = await jfetch(agentJar2, '/api/credentials');
  check('agent cannot read credentials (owner only)', agentCreds.status === 403, `got ${agentCreds.status}`);

  const agentPay = await jfetch(agentJar2, '/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoiceId: '00000000-0000-0000-0000-000000000000', payAmount: 1 }),
  });
  check('agent cannot record a payment (admin+)', agentPay.status === 403, `got ${agentPay.status}`);

  const agentPayRead = await jfetch(agentJar2, '/api/payments');
  check('agent CAN read the payments ledger', agentPayRead.status === 200, `got ${agentPayRead.status}`);

  const agentSettings = await jfetch(agentJar2, '/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bhStartHour: 1 }),
  });
  check('agent cannot change workspace settings', agentSettings.status === 403, `got ${agentSettings.status}`);

  const agentSettingsPage = await jfetch(agentJar2, '/app/settings');
  check(
    'agent typing /app/settings is redirected away',
    agentSettingsPage.status === 307,
    `${agentSettingsPage.status} → ${agentSettingsPage.headers.get('location')}`
  );

  const agentOnboard = await jfetch(agentJar2, '/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessName: 'Employee Hijack',
      callMoment: { voice: 'iris', manner: 'warm' },
      businessHours: { bhStartHour: 9, bhEndHour: 17, bhDays: '1', timezone: 'Australia/Sydney' },
      contacts: [],
    }),
  });
  check(
    'agent cannot overwrite the company via /api/onboarding',
    agentOnboard.status === 403 || agentOnboard.status === 409,
    `got ${agentOnboard.status}`
  );

  // ── 8. Password reset ──
  console.log('\n8. Password reset');
  const forgotUnknown = await fetch(`${BASE}/api/password/forgot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `ghost${stamp}@example.com` }),
  });
  const forgotKnown = await fetch(`${BASE}/api/password/forgot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: agent }),
  });
  const [u, k] = [await json(forgotUnknown), await json(forgotKnown)];
  check(
    'forgot-password answers identically for known and unknown emails',
    forgotUnknown.status === forgotKnown.status && JSON.stringify(u) === JSON.stringify(k),
    `${forgotUnknown.status}/${forgotKnown.status}`
  );

  const resetToken = await getRawTokenFor(agent, 'reset');
  const NEWPW = 'BrandNewPass77';
  const reset = await fetch(`${BASE}/api/password/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: agent, token: resetToken, password: NEWPW }),
  });
  check('the reset link sets a new password', reset.status === 200, `got ${reset.status}`);

  const oldPwLogin = await login(newJar(), agent, PW);
  check('the OLD password no longer works', !oldPwLogin.session?.user);
  const newPwLogin = await login(newJar(), agent, NEWPW);
  check('the NEW password works', newPwLogin.session?.user?.id === agent);

  // ── 9. Signed-out access ──
  console.log('\n9. Signed-out access');
  const anonApp = await fetch(`${BASE}/app/dashboard`, { redirect: 'manual' });
  check(
    'signed-out /app redirects to /login',
    anonApp.status === 307 && (anonApp.headers.get('location') || '').includes('/login'),
    `${anonApp.status} → ${anonApp.headers.get('location')}`
  );
  const anonApi = await fetch(`${BASE}/api/customers`);
  check('signed-out API is 401', anonApi.status === 401, `got ${anonApi.status}`);
  for (const p of ['/login', '/signup', '/forgot-password']) {
    const r = await fetch(`${BASE}${p}`);
    check(`${p} is publicly reachable`, r.status === 200, `got ${r.status}`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

// Tokens are stored hashed, so the raw value can't be recovered from the DB. Re-issue one
// through the same code path the app uses and hand back the raw value.
async function getRawTokenFor(email: string, purpose: 'invite' | 'reset' = 'invite') {
  const { issueToken } = await import('../src/lib/auth-tokens');
  return issueToken(purpose, email);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
