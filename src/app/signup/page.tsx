'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/shared/Button';
import { AuthShell, AuthError } from '@/components/auth/AuthShell';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-rules';

// Creating a COMPANY — the one entry point that brings a new workspace into existence.
// Employees never come through here; they arrive via an emailed invite link, which is why
// the copy says so explicitly rather than leaving them to guess.
//
// This page only creates the account. The company itself (business details, hours, call
// defaults) is the existing /onboarding wizard, which the /app layout gate routes into
// immediately after sign-in — the company name typed here just prefills it.

export default function SignupPage() {
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [existsError, setExistsError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setExistsError(false);

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
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          businessName: businessName.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || 'Could not create your account.');
        // Surface a route out rather than a dead end when the address is already known.
        setExistsError(data.code === 'exists' || data.code === 'invited');
        setBusy(false);
        return;
      }

      // The account exists now; sign in with the credentials we already have so they
      // never have to retype them.
      const signInRes = await signIn('password', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      if (!signInRes || signInRes.error) {
        // Account created but sign-in failed — send them to login rather than stranding
        // them on a form that would now report "already exists".
        window.location.assign('/login?notice=password_set');
        return;
      }

      // Hard nav so the server-side onboarding gate re-evaluates with the new session.
      window.location.assign(`/onboarding?company=${encodeURIComponent(businessName.trim())}`);
    } catch {
      setError('Something went wrong creating your account. Try again.');
      setBusy(false);
    }
  }

  return (
    <AuthShell
      wide
      title="Create your company account"
      subtitle="Set up your workspace, then invite your team."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-[var(--brand,#E31E24)] font-medium hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="businessName">
            Company name
          </label>
          <input
            id="businessName"
            required
            className="input"
            placeholder="Acme Pty Ltd"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            required
            autoComplete="name"
            className="input"
            placeholder="Jane Smith"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

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

        <div>
          <label className="label" htmlFor="password">
            Password
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
          <p className="text-xs text-neutral-400 mt-1">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
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

        <AuthError>
          {error}
          {existsError && (
            <>
              {' '}
              <Link href="/login" className="underline font-medium">
                Go to log in
              </Link>
            </>
          )}
        </AuthError>

        <Button type="submit" className="w-full justify-center" loading={busy}>
          Create account
        </Button>
      </form>

      <p className="text-xs text-neutral-400 text-center mt-5">
        Joining a company that already uses Envoy? Ask your administrator to invite you —
        you&rsquo;ll get an email with a link to set your password.
      </p>
    </AuthShell>
  );
}
