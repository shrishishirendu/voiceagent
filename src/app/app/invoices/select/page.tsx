'use client';

// Ported from demo2.0's SelectInvoiceScreen (src/app/page.tsx lines 2130-2364). Two tabs — Google
// Drive picker and local upload, both multi-select. Drive selections live directly in the shared
// BulkIntakeContext (toggleDriveItem adds/removes a BulkItem with driveFileId); local upload
// selections stay purely local to this page until the user acts, mirroring the original's
// `uploadedFiles` state.

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBulkIntake } from '@/components/shared/BulkIntakeContext';
import { useAddToast } from '@/components/shared/Toast';
import { Button } from '@/components/shared/Button';
import { IconCheck, IconUpload } from '@/components/shared/Icons';
import { fmtBytes, fmtWhen } from '@/lib/format';
import type { DriveInvoiceFile } from '@/lib/client-types';

type UploadRow = { uid: string; file: File; selected: boolean };

export default function SelectInvoicePage() {
  const router = useRouter();
  const addToast = useAddToast();
  const {
    bulkItems,
    driveFiles,
    driveLoading,
    driveError,
    toggleDriveItem,
    selectAllDrive,
    deselectAllDrive,
    handleSelectInvoiceDispatch,
    handleBulkFiles,
    isDispatching,
  } = useBulkIntake();

  const [tab, setTab] = useState<'drive' | 'upload'>('drive');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadRow[]>([]);

  const selectedDriveIds = useMemo(() => new Set(bulkItems.filter((i) => i.driveFileId).map((i) => i.driveFileId!)), [bulkItems]);
  const selectedUploadCount = uploadedFiles.filter((f) => f.selected).length;
  const totalDispatchCount = bulkItems.length + selectedUploadCount;
  const hasDispatchable = totalDispatchCount > 0;
  const anyUploadSelected = uploadedFiles.some((f) => f.selected);

  const handleQueue = async () => {
    try {
      await handleSelectInvoiceDispatch(uploadedFiles.filter((f) => f.selected).map((f) => f.file));
      setUploadedFiles([]);
      router.push('/app/queue');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to queue invoices', 'error');
    }
  };

  // Legacy immediate-dispatch path. We use handleBulkFiles (append + dedupe + background parse)
  // rather than the old handleBulkFilesFromHome, which *replaces* bulkItems wholesale — on this
  // merged select screen that would silently discard any Drive files the user already picked.
  const handleDispatchImmediately = () => {
    const files = uploadedFiles.filter((f) => f.selected).map((f) => f.file);
    if (files.length > 0) handleBulkFiles(files);
    setUploadedFiles([]);
    router.push('/app/invoices/bulk');
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex-none px-8 pt-8 pb-5 border-b border-slate-100 bg-white/60 backdrop-blur">
        <p className="smallcaps text-slate-400 mb-1.5">Invoice scheduling</p>
        <h1 className="font-display text-2xl font-semibold text-slate-900">Select invoices, queue for Envoy</h1>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
        <div className="max-w-2xl mx-auto space-y-5">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
            {(['drive', 'upload'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                  tab === t ? 'bg-brand text-white' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {t === 'drive' ? 'Google Drive' : 'Upload files'}
              </button>
            ))}
          </div>

          {tab === 'drive' && (
            <div className="card">
              <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Drive invoices</h3>
                {!driveLoading && !driveError && driveFiles.length > 0 && (
                  <button
                    onClick={selectedDriveIds.size > 0 ? deselectAllDrive : selectAllDrive}
                    className="text-xs font-semibold text-brand hover:text-brand-dark transition-colors"
                  >
                    {selectedDriveIds.size > 0 ? 'Deselect all' : 'Select all'}
                  </button>
                )}
              </div>
              <div className="px-4 pb-4 space-y-2">
                {driveLoading && <p className="text-sm text-slate-400 py-6 text-center">Loading Drive…</p>}
                {driveError && !driveLoading && <p className="text-sm text-red-500 py-2">{driveError}</p>}
                {!driveLoading && !driveError && driveFiles.length === 0 && (
                  <p className="text-sm text-slate-400 py-6 text-center">No PDF invoices found in Drive.</p>
                )}
                {driveFiles.map((f: DriveInvoiceFile) => {
                  const selected = selectedDriveIds.has(f.fileId);
                  return (
                    <button
                      key={f.fileId}
                      onClick={() => toggleDriveItem(f)}
                      className={`w-full text-left px-3.5 py-3 rounded-xl border flex items-center gap-3 transition-colors ${
                        selected ? 'border-brand/40 bg-brand-faint' : 'border-slate-100 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          selected ? 'bg-brand border-brand' : 'border-slate-300'
                        }`}
                      >
                        {selected && <IconCheck className="w-3 h-3 text-white" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-800 truncate">{f.name}</span>
                        <span className="block text-xs text-slate-400 mt-0.5">{[fmtBytes(f.size), fmtWhen(f.modifiedTime)].filter(Boolean).join(' · ')}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="card">
              <div className="p-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (!e.target.files) return;
                    const incoming = Array.from(e.target.files);
                    setUploadedFiles((prev) => {
                      const seen = new Set(prev.map((f) => `${f.file.name}::${f.file.size}`));
                      const fresh = incoming.filter((f) => !seen.has(`${f.name}::${f.size}`)).map((f) => ({ uid: crypto.randomUUID(), file: f, selected: true }));
                      return [...prev, ...fresh];
                    });
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-8 rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center gap-2 text-slate-400 hover:border-brand/40 hover:text-brand transition-colors"
                >
                  <IconUpload className="w-6 h-6" />
                  <span className="text-sm font-medium">Choose PDF invoices</span>
                </button>

                {uploadedFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-end">
                      <button
                        onClick={() => setUploadedFiles((prev) => prev.map((f) => ({ ...f, selected: !anyUploadSelected })))}
                        className="text-xs font-semibold text-brand hover:text-brand-dark transition-colors"
                      >
                        {anyUploadSelected ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    {uploadedFiles.map((f) => (
                      <button
                        key={f.uid}
                        onClick={() => setUploadedFiles((prev) => prev.map((u) => (u.uid === f.uid ? { ...u, selected: !u.selected } : u)))}
                        className={`w-full text-left px-3.5 py-3 rounded-xl border flex items-center gap-3 transition-colors ${
                          f.selected ? 'border-brand/40 bg-brand-faint' : 'border-slate-100 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                            f.selected ? 'bg-brand border-brand' : 'border-slate-300'
                          }`}
                        >
                          {f.selected && <IconCheck className="w-3 h-3 text-white" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-800 truncate">{f.file.name}</span>
                          <span className="block text-xs text-slate-400 mt-0.5">{fmtBytes(f.file.size)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-none px-8 py-5 border-t border-slate-100 bg-white/60 backdrop-blur">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <button
            onClick={handleDispatchImmediately}
            disabled={!hasDispatchable}
            className="text-sm font-medium text-slate-400 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Dispatch immediately instead →
          </button>
          <Button variant="primary" onClick={handleQueue} disabled={!hasDispatchable || isDispatching} loading={isDispatching}>
            {`Queue for scheduling${totalDispatchCount > 0 ? ` (${totalDispatchCount})` : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
