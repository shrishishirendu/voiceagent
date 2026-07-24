'use client';

// Shared bulk-invoice-intake state — ported from the relevant slice of EnvoyApp's state/handlers
// in demo2.0's src/app/page.tsx (roughly lines 3238-3840). In the old single-page app this state
// lived in one parent component shared by SelectInvoiceScreen and BulkInvoiceScreen (in-memory
// `screen` transitions); here those are two separate routes (/app/invoices/select and
// /app/invoices/bulk), so this context holds the state instead so it survives navigation between
// them. Every `setScreen(...)` call from the original has been removed — callers decide navigation
// themselves via `useRouter().push(...)` after calling the relevant handler.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  buildBulkBrief,
  type BulkFormState,
  type BulkItem,
  type BulkSource,
  type BulkStatus,
  type ContactRow,
  type StoredFile,
  type InvoiceParseResult,
} from '@/lib/client-types';
import { CONCURRENT_CALL_LIMIT, createSemaphore, hasCallableNumber } from '@/lib/format';
import { companyNamesMatch } from '@/lib/nameUtils';

interface BulkIntakeValue {
  bulkItems: BulkItem[];
  isDispatching: boolean;

  driveFiles: StoredFile[];
  driveLoading: boolean;
  driveError: string | null;
  loadDriveFiles: (force?: boolean) => Promise<void>;

  getBulkItemFile: (item: BulkItem) => Promise<File>;
  toggleDriveItem: (storedFile: StoredFile) => void;
  selectAllDrive: () => void;
  deselectAllDrive: () => void;

  parseBulkItem: (uid: string, file: File) => Promise<void>;
  handleBulkFiles: (files: File[]) => void;
  handleBulkFilesFromHome: (files: File[]) => void;
  handleRemoveBulkItem: (uid: string) => void;

  dispatchBulkItem: (uid: string) => Promise<false | void>;
  drainDispatch: () => Promise<void>;
  handleDispatchAll: () => Promise<void>;
  queueBulkItem: (uid: string) => Promise<void>;
  runInvoicePipeline: (uids: string[], mode?: 'dispatch' | 'queue') => Promise<void>;
  handleSelectInvoiceDispatch: (selectedUploadFiles?: File[]) => Promise<void>;
  handleRetryFailed: () => Promise<void>;
  handleRetryParseUid: (uid: string) => Promise<void>;

  // Old InvoiceCompose "Details" edit flow (pre-dispatch items opened via reviewBulkUid).
  reviewBulkUid: string | null;
  setReviewBulkUid: (uid: string | null) => void;
  saveBulkDetails: (state: BulkFormState) => void;
  bulkDetailsDispatch: (state: BulkFormState) => Promise<void>;
  closeBulkDetails: () => void;

  // Old BulkSummaryScreen edit flow (summaryEditUid) — this is the one the bulk page's edit
  // drawer wires up per the task spec.
  summaryEditUid: string | null;
  setSummaryEditUid: (uid: string | null) => void;
  saveSummaryDetails: (state: BulkFormState) => void;
  summaryDetailsDispatch: (state: BulkFormState) => Promise<void>;
  openSummaryDetails: (uid: string) => void;
}

const BulkIntakeContext = createContext<BulkIntakeValue | null>(null);

/** Merge editable BulkFormState fields onto an existing InvoiceParseResult (or a blank one). */
function mergeStateIntoParsed(base: InvoiceParseResult | undefined, state: BulkFormState): InvoiceParseResult {
  return {
    ...(base ?? {
      contactBusiness: null,
      toNumber: null,
      invoiceNumber: null,
      invoiceDate: null,
      dueDate: null,
      amountDue: null,
      currency: null,
      lineItems: null,
      invoiceNotes: null,
    }),
    toNumber: hasCallableNumber(state.toNumber) ? state.toNumber.trim() : null,
    contactBusiness: state.contactBusiness || null,
    contactPerson: state.contactPerson || null,
    vendorName: state.vendorName || null,
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
    abn: state.abn || null,
    remittanceName: state.remittanceName || null,
    remittanceContact: state.remittanceContact || null,
  };
}

