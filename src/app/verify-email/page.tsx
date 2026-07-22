'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/shared/Button';
import { EnvoyLogo } from '@/components/shared/Logo';

// Inert confirmation page. The magic-link email points HERE (not at the raw NextAuth
// callback), so corporate email scanners that auto-fetch links can't burn the
// single-use token — sign-in only completes when a human clicks the button, which
// navigates to the real callback URL passed in `?next=`. Mirrors EnvoyIn's
// /verify-email + the Safe-Links note in its CLAUDE.md.
function VerifyInner() {
  const params = useSearchParams();
  const next = params.get('next');

  return (
    <main className="app-bg min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8 text-center">
        <div className="flex justify-center mb-6">
          <EnvoyLogo />
        </div>
        <h1 className="text-lg font-semibold mb-1">Confirm sign-in</h1>
        <p className="text-sm text-neutral-500 mb-6">Click below to finish signing in to Envoy.</p>
        {next ? (
          <a href={next}>
            <Button className="w-full justify-center">Confirm sign-in</Button>
          </a>
        ) : (
          <p className="text-sm text-[var(--brand,#E31E24)]">This link is invalid or has expired.</p>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}
