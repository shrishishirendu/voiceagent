'use client';

// Ported from demo2.0's BulkInvoiceScreen + BulkItemRow (src/app/page.tsx lines 1865-2126). Per-item
// badge mapping is translated from getSummaryBadge/getCallBadge (page.tsx lines 2374-2398): settled
// call outcomes -> CallOutcomeBadge; active call states (queued/ringing/in-progress) -> blue +
// dot-pulse; bulk-only transient states (dispatching/queueing/reading) -> slate + dot-pulse;
// dispatch-error -> red; parse-error/paused -> amber.
//
// The "edit" overlay uses the summaryEditUid flow (not the old reviewBulkUid "Details" flow) per
// the task spec, wrapping the shared InvoiceComposeForm in a Drawer.

import { useRef, useState } from 'react';
import { useBulkIntake } from '@/components/shared/BulkIntakeContext';
import { useAddToast } from '@/components/shared/Toast';
import { InvoiceComposeForm } from '@/components/shared/InvoiceComposeForm';
import { CallDetailDrawer } from '@/components/shared/CallDetailDrawer';
import { Drawer } from '@/components/shared/Drawer';
import { Button } from '@/components/shared/Button';
import { Badge, CallOutcomeBadge } from '@/components/shared/Badge';
import { IconPlus, IconEdit, IconRefresh, IconUpload } from '@/components/shared/Icons';
import { fmtAmount, fmtDate, hasCallableNumber } from '@/lib/format';
import type { BulkItem } from '@/lib/client-types';

function DotBadge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <Badge className={className}>
      <span className="dot-pulse inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
      {children}
    </Badge>
  );
}

function ItemBadge({ item }: { item: BulkItem }) {
  if (item.callStatus === 'completed' || item.callStatus === 'failed') {
    return <CallOutcomeBadge outcome={item.callOutcome ?? null} />;
  }
  if (item.callStatus === 'in-progress') return <DotBadge className="bg-blue-100 text-blue-700">In conversation</DotBadge>;
  if (item.callStatus === 'ringing') return <DotBadge className="bg-blue-100 text-blue-700">Ringing</DotBadge>;
  if (item.callStatus === 'queued') return <DotBadge className="bg-blue-100 text-blue-700">Connecting</DotBadge>;
  if (item.status === 'dispatched') return <Badge className="bg-slate-100 text-slate-500">Dispatched</Badge>;
  if (item.status === 'dispatching') return <DotBadge className="bg-slate-100 text-slate-500">Dispatching…</DotBadge>;
  if (item.status === 'queueing') return <DotBadge className="bg-slate-100 text-slate-500">Queueing…</DotBadge>;
  if (item.status === 'queued') return <Badge className="bg-slate-100 text-slate-500">Queued</Badge>;
  if (item.status === 'dispatch-error') return <Badge className="bg-red-100 text-red-700">Failed</Badge>;
  if (item.status === 'parse-error') return <Badge className="bg-amber-100 text-amber-700">Parse error</Badge>;
  if (item.status === 'paused') return <Badge className="bg-amber-100 text-amber-700">Paused</Badge>;
  if (item.status === 'parsed') return <Badge className="bg-slate-100 text-slate-500">Ready</Badge>;
  return <DotBadge className="bg-slate-100 text-slate-500">Reading…</DotBadge>;
}

function BulkItemRow({
  item,
  onEdit,
  onDispatch,
  onRetry,
  onRemove,
  onOpenCall,
}: {
  item: BulkItem;
  onEdit: () => void;
  onDispatch: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onOpenCall: () => void;
}) {
  const canDispatch = (item.status === 'parsed' || item.status === 'dispatch-error') && hasCallableNumber(item.parsed?.toNumber);
  const isSettled = item.status === 'dispatched' && (item.callStatus === 'completed' || item.callStatus === 'failed');
  const subtitle = item.parsed
    ? [item.parsed.vendorName, fmtAmount(item.parsed.currency, item.parsed.amountDue) || null, item.parsed.dueDate ? `due ${fmtDate(item.parsed.dueDate)}` : null]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div className={`card p-4 relative transition-transform ${isSettled ? 'row-card cursor-pointer' : ''}`} onClick={isSettled ? onOpenCall : undefined}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-slate-200 text-slate-400 text-xs leading-none flex items-center justify-center hover:text-red-500 hover:border-red-200 transition-colors"
        title="Remove"
      >
        ×
      </button>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 truncate">{item.parsed?.contactBusiness || item.fileName}</p>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
          {item.status === 'parse-error' && item.error && <p className="text-xs text-red-500 mt-0.5">{item.error}</p>}
          {item.status === 'dispatch-error' && item.error && <p className="text-xs text-red-500 mt-0.5">{item.error}</p>}
          {item.callPollError && <p className="text-xs text-amber-600 mt-0.5">{item.callPollError}</p>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ItemBadge item={item} />
          {item.status === 'parse-error' && (
            <Button
              variant="ghost"
              icon={<IconRefresh className="w-3.5 h-3.5" />}
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
            >
              Retry
            </Button>
          )}
          {(item.status === 'parsed' || item.status === 'dispatch-error') && (
            <>
              <Button
                variant="secondary"
                icon={<IconEdit className="w-3.5 h-3.5" />}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                Edit
              </Button>
              <Button
                variant="primary"
                disabled={!canDispatch}
                title={!canDispatch ? 'No phone number found — use Edit to add one' : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onDispatch();
                }}
              >
                Dispatch
              </Button>
            </>
          )}
        </div>
      </div>

      {isSettled && <p className="text-xs text-slate-300 mt-2">Tap to view transcript →</p>}
    </div>
  );
}

