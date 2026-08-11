'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/shared/Button';
import { AuthShell, AuthError } from '@/components/auth/AuthShell';

// Sign-in for people who ALREADY have an account — an owner who signed up, or an employee
// who has redeemed their invite. It deliberately cannot create anything: creating a
// company is /signup, and creating an employee account is the invite link. That
// separation is the whole point (previously one page did all three implicitly).

// Reasons another page may have bounced someone here, so the redirect isn't silent.
const NOTICES: Record<string, string> = {
  password_set: 'Password updated. Sign in with your new password.',
  invite_accepted: 'Your account is ready. Sign in to continue.',
  signed_out: 'You have been signed out.',
};

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const notice = NOTICES[params.get('notice') ?? ''] ?? null;
  // Preserve where middleware was sending them before it bounced them to /login.
  const callbackUrl = params.get('callbackUrl') || '/app/dashboard';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await signIn('password', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      // One message for every failure mode. The server can't tell us more without
      // becoming an oracle for which addresses have accounts.
      if (!res || res.error) {
        setError('Incorrect email or password.');
        setBusy(false);
        return;
      }
      // Hard navigation, not router.push: the /app layout gate is a server component that
      // reads the session, and the client router cache would otherwise serve the
      // pre-login result.
      window.location.assign(callbackUrl);
    } catch {
      setError('Something went wrong signing in. Try again.');
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Log in to Envoy"
      subtitle="Outbound collections, on autopilot."
      footer={
        <>
          Setting up a new company?{' '}
          <Link href="/signup" className="text-[var(--brand,#E31E24)] font-medium hover:underline">
            Create a company account
          </Link>
        </>
      }
    >
      {notice && (
        <p className="text-sm text-center text-emerald-600 mb-4" role="status">
          {notice}
        </p>
      )}

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

        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="password">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs text-neutral-500 hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <AuthError>{error}</AuthError>

        <Button type="submit" className="w-full justify-center" loading={busy}>
          Log in
        </Button>
      </form>

      <p className="text-xs text-neutral-400 text-center mt-5">
        Employees: use the &ldquo;Set your password&rdquo; link your administrator emailed you. You
        don&rsquo;t need to create a company account.
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
