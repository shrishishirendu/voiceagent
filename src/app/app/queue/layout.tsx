import { requirePageAccess } from '@/lib/page-guard';
import { canDispatch } from '@/lib/permissions';

// Working the dispatch queue is operational work — agent and above. Viewers get the
// read-only dashboards instead.
export default async function QueueLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess(canDispatch);
  return <>{children}</>;
}
