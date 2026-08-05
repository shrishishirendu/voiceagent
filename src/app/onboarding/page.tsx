import { redirect } from 'next/navigation';
import { resolveAccessResult } from '@/lib/access';
import { hasTenant } from '@/lib/tenant';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

// Company setup, for new OWNERS only (routed here from the app-layout gate).
// Already-configured owners bounce back to the app; someone with no workspace at all is
// an uninvited employee, not a new owner, so they get the explanation page instead of a
// wizard that would create a company they didn't ask for.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { company?: string };
}) {
  const { access, denial } = await resolveAccessResult();
  if (!access) redirect(denial === 'no-workspace' ? '/no-workspace' : '/login');
  if (await hasTenant(access.ownerId)) redirect('/app/dashboard');
  // Prefilled from the company name typed at signup so it isn't asked for twice.
  return <OnboardingWizard initialBusinessName={searchParams.company ?? ''} />;
}
