import { requirePageAccess } from '@/lib/page-guard';
import { canDispatch } from '@/lib/permissions';

// Composing and placing a call — agent and above. Viewing a call in progress
// (/app/calls/live/[id]) stays open to everyone, since that's read-only.
export default async function NewCallLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess(canDispatch);
  return <>{children}</>;
}
