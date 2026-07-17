'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  QueuedInvoice,
  SchedulerSettings,
  InvoiceParseResult,
  BulkFormState,
} from '@/lib/client-types';
import { fmtAmount, fmtDate } from '@/lib/format';
import { companyNamesMatch } from '@/lib/nameUtils';
import { Button } from '@/components/shared/Button';
import { Card, CardHeader, CardBody } from '@/components/shared/Card';
import { WarningBadge, CallStatusBadge, type CallStatus } from '@/components/shared/Badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Drawer } from '@/components/shared/Drawer';
import { InvoiceListSkeleton } from '@/components/shared/Skeleton';
import { Spinner } from '@/components/shared/Spinner';
import { useAddToast } from '@/components/shared/Toast';
import { IconRefresh, IconEdit, IconTrash } from '@/components/shared/Icons';
import { CallDetailDrawer } from '@/components/shared/CallDetailDrawer';
import { InvoiceComposeForm } from '@/components/shared/InvoiceComposeForm';

interface DebtorGroup {
  key: string;
  business: string;
  items: QueuedInvoice[];
}

// Convert a QueuedInvoice (queue row shape) to the InvoiceParseResult shape InvoiceComposeForm expects.
function queueInvoiceToParseResult(inv: QueuedInvoice): InvoiceParseResult {
  return {
    contactBusiness: inv.contactBusiness,
    contactPerson: inv.contactPerson ?? null,
    toNumber: inv.toNumber ?? null,
    invoiceNumber: inv.invoiceNumber ?? null,
    invoiceDate: inv.invoiceDate ?? null,
    dueDate: inv.dueDate ?? null,
    amountDue: inv.amountDue ?? null,
    currency: inv.currency ?? null,
    lineItems: inv.lineItems ?? null,
    invoiceNotes: inv.invoiceNotes ?? null,
    bankName: inv.bankName ?? null,
    bsb: inv.bsb ?? null,
    accountNumber: inv.accountNumber ?? null,
    swiftCode: inv.swiftCode ?? null,
    abn: inv.abn ?? null,
    remittanceName: inv.remittanceName ?? null,
    remittanceContact: inv.remittanceContact ?? null,
  };
}

// Mirrors demo2.0's handleQueueSave/handleQueueDispatch payload shape for PATCH /api/invoices/[id].
function buildInvoicePatchPayload(state: BulkFormState) {
  return {
    contactBusiness: state.contactBusiness || null,
    contactPerson: state.contactPerson || null,
    toNumber: state.toNumber || null,
    abn: state.abn || null,
    invoiceNumber: state.invoiceNumber || null,
    invoiceDate: state.invoiceDate || null,
    dueDate: state.dueDate || null,
    amountDue: state.amountDue.trim() ? Number(state.amountDue) : null,
    currency: state.currency || null,
    lineItems: state.lineItems || null,
    invoiceNotes: state.invoiceNotes || null,
    bankName: state.bankName || null,
    bsb: state.bsb || null,
    accountNumber: state.accountNumber || null,
    swiftCode: state.swiftCode || null,
    remittanceName: state.remittanceName || null,
    remittanceContact: state.remittanceContact || null,
  };
}