export default function BulkInvoicePage() {
  const addToast = useAddToast();
  const {
    bulkItems,
    dispatchBulkItem,
    handleRemoveBulkItem,
    handleDispatchAll,
    handleRetryFailed,
    handleRetryParseUid,
    handleBulkFiles,
    isDispatching,
    summaryEditUid,
    setSummaryEditUid,
    openSummaryDetails,
    saveSummaryDetails,
    summaryDetailsDispatch,
  } = useBulkIntake();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewCallId, setViewCallId] = useState<string | null>(null);

  const parsing = bulkItems.filter((i) => i.status === 'parsing').length;
  const dispatched = bulkItems.filter((i) => i.status === 'dispatched').length;
  const dispatchReady = bulkItems.filter((i) => i.status === 'parsed' && hasCallableNumber(i.parsed?.toNumber)).length;
  const failedCount = bulkItems.filter((i) => i.status === 'dispatch-error' || i.status === 'parse-error' || i.callStatus === 'failed').length;
  const pausedCount = bulkItems.filter((i) => i.status === 'paused').length;
  const retryCount = failedCount + pausedCount;

  const editingItem = summaryEditUid ? bulkItems.find((i) => i.uid === summaryEditUid) ?? null : null;

  const handleDispatchOne = async (uid: string) => {
    const result = await dispatchBulkItem(uid);
    if (result === false) addToast('Call capacity reached — it will retry automatically shortly.', 'error');
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex-none px-8 pt-8 pb-5 border-b border-slate-100 bg-white/60 backdrop-blur flex items-start justify-between gap-4">
        <div>
          <p className="smallcaps text-slate-400 mb-1.5">Bulk upload</p>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Upload invoices, dispatch in bulk</h1>
          {bulkItems.length > 0 && (
            <p className="text-sm text-slate-400 mt-2">
              {parsing > 0 ? `${parsing} reading` : null}
              {parsing > 0 && dispatched > 0 ? ' · ' : null}
              {dispatched > 0 ? `${dispatched} dispatched` : null}
              {parsing === 0 && dispatched === 0 ? `${bulkItems.length} invoice${bulkItems.length !== 1 ? 's' : ''}` : null}
            </p>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleBulkFiles(files);
            e.target.value = '';
          }}
        />
        <Button variant="secondary" icon={<IconPlus className="w-4 h-4" />} onClick={() => fileInputRef.current?.click()}>
          Add PDFs
        </Button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
        <div className="max-w-3xl mx-auto space-y-3">
          {bulkItems.length === 0 ? (
            <div className="py-20 text-center">
              <IconUpload className="w-8 h-8 mx-auto text-slate-300 mb-3" />
              <p className="text-sm text-slate-400">No invoices yet.</p>
              <p className="text-xs text-slate-300 mt-1">Click &ldquo;Add PDFs&rdquo; to get started.</p>
            </div>
          ) : (
            bulkItems.map((item) => (
              <BulkItemRow
                key={item.uid}
                item={item}
                onEdit={() => openSummaryDetails(item.uid)}
                onDispatch={() => handleDispatchOne(item.uid)}
                onRetry={() => handleRetryParseUid(item.uid)}
                onRemove={() => handleRemoveBulkItem(item.uid)}
                onOpenCall={() => item.callId && setViewCallId(item.callId)}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex-none px-8 py-5 border-t border-slate-100 bg-white/60 backdrop-blur">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          {retryCount > 0 ? (
            <Button variant="secondary" icon={<IconRefresh className="w-4 h-4" />} onClick={handleRetryFailed} disabled={isDispatching}>
              Retry all ({retryCount})
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={handleDispatchAll} disabled={dispatchReady === 0 || isDispatching} loading={isDispatching}>
            {dispatchReady > 0 ? `Dispatch All (${dispatchReady})` : 'Dispatch All'}
          </Button>
        </div>
      </div>

      <Drawer open={!!editingItem} onClose={() => setSummaryEditUid(null)} title="Edit invoice">
        {editingItem?.parsed && (
          <InvoiceComposeForm
            key={editingItem.uid}
            initial={editingItem.parsed}
            onCancel={() => setSummaryEditUid(null)}
            onSave={saveSummaryDetails}
            onDispatch={summaryDetailsDispatch}
            dispatchLabel="Dispatch call"
          />
        )}
      </Drawer>

      <CallDetailDrawer callId={viewCallId} onClose={() => setViewCallId(null)} />
    </div>
  );
}
