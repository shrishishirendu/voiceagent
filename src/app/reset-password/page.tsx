'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/shared/Button';
import { AuthShell, AuthError } from '@/components/auth/AuthShell';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-rules';

function ResetForm() {
  const params = useSearchParams();
  const email = (params.get('email') ?? '').toLowerCase();
  const token = params.get('token') ?? '';

  const [valid, setValid] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!email || !token) {
      setValid(false);
      return;
    }
    fetch(`/api/password/reset?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => setValid(!!d.valid))
      .catch(() => setValid(false));
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
      const res = await fetch('/api/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not reset your password.');
        setBusy(false);
        return;
      }
      // Deliberately not auto-signed-in: proving the new password works at the login
      // screen is the clearest confirmation the reset actually took.
      window.location.assign('/login?notice=password_set');
    } catch {
      setError('Something went wrong. Try again.');
      setBusy(false);
    }
  }

  if (valid === null) return <AuthShell title="Checking your link…">{null}</AuthShell>;

  if (!valid) {
    return (
      <AuthShell
        title="This reset link isn't valid"
        subtitle="It may have expired, or already been used."
      >
        <Link href="/forgot-password">
          <Button variant="secondary" className="w-full justify-center">
            Request a new link
          </Button>
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle={email}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="password">
            New password
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
            Confirm new password
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
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
