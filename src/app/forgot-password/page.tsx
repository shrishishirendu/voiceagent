'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/shared/Button';
import { AuthShell, AuthError } from '@/components/auth/AuthShell';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      // The endpoint answers identically whether or not the account exists, so the UI
      // must too — anything conditional here would undo that.
      if (!res.ok) throw new Error();
      setSent(true);
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle={sent ? undefined : 'We’ll email you a link to choose a new one.'}
      footer={
        <Link href="/login" className="hover:underline">
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <div className="text-sm text-center text-neutral-500 space-y-3">
          <p className="text-emerald-600">
            If an account exists for <span className="font-medium">{email}</span>, a reset link is
            on its way.
          </p>
          <p>The link expires in 1 hour. Check your spam folder if it doesn&rsquo;t arrive.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label" htmlFor="email">
              Work email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              className="input"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <AuthError>{error}</AuthError>

          <Button type="submit" className="w-full justify-center" loading={busy}>
            Email me a reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
