'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/shared/Button';
import { EnvoyLogo } from '@/components/shared/Logo';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await signIn('email', { email: email.trim().toLowerCase(), redirect: false, callbackUrl: '/app' });
      if (res?.error) setError('Could not send the sign-in link. Check the address and try again.');
      else setSent(true);
    } catch {
      setError('Something went wrong sending the link.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="app-bg min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="flex justify-center mb-6">
          <EnvoyLogo />
        </div>
        <h1 className="text-lg font-semibold text-center mb-1">Sign in to Envoy</h1>
        <p className="text-sm text-neutral-500 text-center mb-6">Outbound collections, on autopilot.</p>

        <Button variant="secondary" className="w-full justify-center mb-4" onClick={() => signIn('google', { callbackUrl: '/app' })}>
          Continue with Google
        </Button>

        <div className="flex items-center gap-3 my-4">
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          <span className="text-xs text-neutral-400">or</span>
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
        </div>

        {sent ? (
          <p className="text-sm text-center text-emerald-600">
            Check <span className="font-medium">{email}</span> for a sign-in link.
          </p>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-3">
            <div>
              <label className="label" htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                required
                className="input"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-[var(--brand,#E31E24)]">{error}</p>}
            <Button type="submit" className="w-full justify-center" loading={sending}>
              Email me a sign-in link
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
