import { redirect } from 'next/navigation';
import { ToastProvider } from '@/components/shared/Toast';
import { BulkIntakeProvider } from '@/components/shared/BulkIntakeContext';
import { AppShellChrome } from './AppShellChrome';
import { resolveAccessResult } from '@/lib/access';
import { hasTenant } from '@/lib/tenant';

// The gate for everything under /app. Middleware has already established there IS a
// session; this decides what that session is entitled to see. Three distinct outcomes,
// which is the point — they used to collapse into one:
//   - signed in, no company at all      → /no-workspace (an employee who was never invited)
//   - signed in as an owner, no tenant  → /onboarding   (mid-signup, company not set up yet)
//   - otherwise                          → render, with the resolved role driving the chrome
//
// Only an owner ever reaches /onboarding. A member of someone else's workspace inherits
// that workspace's tenant, so hasTenant() is true for them and they go straight in.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { access, denial } = await resolveAccessResult();
  if (!access) redirect(denial === 'no-workspace' ? '/no-workspace' : '/login');
  if (!(await hasTenant(access.ownerId))) redirect('/onboarding');

  return (
    <ToastProvider>
      <BulkIntakeProvider>
        <AppShellChrome role={access.role} email={access.email}>
          {children}
        </AppShellChrome>
      </BulkIntakeProvider>
    </ToastProvider>
  );
}
