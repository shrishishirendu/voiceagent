import { redirect } from 'next/navigation';
import { resolveAccess } from '@/lib/access';
import { hasTenant } from '@/lib/tenant';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

// New owners land here (routed from the app-layout gate). Already-configured owners are
// bounced back to the app — mirrors EnvoyIn's onboarding page-level check.
export default async function OnboardingPage() {
  const access = await resolveAccess();
  if (!access) redirect('/login');
  if (await hasTenant(access.ownerId)) redirect('/app/dashboard');
  return <OnboardingWizard />;
}
