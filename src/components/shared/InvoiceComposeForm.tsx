'use client';

// Shared review/edit form for a parsed invoice — ported from demo2.0's InvoiceCompose()
// review stage (src/app/page.tsx lines 852-1492). This component owns only the editable
// fields captured in BulkFormState (contact + invoice + payment details); it does not pick
// voice/manner or write the objective — those are fixed defaults applied by buildBulkBrief()
// at dispatch time (voice: "iris", manner: "warm", objective auto-generated).
//
// This component makes no network calls. Callers own persistence: `onSave` (optional) saves
// edits without dispatching, `onDispatch` (required) saves + dispatches/queues the call.

import { useState } from 'react';
import type { InvoiceParseResult, BulkFormState } from '@/lib/client-types';
import { hasCallableNumber } from '@/lib/format';
import { Button } from './Button';

export interface InvoiceComposeFormProps {
  initial: InvoiceParseResult;
  onCancel: () => void;
  onSave?: (state: BulkFormState) => void | Promise<void>;
  onDispatch: (state: BulkFormState) => void | Promise<void>;
  dispatchLabel?: string;
  saving?: boolean;
}

type ParsedLineItem = {
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
};

function parseLineItems(raw: string): ParsedLineItem[] | null {
  if (!raw) return null;
  try {
    const items = JSON.parse(raw);
    return Array.isArray(items) && items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

export function InvoiceComposeForm({
  initial,
  onCancel,
  onSave,
  onDispatch,
  dispatchLabel = 'Dispatch call',
  saving = false,
}: InvoiceComposeFormProps) {
  const [contactBusiness, setContactBusiness] = useState(initial.contactBusiness ?? '');
  const [contactPerson, setContactPerson] = useState(initial.contactPerson ?? '');
  const [vendorName, setVendorName] = useState(initial.vendorName ?? '');
  const [toNumber, setToNumber] = useState(initial.toNumber ?? '+61 ');
  const [invoiceNumber, setInvoiceNumber] = useState(initial.invoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(initial.invoiceDate ?? '');
  const [dueDate, setDueDate] = useState(initial.dueDate ?? '');
  const [amountDue, setAmountDue] = useState(initial.amountDue != null ? String(initial.amountDue) : '');
  const [currency, setCurrency] = useState(initial.currency ?? '');
  const [lineItems, setLineItems] = useState(initial.lineItems ?? '');
  const [invoiceNotes, setInvoiceNotes] = useState(initial.invoiceNotes ?? '');
  const [bankName, setBankName] = useState(initial.bankName ?? '');
  const [bsb, setBsb] = useState(initial.bsb ?? '');
  const [accountNumber, setAccountNumber] = useState(initial.accountNumber ?? '');
  const [swiftCode, setSwiftCode] = useState(initial.swiftCode ?? '');
  const [abn, setAbn] = useState(initial.abn ?? '');
  const [remittanceName, setRemittanceName] = useState(initial.remittanceName ?? '');
  const [remittanceContact, setRemittanceContact] = useState(initial.remittanceContact ?? '');

  const [dispatching, setDispatching] = useState(false);
  const [savingLocal, setSavingLocal] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const busy = saving || dispatching || savingLocal;

  const isValid = hasCallableNumber(toNumber) && !busy;

  const buildState = (): BulkFormState => ({
    contactBusiness: contactBusiness.trim(),
    contactPerson: contactPerson.trim(),
    vendorName: vendorName.trim(),
    toNumber: toNumber.trim(),
    invoiceNumber: invoiceNumber.trim(),
    invoiceDate: invoiceDate.trim(),
    dueDate: dueDate.trim(),
    amountDue: amountDue.trim(),
    currency: currency.trim(),
    lineItems,
    invoiceNotes: invoiceNotes.trim(),
    bankName: bankName.trim(),
    bsb: bsb.trim(),
    accountNumber: accountNumber.trim(),
    swiftCode: swiftCode.trim(),
    abn: abn.trim(),
    remittanceName: remittanceName.trim(),
    remittanceContact: remittanceContact.trim(),
  });

  const handleSave = async () => {
    if (!onSave || busy) return;
    setSaveError(null);
    setSavingLocal(true);
    try {
      await onSave(buildState());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingLocal(false);
    }
  };

  const handleDispatch = async () => {
    if (!isValid) return;
    setDispatchError(null);
    setDispatching(true);
    try {
      await onDispatch(buildState());
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : 'Failed to dispatch');
    } finally {
      setDispatching(false);
    }
  };

  const parsedLineItems = parseLineItems(lineItems);

  return (
    <div className="p-5 space-y-8">
      <div>
        <p className="smallcaps text-slate-400 mb-4">Call brief</p>
        <div className="space-y-4">
          <div>
            <label className="label">Number to call</label>
            <input
              type="tel"
              className="input font-mono"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              placeholder="+61 4..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Business</label>
              <input
                type="text"
                className="input"
                value={contactBusiness}
                onChange={(e) => setContactBusiness(e.target.value)}
                placeholder="e.g. Acme"
              />
            </div>
            <div>
              <label className="label">
                Contact person <span className="normal-case tracking-normal font-normal text-slate-300">· optional</span>
              </label>
              <input
                type="text"
                className="input"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                placeholder="e.g. Ameet"
              />
            </div>
          </div>
          <div>
            <label className="label">
              Your name / business <span className="normal-case tracking-normal font-normal text-slate-300">· how Envoy refers to you</span>
            </label>
            <input
              type="text"
              className="input"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="e.g. Suresh"
            />
          </div>
        </div>
      </div>

      <div>
        <p className="smallcaps text-slate-400 mb-4">Invoice details</p>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Invoice number</label>
              <input type="text" className="input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div>
              <label className="label">Invoice date</label>
              <input
                type="text"
                className="input"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </div>
            <div>
              <label className="label">Due date</label>
              <input
                type="text"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Amount due</label>
              <input type="text" className="input" value={amountDue} onChange={(e) => setAmountDue(e.target.value)} />
            </div>
            <div>
              <label className="label">Currency</label>
              <input
                type="text"
                className="input"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                placeholder="e.g. AUD"
              />
            </div>
          </div>

          <div>
            <label className="label">
              Line items <span className="normal-case tracking-normal font-normal text-slate-300">· JSON array or free text</span>
            </label>
            <textarea
              className="input font-mono text-xs resize-none leading-relaxed"
              rows={4}
              value={lineItems}
              onChange={(e) => setLineItems(e.target.value)}
              placeholder='e.g. [{"description":"Consulting","quantity":1,"unitPrice":500,"amount":500}]'
            />
          </div>

          {parsedLineItems && (
            <div>
              <label className="label">Line items preview</label>
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400">
                      <th className="text-left font-medium py-2 px-3">Description</th>
                      <th className="text-right font-medium py-2 px-3">Qty</th>
                      <th className="text-right font-medium py-2 px-3">Unit price</th>
                      <th className="text-right font-medium py-2 px-3">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedLineItems.map((item, i) => (
                      <tr key={i} className={i < parsedLineItems.length - 1 ? 'border-b border-slate-50' : ''}>
                        <td className="py-2 px-3 text-slate-700">{item.description ?? '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-700">{item.quantity ?? '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-700">
                          {item.unitPrice != null ? item.unitPrice.toLocaleString() : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-700">
                          {item.amount != null ? item.amount.toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <label className="label">Invoice notes</label>
            <textarea
              className="input resize-none leading-relaxed"
              rows={invoiceNotes ? 4 : 2}
              value={invoiceNotes}
              onChange={(e) => setInvoiceNotes(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div>
        <p className="smallcaps text-slate-400 mb-4">Payment details</p>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Bank name</label>
              <input
                type="text"
                className="input"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. Deutsche Bank AG"
              />
            </div>
            <div>
              <label className="label">BSB</label>
              <input type="text" className="input" value={bsb} onChange={(e) => setBsb(e.target.value)} placeholder="e.g. 414111" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Account number</label>
              <input
                type="text"
                className="input"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="e.g. 180010301"
              />
            </div>
            <div>
              <label className="label">SWIFT / BIC</label>
              <input
                type="text"
                className="input"
                value={swiftCode}
                onChange={(e) => setSwiftCode(e.target.value)}
                placeholder="e.g. DEUTAU2SGTB"
              />
            </div>
          </div>
          <div>
            <label className="label">ABN</label>
            <input type="text" className="input" value={abn} onChange={(e) => setAbn(e.target.value)} placeholder="e.g. 59 863 426 362" />
          </div>
          <div>
            <label className="label">Remit to (name)</label>
            <input
              type="text"
              className="input"
              value={remittanceName}
              onChange={(e) => setRemittanceName(e.target.value)}
              placeholder="e.g. Quest Software International Limited"
            />
          </div>
          <div>
            <label className="label">Remit to (contact)</label>
            <input
              type="text"
              className="input"
              value={remittanceContact}
              onChange={(e) => setRemittanceContact(e.target.value)}
              placeholder="Address or email for remittance advice"
            />
          </div>
        </div>
      </div>

      {(saveError || dispatchError) && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">
          {dispatchError && (
            <p>
              <strong className="font-semibold">Dispatch failed. </strong>
              {dispatchError}
            </p>
          )}
          {saveError && (
            <p>
              <strong className="font-semibold">Save failed. </strong>
              {saveError}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-100">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {onSave && (
          <Button type="button" variant="secondary" loading={savingLocal} disabled={busy && !savingLocal} onClick={handleSave}>
            Save
          </Button>
        )}
        <Button type="button" variant="primary" loading={dispatching} disabled={!isValid} onClick={handleDispatch}>
          {dispatchLabel}
        </Button>
      </div>
    </div>
  );
}
