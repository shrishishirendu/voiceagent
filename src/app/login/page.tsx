'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, getProviders } from 'next-auth/react';
import { Button } from '@/components/shared/Button';
import { EnvoyLogo } from '@/components/shared/Logo';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The dev-login provider only exists server-side when !VERCEL && ALLOW_DEV_LOGIN=1
  // (see auth.config.ts). Reading the actual registered providers means this UI can never
  // show up where it isn't really enabled — including the real hosted app.
  const [devLoginAvailable, setDevLoginAvailable] = useState(false);
  const [devEmail, setDevEmail] = useState('');
  const [devSigningIn, setDevSigningIn] = useState(false);
  useEffect(() => {
    getProviders().then((p) => setDevLoginAvailable(!!p?.['dev-login'])).catch(() => {});
  }, []);

  async function handleDevLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!devEmail.trim()) return;
    setDevSigningIn(true);
    setError(null);
    try {
      const res = await signIn('dev-login', { email: devEmail.trim().toLowerCase(), callbackUrl: '/app', redirect: false });
      if (res?.error) throw new Error('Could not sign in with that email.');
      router.push('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dev sign-in failed.');
      setDevSigningIn(false);
    }
  }

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

        {devLoginAvailable && (
          <>
            <div className="flex items-center gap-3 my-4">
              <span className="h-px flex-1 bg-neutral-200" />
              <span className="text-[10px] uppercase tracking-widest text-neutral-400">dev only</span>
              <span className="h-px flex-1 bg-neutral-200" />
            </div>
            <form onSubmit={handleDevLogin} className="space-y-2">
              <input
                type="email"
                required
                className="input"
                placeholder="dev@local.test"
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
              />
              <Button type="submit" variant="secondary" className="w-full justify-center" loading={devSigningIn}>
                Sign in as this email (dev)
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
