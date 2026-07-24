'use client';

// Ported from demo2.0's SelectInvoiceScreen. Two tabs — Supabase Storage picker and local
// upload, both multi-select. Supabase selections live directly in the shared BulkIntakeContext
// (toggleDriveItem adds/removes a BulkItem with storagePath); local upload selections stay
// purely local to this page until the user acts. Presented as a full-width desktop table.

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBulkIntake } from '@/components/shared/BulkIntakeContext';
import { useAddToast } from '@/components/shared/Toast';
import { Button } from '@/components/shared/Button';
import { IconCheck, IconUpload } from '@/components/shared/Icons';
import { fmtBytes, fmtWhen } from '@/lib/format';
import type { StoredFile } from '@/lib/client-types';

type UploadRow = { uid: string; file: File; selected: boolean };

function CheckCell({ selected }: { selected: boolean }) {
  return (
    <span
      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
        selected ? 'bg-brand border-brand' : 'border-slate-300'
      }`}
    >
      {selected && <IconCheck className="w-3 h-3 text-white" />}
    </span>
  );
}

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

  const selectedDriveIds = useMemo(() => new Set(bulkItems.filter((i) => i.storagePath).map((i) => i.storagePath!)), [bulkItems]);
  const selectedUploadCount = uploadedFiles.filter((f) => f.selected).length;
  const totalDispatchCount = bulkItems.length + selectedUploadCount;
  const hasDispatchable = totalDispatchCount > 0;
  const anyUploadSelected = uploadedFiles.some((f) => f.selected);
  const allDriveSelected = driveFiles.length > 0 && selectedDriveIds.size === driveFiles.length;

  const handleQueue = async () => {
    try {
      await handleSelectInvoiceDispatch(uploadedFiles.filter((f) => f.selected).map((f) => f.file));
      setUploadedFiles([]);
      router.push('/app/queue');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to queue invoices', 'error');
    }
  };

  // Legacy immediate-dispatch path. handleBulkFiles appends + dedupes (unlike the old
  // replace-wholesale path) so any Supabase files already picked aren't discarded.
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
        <div className="max-w-5xl mx-auto space-y-5">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
            {(['drive', 'upload'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                  tab === t ? 'bg-brand text-white' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {t === 'drive' ? 'Supabase' : 'Upload files'}
              </button>
            ))}
          </div>

          {tab === 'drive' && (
            <div className="card overflow-hidden">
              {driveLoading && <p className="text-sm text-slate-400 py-10 text-center">Loading…</p>}
              {driveError && !driveLoading && <p className="text-sm text-red-500 py-4 px-4">{driveError}</p>}
              {!driveLoading && !driveError && driveFiles.length === 0 && (
                <p className="text-sm text-slate-400 py-10 text-center">No invoices in Supabase Storage yet.</p>
              )}
              {!driveLoading && !driveError && driveFiles.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-slate-400 border-b border-slate-100">
                      <tr>
                        <th className="w-12 px-4 py-3">
                          <button
                            onClick={allDriveSelected ? deselectAllDrive : selectAllDrive}
                            aria-label={allDriveSelected ? 'Deselect all' : 'Select all'}
                            className="align-middle"
                          >
                            <CheckCell selected={allDriveSelected} />
                          </button>
                        </th>
                        <th className="px-4 py-3 font-semibold">Invoice file</th>
                        <th className="px-4 py-3 font-semibold w-32">Size</th>
                        <th className="px-4 py-3 font-semibold w-40">Uploaded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {driveFiles.map((f: StoredFile) => {
                        const selected = selectedDriveIds.has(f.path);
                        return (
                          <tr
                            key={f.path}
                            onClick={() => toggleDriveItem(f)}
                            className={`cursor-pointer transition-colors ${selected ? 'bg-brand-faint' : 'hover:bg-slate-50'}`}
                          >
                            <td className="px-4 py-3"><CheckCell selected={selected} /></td>
                            <td className="px-4 py-3 font-medium text-slate-800 max-w-[420px] truncate">{f.name}</td>
                            <td className="px-4 py-3 text-slate-400 tabular-nums">{fmtBytes(f.size)}</td>
                            <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmtWhen(f.modifiedTime)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-4">
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
                className="w-full py-8 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center gap-2 text-slate-400 hover:border-brand/40 hover:text-brand transition-colors"
              >
                <IconUpload className="w-6 h-6" />
                <span className="text-sm font-medium">Choose PDF invoices</span>
              </button>

              {uploadedFiles.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-slate-400 border-b border-slate-100">
                        <tr>
                          <th className="w-12 px-4 py-3">
                            <button
                              onClick={() => setUploadedFiles((prev) => prev.map((f) => ({ ...f, selected: !anyUploadSelected })))}
                              aria-label={anyUploadSelected ? 'Deselect all' : 'Select all'}
                              className="align-middle"
                            >
                              <CheckCell selected={anyUploadSelected} />
                            </button>
                          </th>
                          <th className="px-4 py-3 font-semibold">Invoice file</th>
                          <th className="px-4 py-3 font-semibold w-32">Size</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {uploadedFiles.map((f) => (
                          <tr
                            key={f.uid}
                            onClick={() => setUploadedFiles((prev) => prev.map((u) => (u.uid === f.uid ? { ...u, selected: !u.selected } : u)))}
                            className={`cursor-pointer transition-colors ${f.selected ? 'bg-brand-faint' : 'hover:bg-slate-50'}`}
                          >
                            <td className="px-4 py-3"><CheckCell selected={f.selected} /></td>
                            <td className="px-4 py-3 font-medium text-slate-800 max-w-[420px] truncate">{f.file.name}</td>
                            <td className="px-4 py-3 text-slate-400 tabular-nums">{fmtBytes(f.file.size)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-none px-8 py-5 border-t border-slate-100 bg-white/60 backdrop-blur">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
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
