import { requirePageAccess } from '@/lib/page-guard';
import { canManageSettings } from '@/lib/permissions';

// Settings holds workspace-wide scheduler config, the team roster, and (owner-only)
// outbound credentials — admin and above. The credentials card gates itself further.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess(canManageSettings);
  return <>{children}</>;
}
