'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Card } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { CallStatusBadge } from '@/components/shared/Badge';
import { CallListSkeleton } from '@/components/shared/Skeleton';
import { CallDetailDrawer } from '@/components/shared/CallDetailDrawer';
import { IconPhone, IconUpload, IconRefresh } from '@/components/shared/Icons';
import { fmtWhen, fmtAmount } from '@/lib/format';
import type { Call } from '@/lib/client-types';
import { useAddToast } from '@/components/shared/Toast';

// Statuses that belong on the home call list — dispatch/webhook failures that never got this
// far (e.g. "dispatching" that errored before a row settled) are filtered out, mirroring
// demo2.0's Home() (src/app/page.tsx line 363).
const VISIBLE_STATUSES = new Set(['ringing', 'in-progress', 'completed', 'failed']);

function MetricTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="metric-card rounded-2xl border border-slate-100 bg-white overflow-hidden">
      <div className="h-[3px] w-full" style={{ background: color }} />
      <div className="px-4 py-3.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{label}</p>
        <p className="text-3xl font-bold tabular-nums text-slate-900">{value}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<CallListSkeleton />}>
      <DashboardPageInner />
    </Suspense>
  );
}

function DashboardPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const addToast = useAddToast();

  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const selectedCallId = searchParams.get('call');

  const fetchCalls = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      else setRefreshing(true);
      fetch('/api/calls', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => setCalls(Array.isArray(d.calls) ? d.calls : []))
        .catch(() => addToast('Failed to load calls', 'error'))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [addToast]
  );

  useEffect(() => {
    fetchCalls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCall(id: string) {
    router.push(`${pathname}?call=${id}`, { scroll: false });
  }

  function closeCall() {
    router.replace(pathname, { scroll: false });
  }

  const visibleCalls = calls.filter((c) => VISIBLE_STATUSES.has(c.status));
  const resolved = visibleCalls.filter((c) => c.outcome === 'success').length;
  const failed = visibleCalls.filter((c) => c.outcome === 'failed').length;
  const noAnswer = visibleCalls.filter((c) => c.outcome === 'no-answer').length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
            <p className="text-sm text-slate-400 mt-1">
              {visibleCalls.length === 0
                ? 'Place your first call to get started.'
                : `${visibleCalls.length} ${visibleCalls.length === 1 ? 'call' : 'calls'} so far.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon={<IconRefresh className="w-4 h-4" />} loading={refreshing} onClick={() => fetchCalls({ silent: true })}>
              Refresh
            </Button>
            <Button variant="secondary" icon={<IconUpload className="w-4 h-4" />} onClick={() => router.push('/app/invoices/select')}>
              Select invoice
            </Button>
            <Button variant="primary" icon={<IconPhone className="w-4 h-4" />} onClick={() => router.push('/app/calls/new')}>
              New call
            </Button>
          </div>
        </div>

        {/* Metrics strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricTile label="Total calls" value={visibleCalls.length} color="#E31E24" />
          <MetricTile label="Resolved" value={resolved} color="#10b981" />
          <MetricTile label="Failed" value={failed} color="#ef4444" />
          <MetricTile label="No Answer" value={noAnswer} color="#cbd5e1" />
        </div>

        {/* Call history */}
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Call history</h2>

          {loading && <CallListSkeleton />}

          {!loading && visibleCalls.length === 0 && (
            <div className="py-16 text-center">
              <p className="font-display text-lg font-semibold text-slate-400 mb-2">Nothing here yet.</p>
              <p className="text-sm text-slate-400">Place a call or select an invoice to get started.</p>
            </div>
          )}

          {!loading && visibleCalls.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {visibleCalls.map((call) => {
                const isInvoiceCall = !!call.invoiceNumber;
                const amountLabel = fmtAmount(call.currency, call.amountDue);
                const invoiceCount = call.invoices?.length ?? 0;
                const subtitle = isInvoiceCall
                  ? [amountLabel || (call.invoiceNumber ? `Invoice #${call.invoiceNumber}` : null), invoiceCount > 1 ? `${invoiceCount} invoices` : null]
                      .filter(Boolean)
                      .join(' · ')
                  : '';

                return (
                  <Card key={call.id} hoverLift className="cursor-pointer" onClick={() => openCall(call.id)}>
                    <div className="px-4 pt-3.5 pb-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{call.contactBusiness}</p>
                        <p className="font-mono text-xs text-slate-400 mt-0.5">{call.toNumber}</p>
                      </div>
                      <CallStatusBadge status={call.status} outcome={call.outcome} />
                    </div>
                    <div className="px-4 pb-3.5 flex items-center justify-between gap-2 text-xs text-slate-400">
                      <span>{fmtWhen(call.createdAt)}</span>
                      {subtitle && <span className="truncate">{subtitle}</span>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <CallDetailDrawer callId={selectedCallId} onClose={closeCall} />
    </div>
  );
}
