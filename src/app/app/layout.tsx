import { redirect } from 'next/navigation';
import { ToastProvider } from '@/components/shared/Toast';
import { BulkIntakeProvider } from '@/components/shared/BulkIntakeContext';
import { AppShellChrome } from './AppShellChrome';
import { resolveAccess } from '@/lib/access';
import { hasTenant } from '@/lib/tenant';

// New-owner gate (page-level, mirroring EnvoyIn's app/app/layout.js): middleware already
// requires a session; here we additionally send owners with no Tenant config row to
// onboarding. Once they finish onboarding (Tenant row exists), the app renders.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await resolveAccess();
  if (!access) redirect('/login');
  if (!(await hasTenant(access.ownerId))) redirect('/onboarding');

  return (
    <ToastProvider>
      <BulkIntakeProvider>
        <AppShellChrome>{children}</AppShellChrome>
      </BulkIntakeProvider>
    </ToastProvider>
  );
}