export function BulkIntakeProvider({ children }: { children: ReactNode }) {
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [reviewBulkUid, setReviewBulkUid] = useState<string | null>(null);
  const [summaryEditUid, setSummaryEditUid] = useState<string | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [driveFiles, setDriveFiles] = useState<StoredFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const driveFilesLastFetchedRef = useRef<number>(0);
  const bulkItemsRef = useRef<BulkItem[]>([]);
  useEffect(() => {
    bulkItemsRef.current = bulkItems;
  }, [bulkItems]);

  const loadDriveFiles = useCallback(
    async (force = false) => {
      if (!force && driveFiles.length > 0 && Date.now() - driveFilesLastFetchedRef.current < 30_000) return;
      setDriveLoading(true);
      setDriveError(null);
      try {
        const r = await fetch('/api/files/invoices', { cache: 'no-store' });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        setDriveFiles(data.files ?? []);
        driveFilesLastFetchedRef.current = Date.now();
      } catch (e) {
        setDriveError(e instanceof Error ? e.message : 'Failed to load stored files');
      } finally {
        setDriveLoading(false);
      }
    },
    [driveFiles.length]
  );

  const getBulkItemFile = async (item: BulkItem): Promise<File> => {
    if (item.file) return item.file;
    const r = await fetch(`/api/files/invoice?path=${encodeURIComponent(item.storagePath ?? '')}`);
    if (!r.ok) throw new Error(`Failed to download ${item.fileName} (HTTP ${r.status})`);
    const blob = await r.blob();
    return new File([blob], item.fileName, { type: 'application/pdf' });
  };

  // Upload a local PDF to Supabase Storage so every processed file lands in the bucket.
  // Returns the storage path (or null on failure — non-blocking).
  const uploadToStorage = async (file: File): Promise<string | null> => {
    try {
      const fd = new FormData();
      fd.append('document', file);
      const r = await fetch('/api/files/upload', { method: 'POST', body: fd });
      if (!r.ok) return null;
      return (await r.json()).path ?? null;
    } catch {
      return null;
    }
  };

  const toggleDriveItem = (storedFile: StoredFile) => {
    setBulkItems((prev) => {
      const existing = prev.find((i) => i.storagePath === storedFile.path);
      if (existing) return prev.filter((i) => i.storagePath !== storedFile.path);
      return [
        ...prev,
        {
          uid: crypto.randomUUID(),
          source: 'storage' as BulkSource,
          storagePath: storedFile.path,
          fileName: storedFile.name,
          fileSize: storedFile.size,
          modifiedTime: storedFile.modifiedTime,
          status: 'parsing' as BulkStatus,
        },
      ];
    });
  };

  const selectAllDrive = () => {
    setBulkItems((prev) => {
      const existing = new Set(prev.filter((i) => i.source === 'storage').map((i) => i.storagePath));
      const additions: BulkItem[] = driveFiles
        .filter((f) => !existing.has(f.path))
        .map((f) => ({
          uid: crypto.randomUUID(),
          source: 'storage' as BulkSource,
          storagePath: f.path,
          fileName: f.name,
          fileSize: f.size,
          modifiedTime: f.modifiedTime,
          status: 'parsing' as BulkStatus,
        }));
      return [...prev, ...additions];
    });
  };

  const deselectAllDrive = () => {
    setBulkItems((prev) => prev.filter((i) => i.source !== 'storage'));
  };

  // Pre-warm Drive file list in background so the select screen opens instantly.
  useEffect(() => {
    loadDriveFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll call status for dispatched bulk items.
  useEffect(() => {
    const id = setInterval(async () => {
      const active = bulkItemsRef.current.filter(
        (i) => i.callId && i.callStatus !== 'completed' && i.callStatus !== 'failed'
      );
      if (active.length === 0) return;
      await Promise.all(
        active.map(async (item) => {
          try {
            const r = await fetch(`/api/calls/${item.callId}`, { cache: 'no-store' });
            if (!r.ok) {
              setBulkItems((prev) =>
                prev.map((i) => (i.uid === item.uid ? { ...i, callPollError: `Status check failed (HTTP ${r.status})` } : i))
              );
              return;
            }
            const data = await r.json();
            setBulkItems((prev) =>
              prev.map((i) =>
                i.uid === item.uid
                  ? { ...i, callStatus: data.status, callOutcome: data.outcome, callPollError: data.pollError ?? null }
                  : i
              )
            );
          } catch {
            /* ignore */
          }
        })
      );
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const parseBulkItem = async (uid: string, file: File) => {
    try {
      const formData = new FormData();
      formData.append('document', file);
      const r = await fetch('/api/calls/parse-document', { method: 'POST', body: formData });
      const payload = (await r.json()) as InvoiceParseResult & { error?: string };
      if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);

      // Fallback: if the PDF had no callable number, try the contacts DB
      // (mirrors handleParseSuccess in the single-invoice flow).
      let resolved: InvoiceParseResult = payload;
      if (!hasCallableNumber(payload.toNumber)) {
        try {
          const params = new URLSearchParams();
          if (payload.contactBusiness) params.set('contactBusiness', payload.contactBusiness);
          if (payload.invoiceNumber) params.set('invoiceNumber', payload.invoiceNumber);
          if ([...params.keys()].length > 0) {
            const lr = await fetch(`/api/contacts/lookup?${params}`);
            if (lr.ok) {
              const data = (await lr.json()) as { phone: string | null };
              if (data.phone) resolved = { ...payload, toNumber: data.phone };
            }
          }
        } catch {
          // non-blocking — leave number empty, user can fill via edit
        }
      }
      setBulkItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, status: 'parsed', parsed: resolved } : i)));
    } catch (err) {
      setBulkItems((prev) =>
        prev.map((i) => (i.uid === uid ? { ...i, status: 'parse-error', error: err instanceof Error ? err.message : 'Parse failed' } : i))
      );
    }
  };

  const handleBulkFiles = (files: File[]) => {
    setBulkItems((prev) => {
      const seen = new Set(prev.map((i) => `${i.fileName}::${i.fileSize ?? ''}`));
      const newItems: BulkItem[] = [];
      for (const file of files) {
        const key = `${file.name}::${file.size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        newItems.push({ uid: crypto.randomUUID(), source: 'upload', file, fileName: file.name, fileSize: file.size, status: 'parsing' as BulkStatus });
      }
      newItems.forEach((item) => parseBulkItem(item.uid, item.file!));
      return [...prev, ...newItems];
    });
  };

  const handleBulkFilesFromHome = (files: File[]) => {
    const seen = new Set<string>();
    const newItems: BulkItem[] = [];
    for (const file of files) {
      const key = `${file.name}::${file.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      newItems.push({ uid: crypto.randomUUID(), source: 'upload', file, fileName: file.name, fileSize: file.size, status: 'parsing' as BulkStatus });
    }
    setBulkItems(newItems);
    newItems.forEach((item) => parseBulkItem(item.uid, item.file!));
  };

  const handleRemoveBulkItem = (uid: string) => {
    setBulkItems((prev) => prev.filter((i) => i.uid !== uid));
  };

  const dispatchBulkItem = async (uid: string): Promise<false | void> => {
    const item = bulkItemsRef.current.find((i) => i.uid === uid);
    if (!item?.parsed || !hasCallableNumber(item.parsed.toNumber)) return;
    setBulkItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, status: 'dispatching' } : i)));
    try {
      const r = await fetch('/api/calls/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBulkBrief(item.parsed, item.storagePath)),
      });
      if (r.status === 429) {
        return false;
      }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json();
      setBulkItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, status: 'dispatched', callId: data.id } : i)));
    } catch (err) {
      setBulkItems((prev) =>
        prev.map((i) => (i.uid === uid ? { ...i, status: 'dispatch-error', error: err instanceof Error ? err.message : 'Dispatch failed' } : i))
      );
    }
  };

  // Shared drain loop: dispatches items currently in "parsed" state with a phone.
  const drainDispatch = async () => {
    const toDispatch = bulkItemsRef.current.filter((i) => i.status === 'parsed' && hasCallableNumber(i.parsed?.toNumber));
    if (toDispatch.length === 0) return;
    const queue = [...toDispatch];
    const CAPACITY_WAIT = 10_000;
    while (queue.length > 0) {
      const item = queue[0];
      const result = await dispatchBulkItem(item.uid);
      if (result === false) {
        // Server at capacity — wait and retry indefinitely until a slot opens.
        await new Promise((r) => setTimeout(r, CAPACITY_WAIT));
        continue;
      }
      queue.shift();
      if (queue.length > 0) await new Promise((r) => setTimeout(r, 1_000));
    }
  };

  const handleDispatchAll = async () => {
    const ready = bulkItemsRef.current.filter((i) => i.status === 'parsed' && hasCallableNumber(i.parsed?.toNumber));
    if (ready.length === 0) return;
    setIsDispatching(true);
    try {
      await drainDispatch();
    } finally {
      setIsDispatching(false);
    }
  };

  // Queue a parsed item for scheduled chasing (POST /api/invoices) instead of dialing immediately.
  const queueBulkItem = async (uid: string): Promise<void> => {
    const item = bulkItemsRef.current.find((i) => i.uid === uid);
    if (!item?.parsed || !hasCallableNumber(item.parsed.toNumber)) return;
    setBulkItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, status: 'queueing' } : i)));
    try {
      const r = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // "Queue" = enqueue for the scheduler now (POST /api/invoices defaults to "stored",
        // so ask for "pending" explicitly to preserve the queue behaviour).
        body: JSON.stringify({ ...buildBulkBrief(item.parsed, item.storagePath), status: 'pending' }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      setBulkItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, status: 'queued' } : i)));
    } catch (err) {
      setBulkItems((prev) =>
        prev.map((i) => (i.uid === uid ? { ...i, status: 'dispatch-error', error: err instanceof Error ? err.message : 'Queue failed' } : i))
      );
    }
  };

  // Parse → resolve phone → dispatch (or queue) for each item as soon as it's ready.
  const runInvoicePipeline = async (uids: string[], mode: 'dispatch' | 'queue' = 'dispatch') => {
    const uidSet = new Set(uids);
    const targets = bulkItemsRef.current.filter((i) => uidSet.has(i.uid));

    let contactRows: ContactRow[] = [];
    try {
      const cr = await fetch('/api/contacts', { cache: 'no-store' });
      if (cr.ok) contactRows = (await cr.json()).rows ?? [];
    } catch {
      /* non-blocking */
    }

    const parsedResults = new Map<string, InvoiceParseResult>();
    const sem = createSemaphore(CONCURRENT_CALL_LIMIT);
    await Promise.all(
      targets.map((item) =>
        sem(async () => {
          if (bulkItemsRef.current.find((i) => i.uid === item.uid)?.status !== 'paused') {
            setBulkItems((prev) => prev.map((i) => (i.uid === item.uid ? { ...i, status: 'parsing' } : i)));
          }
          try {
            const file = await getBulkItemFile(item);

            // Ensure the PDF is in Supabase Storage. Storage-source items already have a
            // path; local uploads are uploaded now so they persist and can be linked.
            let storagePath = item.storagePath;
            if (item.source === 'upload' && !storagePath) {
              storagePath = (await uploadToStorage(file)) ?? undefined;
            }

            const formData = new FormData();
            formData.append('document', file);
            const r = await fetch('/api/calls/parse-document', { method: 'POST', body: formData });
            const payload = (await r.json()) as InvoiceParseResult & { error?: string };
            if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
            parsedResults.set(item.uid, payload);

            const match = contactRows.find((row) => companyNamesMatch(row.businessName, payload.contactBusiness ?? ''));
            const sheetPhone = match?.phone || null;
            const pdfPhone = hasCallableNumber(payload.toNumber) ? payload.toNumber : null;
            const phone = sheetPhone ?? pdfPhone;
            const person = match?.contactPerson || payload.contactPerson || null;

            if (!phone) {
              const updated: BulkItem = {
                ...item,
                storagePath,
                status: 'dispatch-error',
                error: 'No phone number found — add it in Contacts',
                phoneSource: 'none',
                parsed: payload,
              };
              bulkItemsRef.current = bulkItemsRef.current.map((i) => (i.uid === item.uid ? updated : i));
              setBulkItems((prev) => prev.map((i) => (i.uid === item.uid ? updated : i)));
              return;
            }

            // Preserve "paused" if the user clicked edit while this item was parsing.
            const wasPaused = bulkItemsRef.current.find((i) => i.uid === item.uid)?.status === 'paused';
            const resolved: BulkItem = {
              ...item,
              storagePath,
              status: wasPaused ? 'paused' : 'parsed',
              parsed: { ...payload, toNumber: phone, contactPerson: person },
              phoneSource: sheetPhone ? 'spreadsheet' : 'pdf',
            };
            bulkItemsRef.current = bulkItemsRef.current.map((i) => (i.uid === item.uid ? resolved : i));
            setBulkItems((prev) => prev.map((i) => (i.uid === item.uid ? resolved : i)));

            // Queue mode: just add to the scheduling queue and move on (no dialing).
            if (mode === 'queue') {
              if (bulkItemsRef.current.find((i) => i.uid === item.uid)?.status === 'paused') return;
              await queueBulkItem(item.uid);
              return;
            }

            // Dispatch immediately with backpressure retry.
            const CAPACITY_WAIT = 10_000;
            while (true) {
              // Honor a pause requested while this item was parsing/queued.
              if (bulkItemsRef.current.find((i) => i.uid === item.uid)?.status === 'paused') return;
              const result = await dispatchBulkItem(item.uid);
              if (result !== false) break;
              await new Promise((res) => setTimeout(res, CAPACITY_WAIT));
            }
          } catch (err) {
            setBulkItems((prev) =>
              prev.map((i) => (i.uid === item.uid ? { ...i, status: 'parse-error', error: err instanceof Error ? err.message : 'Read failed' } : i))
            );
          }
        })
      )
    );

    // Sync newly-discovered businesses to the spreadsheet for future use.
    const discovered = Array.from(parsedResults.values())
      .filter((p) => p.contactBusiness)
      .map((p) => ({
        businessName: p.contactBusiness!,
        abn: p.abn ?? null,
        contactPerson: p.contactPerson ?? null,
      }));
    if (discovered.length > 0) {
      fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: discovered }),
      }).catch((e) => console.error('[contacts sync] fetch error:', e));
    }
  };

  // One-click dispatch from the select-invoice screen. selectedUploadFiles are the files the user
  // checked in the upload tab — they haven't been added to bulkItems yet, so insert them (and the
  // ref) synchronously first.
  const handleSelectInvoiceDispatch = async (selectedUploadFiles: File[] = []) => {
    if (selectedUploadFiles.length > 0) {
      const seen = new Set(bulkItemsRef.current.map((i) => `${i.fileName}::${i.fileSize ?? ''}`));
      const newItems: BulkItem[] = selectedUploadFiles
        .filter((f) => !seen.has(`${f.name}::${f.size}`))
        .map((f) => ({
          uid: crypto.randomUUID(),
          source: 'upload' as BulkSource,
          file: f,
          fileName: f.name,
          fileSize: f.size,
          status: 'parsing' as BulkStatus,
        }));
      bulkItemsRef.current = [...bulkItemsRef.current, ...newItems];
      setBulkItems(bulkItemsRef.current);
    }
    if (bulkItemsRef.current.length === 0) return;
    setIsDispatching(true);
    try {
      // Parse + add to the scheduling queue; the worker dials within business hours.
      await runInvoicePipeline(bulkItemsRef.current.map((i) => i.uid), 'queue');
    } finally {
      setIsDispatching(false);
    }
  };

  const handleRetryFailed = async () => {
    const items = bulkItemsRef.current;
    const failed = (i: BulkItem) => i.status === 'dispatch-error' || i.callStatus === 'failed';
    // Items that already have a resolved phone but failed to dispatch or are paused → just re-drain.
    const redriveUids = items
      .filter((i) => (failed(i) || i.status === 'paused') && i.parsed && hasCallableNumber(i.parsed.toNumber))
      .map((i) => i.uid);
    // Items needing full re-processing: parse errors, "no phone" failures, or paused items whose
    // phone was blanked during editing (re-resolve from the sheet).
    const reprocessUids = items
      .filter(
        (i) =>
          i.status === 'parse-error' ||
          (failed(i) && !(i.parsed && hasCallableNumber(i.parsed.toNumber))) ||
          (i.status === 'paused' && !(i.parsed && hasCallableNumber(i.parsed.toNumber)))
      )
      .map((i) => i.uid);
    if (!redriveUids.length && !reprocessUids.length) return;
    setIsDispatching(true);
    try {
      if (redriveUids.length > 0) {
        const set = new Set(redriveUids);
        const next = bulkItemsRef.current.map((i) =>
          set.has(i.uid) ? { ...i, status: 'parsed' as BulkStatus, error: undefined, callId: undefined, callStatus: undefined, callOutcome: undefined } : i
        );
        bulkItemsRef.current = next;
        setBulkItems(next);
        await drainDispatch();
      }
      if (reprocessUids.length > 0) {
        await runInvoicePipeline(reprocessUids);
      }
    } finally {
      setIsDispatching(false);
    }
  };

  const handleRetryParseUid = async (uid: string) => {
    await runInvoicePipeline([uid], 'queue');
  };

  // ── Old InvoiceCompose "Details" edit flow (reviewBulkUid) ──────────────────────────────
  // Not wired up by either page per the current spec (the bulk page uses the summaryEditUid flow
  // below for its edit drawer instead), but kept intact for parity with demo2.0 and in case a
  // future screen needs the pre-dispatch "review a single item's details" entry point.

  const saveBulkDetails = (state: BulkFormState) => {
    const uid = reviewBulkUid;
    if (uid) {
      setBulkItems((prev) => prev.map((i) => (i.uid === uid && i.parsed ? { ...i, parsed: mergeStateIntoParsed(i.parsed, state) } : i)));
    }
    setReviewBulkUid(null);
  };

  const bulkDetailsDispatch = async (state: BulkFormState) => {
    const uid = reviewBulkUid;
    if (!uid) throw new Error('No bulk item selected');
    const item = bulkItemsRef.current.find((i) => i.uid === uid);
    const parsed = mergeStateIntoParsed(item?.parsed, state);
    const r = await fetch('/api/calls/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBulkBrief(parsed, item?.storagePath)),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error ?? `HTTP ${r.status}`);
    }
    const data = await r.json();
    setBulkItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, status: 'dispatched', callId: data.id, parsed } : i)));
    setReviewBulkUid(null);
  };

  const closeBulkDetails = () => {
    setReviewBulkUid(null);
  };

  // ── summaryEditUid edit flow — used by the bulk page's edit drawer ──────────────────────

  const openSummaryDetails = (uid: string) => {
    const next = bulkItemsRef.current.map((i) => (i.uid === uid ? { ...i, status: 'paused' as BulkStatus, error: undefined } : i));
    bulkItemsRef.current = next;
    setBulkItems(next);
    setSummaryEditUid(uid);
  };

  const saveSummaryDetails = (state: BulkFormState) => {
    const uid = summaryEditUid;
    if (uid) {
      setBulkItems((prev) =>
        prev.map((i) => (i.uid === uid && i.parsed ? { ...i, status: 'paused' as BulkStatus, parsed: mergeStateIntoParsed(i.parsed, state) } : i))
      );
    }
    setSummaryEditUid(null);
  };

  const summaryDetailsDispatch = async (state: BulkFormState) => {
    const uid = summaryEditUid;
    if (!uid) throw new Error('No bulk item selected');
    const item = bulkItemsRef.current.find((i) => i.uid === uid);
    const parsed = mergeStateIntoParsed(item?.parsed, state);
    setBulkItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, status: 'dispatching' as BulkStatus, error: undefined, parsed } : i)));
    try {
      const r = await fetch('/api/calls/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBulkBrief(parsed, item?.storagePath)),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setBulkItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, status: 'paused' as BulkStatus } : i)));
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json();
      setBulkItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, status: 'dispatched' as BulkStatus, callId: data.id } : i)));
      setSummaryEditUid(null);
    } catch (err) {
      setBulkItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, status: 'paused' as BulkStatus } : i)));
      throw err;
    }
  };

  const value: BulkIntakeValue = {
    bulkItems,
    isDispatching,
    driveFiles,
    driveLoading,
    driveError,
    loadDriveFiles,
    getBulkItemFile,
    toggleDriveItem,
    selectAllDrive,
    deselectAllDrive,
    parseBulkItem,
    handleBulkFiles,
    handleBulkFilesFromHome,
    handleRemoveBulkItem,
    dispatchBulkItem,
    drainDispatch,
    handleDispatchAll,
    queueBulkItem,
    runInvoicePipeline,
    handleSelectInvoiceDispatch,
    handleRetryFailed,
    handleRetryParseUid,
    reviewBulkUid,
    setReviewBulkUid,
    saveBulkDetails,
    bulkDetailsDispatch,
    closeBulkDetails,
    summaryEditUid,
    setSummaryEditUid,
    saveSummaryDetails,
    summaryDetailsDispatch,
    openSummaryDetails,
  };

  return <BulkIntakeContext.Provider value={value}>{children}</BulkIntakeContext.Provider>;
}

export function useBulkIntake(): BulkIntakeValue {
  const ctx = useContext(BulkIntakeContext);
  if (!ctx) throw new Error('useBulkIntake must be used within a BulkIntakeProvider');
  return ctx;
}
