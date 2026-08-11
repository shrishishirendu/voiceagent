import { requirePageAccess } from '@/lib/page-guard';
import { canEditRecords } from '@/lib/permissions';

// Uploading, parsing and queuing invoices — agent and above. Viewers can still see
// invoice figures through the customer detail screens, but cannot ingest or dispatch.
export default async function InvoicesLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess(canEditRecords);
  return <>{children}</>;
}
