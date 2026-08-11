import { requirePageAccess } from '@/lib/page-guard';
import { canViewPayments } from '@/lib/permissions';

// The ledger is readable from agent up — an agent needs to know an invoice is already
// settled before chasing it. Recording a payment is admin+, gated inside the page and
// enforced by POST /api/payments.
export default async function PaymentsLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess(canViewPayments);
  return <>{children}</>;
}
