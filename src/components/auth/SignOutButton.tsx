'use client';

import { signOut } from 'next-auth/react';
import { Button } from '@/components/shared/Button';

// Client island for signing out of a server-rendered page.
export function SignOutButton({ label = 'Sign out' }: { label?: string }) {
  return (
    <Button
      variant="secondary"
      className="w-full justify-center"
      onClick={() => signOut({ callbackUrl: '/login?notice=signed_out' })}
    >
      {label}
    </Button>
  );
}