export default function QueuePage() {
  const addToast = useAddToast();

  const [invoices, setInvoices] = useState<QueuedInvoice[]>([]);
  const [queueSettings, setQueueSettings] = useState<SchedulerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [dispatchingKey, setDispatchingKey] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<QueuedInvoice | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [callDrawerId, setCallDrawerId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [invRes, stRes] = await Promise.all([
        fetch('/api/invoices', { cache: 'no-store' }),
        fetch('/api/settings', { cache: 'no-store' }),
      ]);
      if (invRes.ok) setInvoices((await invRes.json()).invoices ?? []);
      if (stRes.ok) setQueueSettings(await stRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    load();
    pollRef.current = setInterval(load, 2000);
  }, [load, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);
  useEffect(() => {
    load();
  }, [load]);

  // Auto-stop polling once all active calls reach a terminal state.
  useEffect(() => {
    const anyActive = invoices.some(
      (i) => (i.call && i.call.status !== 'completed' && i.call.status !== 'failed') || i.status === 'calling'
    );
    if (!anyActive && pollRef.current) stopPolling();
  }, [invoices, stopPolling]);

  // Start polling on mount if a call is already in flight (re-enter mid-call).
  useEffect(() => {
    const anyActive = invoices.some(
      (i) => (i.call && i.call.status !== 'completed' && i.call.status !== 'failed') || i.status === 'calling'
    );
    if (anyActive && !pollRef.current) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/scheduler/tick?force=1', { method: 'POST' });
      const data = await res.json();
      if (data.errors?.length) addToast(data.errors[0], 'error');
      else if (data.dispatched > 0) addToast(`Dispatched ${data.dispatched} call${data.dispatched === 1 ? '' : 's'}.`, 'success');
      else addToast(data.reason ? `No calls dispatched — ${data.reason}.` : 'No calls dispatched.', 'info');
      startPolling();
    } catch {
      addToast('Run failed.', 'error');
    } finally {
      setRunning(false);
    }
  };

  const dispatchGroup = async (groupKey: string) => {
    setDispatchingKey(groupKey);
    try {
      const res = await fetch('/api/invoices/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupKey }),
      });
      const data = await res.json();
      if (data.errors?.length) addToast(data.errors[0], 'error');
      else if (data.reason) addToast(data.reason, 'info');
      else addToast('Call dispatched.', 'success');
      startPolling();
    } catch {
      addToast('Dispatch failed.', 'error');
    } finally {
      setDispatchingKey(null);
    }
  };

  const removeInvoice = async (id: string) => {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      await load();
    } catch (e) {
      console.error(e);
      addToast('Failed to remove invoice.', 'error');
    } finally {
      setRemovingId(null);
      setConfirmRemoveId(null);
    }
  };

  const retryInvoice = async (id: string) => {
    setRetryingId(id);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending', chaseAfter: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error('retry failed');
      addToast('Invoice requeued for retry.', 'success');
      await load();
    } catch (e) {
      console.error(e);
      addToast('Retry failed.', 'error');
    } finally {
      setRetryingId(null);
    }
  };

  const closeEdit = () => setEditingInvoice(null);

  const handleQueueSave = async (state: BulkFormState) => {
    if (!editingInvoice) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/invoices/${editingInvoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildInvoicePatchPayload(state)),
      });
      if (!res.ok) throw new Error('save failed');
      addToast('Invoice updated.', 'success');
      closeEdit();
      await load();
    } catch (e) {
      console.error(e);
      addToast('Failed to save invoice.', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  // Save edits then immediately dispatch this debtor's group (bypasses business-hours gate).
  const handleQueueDispatch = async (state: BulkFormState) => {
    if (!editingInvoice) return;
    setEditSaving(true);
    try {
      const patchRes = await fetch(`/api/invoices/${editingInvoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildInvoicePatchPayload(state)),
      });
      if (!patchRes.ok) throw new Error('save failed');
      // The PATCH may re-derive groupKey (business name/ABN changed) — dispatch the fresh one.
      const updated = await patchRes.json();
      const dispatchRes = await fetch('/api/invoices/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupKey: updated.groupKey ?? editingInvoice.groupKey }),
      });
      const data = await dispatchRes.json();
      if (data.errors?.length) addToast(data.errors[0], 'error');
      else if (data.reason) addToast(data.reason, 'info');
      else addToast('Call dispatched.', 'success');
      closeEdit();
      startPolling();
      await load();
    } catch (e) {
      console.error(e);
      addToast('Dispatch failed.', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  // Active invoices awaiting dispatch; failed-today invoices are shown separately.
  const queueInvoices = invoices.filter((i) => ['pending', 'queued', 'calling'].includes(i.status));
  const failedInvoices = invoices.filter((i) => i.status === 'failed');

  // Group pending/calling invoices by debtor using fuzzy name matching so invoices for the same
  // company with slightly different name variants collapse into one group even if their stored
  // groupKeys differ.
  const groups: DebtorGroup[] = [];
  for (const inv of queueInvoices) {
    const existing = groups.find((g) => companyNamesMatch(g.business, inv.contactBusiness));
    if (existing) existing.items.push(inv);
    else groups.push({ key: inv.groupKey, business: inv.contactBusiness, items: [inv] });
  }

  // Sort groups by the configured call order from settings.
  const sortDir = queueSettings?.sortDir === 'desc' ? -1 : 1;
  groups.sort((a, b) => {
    if (queueSettings?.sortField === 'amount') {
      const tA = a.items.reduce((s, i) => s + (i.amountDue ?? 0), 0);
      const tB = b.items.reduce((s, i) => s + (i.amountDue ?? 0), 0);
      return (tA - tB) * sortDir;
    }
    const minA = a.items.reduce((m, i) => (i.dueDate && (!m || i.dueDate < m) ? i.dueDate : m), '');
    const minB = b.items.reduce((m, i) => (i.dueDate && (!m || i.dueDate < m) ? i.dueDate : m), '');
    return (minA || '9999-12-31').localeCompare(minB || '9999-12-31') * sortDir;
  });

  const now = new Date();

  const eligibleGroupCount = groups.filter(
    (g) => g.items.every((i) => i.toNumber) && g.items.some((i) => i.status === 'pending' && new Date(i.chaseAfter) <= now)
  ).length;

  const pendingCount = queueInvoices.length;

  return (
    <div className="h-full flex flex-col">
      <header className="flex-none px-8 pt-8 pb-5 border-b border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-slate-900 tracking-tight">Scheduling queue</h1>
            <p className="mt-1 text-sm text-slate-500">
              {groups.length} debtor{groups.length === 1 ? '' : 's'} · {pendingCount} invoice{pendingCount === 1 ? '' : 's'} pending
            </p>
          </div>
          <Button
            variant="primary"
            icon={<IconRefresh className="w-4 h-4" />}
            loading={running}
            disabled={running || eligibleGroupCount === 0}
            onClick={runNow}
          >
            {running
              ? 'Running…'
              : eligibleGroupCount > 0
                ? `Dispatch ${eligibleGroupCount} call${eligibleGroupCount === 1 ? '' : 's'}`
                : 'Nothing ready to dispatch'}
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
        {loading && <InvoiceListSkeleton count={4} />}

        {!loading && groups.length === 0 && failedInvoices.length === 0 && (
          <div className="text-center py-20">
            <p className="font-display text-lg italic text-slate-400 mb-1.5">Queue is empty.</p>
            <p className="text-sm text-slate-400">Send invoices from Invoices to schedule automated chasing.</p>
          </div>
        )}

        <div className="space-y-3">
          {groups.map((g) => {
            const total = g.items.reduce((s, i) => s + (i.amountDue ?? 0), 0);
            const earliest = g.items.reduce((min, i) => {
              const d = i.dueDate ?? '9999-12-31';
              return d < min ? d : min;
            }, '9999-12-31');
            const lead = g.items[0];
            const callStatus = lead?.call?.status ?? null;
            const callId = lead?.call?.id ?? null;

            const callIsDone = callStatus === 'completed' || callStatus === 'failed';
            const isCalling = !callIsDone && g.items.some((i) => i.status === 'calling');

            // Items whose groupKey matches g.key are what the server will actually dispatch.
            // Fuzzy-merged items from other DB groups are display-only.
            const primaryItems = g.items.filter((i) => i.groupKey === g.key);
            const primaryPending = primaryItems.filter((i) => i.status === 'pending');
            const hasNoPhone = primaryPending.length > 0 && primaryPending.every((i) => !i.toNumber);
            const earliestChaseAfter = g.items.reduce((min, i) => {
              const d = new Date(i.chaseAfter);
              return d < min ? d : min;
            }, new Date(8640000000000000));

            const eligibleNow =
              !isCalling && primaryItems.some((i) => i.status === 'pending' && !!i.toNumber && new Date(i.chaseAfter) <= now);
            const chaseInFuture = !isCalling && earliestChaseAfter > now;

            const isRetry = g.items.some((i) => i.status === 'pending' && i.attempts > 0);
            const retryChaseAfter = isRetry
              ? g.items
                  .filter((i) => i.status === 'pending' && i.attempts > 0)
                  .reduce((min, i) => {
                    const d = new Date(i.chaseAfter);
                    return d < min ? d : min;
                  }, new Date(8640000000000000))
              : null;

            const isGroupDispatching = dispatchingKey === g.key;

            return (
              <Card key={g.key} className="overflow-hidden">
                <CardHeader className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-lg font-semibold text-slate-900 truncate">{g.business}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                      <span className="font-mono">
                        {g.items.length} invoice{g.items.length === 1 ? '' : 's'}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="font-display font-semibold text-slate-700">{fmtAmount(lead?.currency, total)}</span>
                      {g.items.length > 1 && earliest !== '9999-12-31' && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span>earliest due {fmtDate(earliest)}</span>
                        </>
                      )}
                    </div>
                    <div className="mt-1.5 min-h-[1.1rem] text-xs">
                      {!isCalling && hasNoPhone && (
                        <WarningBadge>No phone number — edit invoice to add one</WarningBadge>
                      )}
                      {!isCalling && !hasNoPhone && chaseInFuture && isRetry && retryChaseAfter && (
                        <span className="text-slate-400">Retry from {fmtDate(retryChaseAfter.toISOString().slice(0, 10))}</span>
                      )}
                      {!isCalling && !hasNoPhone && chaseInFuture && !isRetry && (
                        <span className="text-slate-400">Chase from {fmtDate(earliestChaseAfter.toISOString().slice(0, 10))}</span>
                      )}
                      {isCalling && callId && (
                        <button
                          onClick={() => setCallDrawerId(callId)}
                          className="font-medium text-brand hover:text-brand-dark hover:underline"
                        >
                          View transcript →
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex-none flex items-center gap-2 mt-0.5">
                    {!isCalling && (
                      <Button
                        variant="primary"
                        className="!py-1.5 !px-3 text-xs"
                        disabled={!eligibleNow || isGroupDispatching || running}
                        loading={isGroupDispatching}
                        onClick={() => dispatchGroup(g.key)}
                      >
                        Dispatch
                      </Button>
                    )}
                    {isCalling && <CallStatusBadge status={(callStatus ?? 'dispatching') as CallStatus} />}
                  </div>
                </CardHeader>

                <CardBody className="pt-0 border-t border-slate-50">
                  <div className="divide-y divide-slate-50">
                    {g.items.map((inv) => {
                      const canRemove = !['resolved', 'cancelled'].includes(inv.status);
                      const canEdit = inv.status === 'pending' && !isCalling;
                      const isRemoving = removingId === inv.id;
                      return (
                        <div key={inv.id} className="flex items-center justify-between py-1.5 text-sm">
                          <span className="text-slate-500 truncate">
                            {inv.invoiceNumber ? `#${inv.invoiceNumber}` : 'Invoice'}
                            {inv.dueDate ? ` · due ${fmtDate(inv.dueDate)}` : ''}
                          </span>
                          <div className="flex-none flex items-center gap-2.5">
                            <span className="font-mono text-slate-700">{fmtAmount(inv.currency, inv.amountDue)}</span>
                            {canEdit && (
                              <button
                                onClick={() => setEditingInvoice(inv)}
                                className="text-slate-300 hover:text-slate-600 transition-colors"
                                title="Edit invoice"
                              >
                                <IconEdit className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canRemove && (
                              <button
                                onClick={() => setConfirmRemoveId(inv.id)}
                                disabled={isRemoving}
                                className="text-slate-300 hover:text-red-500 transition-colors disabled:opacity-40"
                                title="Remove from queue"
                              >
                                {isRemoving ? <Spinner size="sm" className="w-3.5 h-3.5" /> : <IconTrash className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>

        {failedInvoices.length > 0 && (
          <div className="mt-8">
            <p className="smallcaps text-slate-400 mb-2">Failed today</p>
            <Card>
              <div className="divide-y divide-slate-50">
                {failedInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-slate-900">{inv.contactBusiness}</span>
                      <span className="ml-2 text-xs text-slate-400">
                        {inv.invoiceNumber ? `#${inv.invoiceNumber}` : 'Invoice'} · {fmtAmount(inv.currency, inv.amountDue)}
                      </span>
                    </div>
                    <div className="flex-none flex items-center gap-3">
                      {inv.call?.id && (
                        <button
                          onClick={() => setCallDrawerId(inv.call!.id)}
                          className="text-xs font-medium text-brand hover:text-brand-dark hover:underline"
                        >
                          View call
                        </button>
                      )}
                      <Button
                        variant="secondary"
                        className="!py-1.5 !px-3 text-xs"
                        loading={retryingId === inv.id}
                        onClick={() => retryInvoice(inv.id)}
                      >
                        Retry
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmRemoveId}
        title="Remove invoice from queue?"
        message="This cancels the invoice — it will no longer be chased automatically."
        confirmLabel="Remove"
        danger
        onConfirm={() => confirmRemoveId && removeInvoice(confirmRemoveId)}
        onCancel={() => setConfirmRemoveId(null)}
      />

      <Drawer open={!!editingInvoice} onClose={closeEdit} title="Edit invoice" width="max-w-2xl">
        {editingInvoice && (
          <InvoiceComposeForm
            key={editingInvoice.id}
            initial={queueInvoiceToParseResult(editingInvoice)}
            onCancel={closeEdit}
            onSave={handleQueueSave}
            onDispatch={handleQueueDispatch}
            dispatchLabel="Save & dispatch now"
            saving={editSaving}
          />
        )}
      </Drawer>

      <CallDetailDrawer callId={callDrawerId} onClose={() => setCallDrawerId(null)} />
    </div>
  );
}
