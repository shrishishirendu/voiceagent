'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/shared/Button';
import { AuthShell, AuthError } from '@/components/auth/AuthShell';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-rules';

// Where an invited employee lands from their email. This is the ONLY way an employee
// account gets a password — they never sign up, and they never create a company.
//
// The link is inert on GET (it renders this form; it doesn't complete anything), so the
// link-scanning that email security gateways do can't consume the invite before the
// recipient clicks.

type Peek = { valid: boolean; businessName?: string | null; role?: string };

function AcceptForm() {
  const params = useSearchParams();
  const email = (params.get('email') ?? '').toLowerCase();
  const token = params.get('token') ?? '';

  const [peek, setPeek] = useState<Peek | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Check the link before asking for a password, so a dead link says so up front rather
  // than after they've typed one twice.
  useEffect(() => {
    if (!email || !token) {
      setPeek({ valid: false });
      return;
    }
    fetch(`/api/invite/accept?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then(setPeek)
      .catch(() => setPeek({ valid: false }));
  }, [email, token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not set your password.');
        setBusy(false);
        return;
      }

      const signInRes = await signIn('password', { email, password, redirect: false });
      if (!signInRes || signInRes.error) {
        window.location.assign('/login?notice=invite_accepted');
        return;
      }
      // Straight into the app — an invited member belongs to an existing workspace and
      // must never see the company-onboarding wizard.
      window.location.assign('/app/dashboard');
    } catch {
      setError('Something went wrong. Try again.');
      setBusy(false);
    }
  }

  if (peek === null) {
    return <AuthShell title="Checking your invite…">{null}</AuthShell>;
  }

  if (!peek.valid) {
    return (
      <AuthShell
        title="This invite link isn't valid"
        subtitle="It may have expired, already been used, or been revoked."
      >
        <p className="text-sm text-neutral-500 text-center">
          Ask an administrator at your company to send you a new invite.
        </p>
        <div className="mt-5">
          <Link href="/login">
            <Button variant="secondary" className="w-full justify-center">
              Go to log in
            </Button>
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set your password"
      subtitle={
        <>
          You&rsquo;ve been invited to{' '}
          <span className="font-medium text-neutral-700 dark:text-neutral-200">
            {peek.businessName || 'your company'}
          </span>
          {peek.role ? ` as ${peek.role}` : ''}.
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="email">
            Your email
          </label>
          {/* Fixed to the invited address — changing it would just make the token fail. */}
          <input id="email" className="input" value={email} readOnly disabled />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Choose a password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-neutral-400 mt-1">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>

        <div>
          <label className="label" htmlFor="confirm">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            required
            autoComplete="new-password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <AuthError>{error}</AuthError>

        <Button type="submit" className="w-full justify-center" loading={busy}>
          Set password and continue
        </Button>
      </form>
    </AuthShell>
  );
}

export default function InviteAcceptPage() {
  return (
    <Suspense>
      <AcceptForm />
    </Suspense>
  );
}
