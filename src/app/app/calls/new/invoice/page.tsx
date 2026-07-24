'use client';

// Standalone single-invoice call flow — ported from demo2.0's InvoiceCompose() (src/app/page.tsx
// lines 852-1492). Two stages: upload a PDF and parse it via Gemini, then review/edit the
// resulting brief in the shared InvoiceComposeForm before dispatching one call.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InvoiceComposeForm } from '@/components/shared/InvoiceComposeForm';
import { Button } from '@/components/shared/Button';
import { Card, CardBody } from '@/components/shared/Card';
import { IconArrowLeft } from '@/components/shared/Icons';
import { useAddToast } from '@/components/shared/Toast';
import { buildBulkBrief, type BulkFormState, type InvoiceParseResult } from '@/lib/client-types';
import { fmtBytes } from '@/lib/format';

export default function NewInvoiceCallPage() {
  const router = useRouter();
  const addToast = useAddToast();

  const [stage, setStage] = useState<'upload' | 'review'>('upload');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<InvoiceParseResult | null>(null);

  const parseInvoice = async () => {
    if (!documentFile || parsing) return;
    setParsing(true);
    setParseError(null);
    try {
      const formData = new FormData();
      formData.append('document', documentFile);

      const res = await fetch('/api/calls/parse-document', { method: 'POST', body: formData });
      const payload = (await res.json()) as InvoiceParseResult & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);

      let result: InvoiceParseResult = payload;

      // Non-blocking enhancement: if the PDF itself had no callable phone number, try
      // resolving one from the contacts spreadsheet before falling back to manual entry.
      if (!result.toNumber && result.contactBusiness) {
        try {
          const params = new URLSearchParams();
          params.set('contactBusiness', result.contactBusiness);
          if (result.invoiceNumber) params.set('invoiceNumber', result.invoiceNumber);
          const lookup = await fetch(`/api/contacts/lookup?${params}`);
          if (lookup.ok) {
            const data = (await lookup.json()) as { phone: string | null };
            if (data.phone) result = { ...result, toNumber: data.phone };
          }
        } catch {
          // non-blocking — leave field empty for manual entry
        }
      }

      setParsed(result);
      setStage('review');

      // Persist the uploaded invoice PERMANENTLY (status "stored") the moment it parses —
      // independent of whether the user goes on to dispatch. This uploads the PDF to Storage,
      // fills the invoice + line-item + customer tables, and makes it browsable under the
      // customer and dispatchable later with zero re-parse. Non-blocking: a failure here
      // never blocks the review/dispatch flow.
      try {
        const up = new FormData();
        up.append('document', documentFile);
        const upRes = await fetch('/api/files/upload', { method: 'POST', body: up });
        const sourceFilePath = upRes.ok ? (await upRes.json()).path : undefined;
        const save = await fetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...buildBulkBrief(result), sourceFilePath, status: 'stored' }),
        });
        if (save.ok) addToast('Invoice saved to the customer.', 'success');
      } catch {
        /* non-blocking — the invoice can still be dispatched from the review form */
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse invoice');
    } finally {
      setParsing(false);
    }
  };

  const dispatch = async (state: BulkFormState) => {
    const parsedForBrief: InvoiceParseResult = {
      vendorName: state.vendorName || null,
      contactBusiness: state.contactBusiness || null,
      contactPerson: state.contactPerson || null,
      toNumber: state.toNumber || null,
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

    const body = buildBulkBrief(parsedForBrief);

    const res = await fetch('/api/calls/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error ?? `HTTP ${res.status}`;
      addToast(msg, 'error');
      throw new Error(msg);
    }
    router.push(`/app/calls/live/${data.id}`);
  };

  return (
    <div className="h-full overflow-y-auto app-bg">
      <div className="max-w-2xl mx-auto px-8 py-10 pb-16">
        <button
          onClick={() => (stage === 'review' ? setStage('upload') : router.back())}
          className="btn-ghost -ml-3 mb-6"
        >
          <IconArrowLeft />
          Back
        </button>

        {stage === 'upload' && (
          <>
            <p className="smallcaps text-slate-400 mb-2">Invoice upload</p>
            <h1 className="font-display text-3xl font-light tracking-tight text-slate-900 mb-8">
              Upload the invoice, <span className="italic text-brand">then review the brief.</span>
            </h1>

            <Card>
              <CardBody className="p-6">
                <label className="label">PDF document</label>
                <p className="text-sm text-slate-400 mb-3">Select a single invoice to parse and dispatch.</p>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    setDocumentFile(e.target.files?.[0] ?? null);
                    setParseError(null);
                  }}
                  className="block w-full text-sm text-slate-600"
                />
                {documentFile && (
                  <p className="mt-3 text-sm text-slate-500">
                    {documentFile.name} · {fmtBytes(documentFile.size)}
                  </p>
                )}
                {parseError && (
                  <div className="mt-4 p-4 rounded-xl bg-brand-faint text-brand-dark text-sm leading-snug">
                    <strong className="block mb-1">Reading failed</strong>
                    {parseError}
                    <button onClick={parseInvoice} className="block mt-3 text-xs underline underline-offset-2">
                      Retry
                    </button>
                  </div>
                )}
              </CardBody>
            </Card>

            <div className="mt-6 flex justify-end">
              <Button
                variant="primary"
                disabled={!documentFile}
                loading={parsing}
                onClick={parseInvoice}
                className="px-8 py-3 rounded-full"
              >
                {parsing ? 'Reading invoice…' : 'Upload and read invoice'}
              </Button>
            </div>
          </>
        )}

        {stage === 'review' && parsed && (
          <>
            <p className="smallcaps text-slate-400 mb-2">New brief</p>
            <h1 className="font-display text-3xl font-light tracking-tight text-slate-900 mb-8">
              Review the details, <span className="italic text-brand">then dispatch Envoy.</span>
            </h1>

            <Card>
              <CardBody className="p-6">
                <InvoiceComposeForm
                  initial={parsed}
                  onCancel={() => router.push('/app/dashboard')}
                  onDispatch={dispatch}
                  dispatchLabel="Dispatch Envoy"
                />
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
