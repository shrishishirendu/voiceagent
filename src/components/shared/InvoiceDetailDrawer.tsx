'use client';

import { useCallback, useEffect, useState } from 'react';
import { Drawer } from './Drawer';
import { LoadingOverlay } from './Spinner';
import { InvoiceStatusBadge, type InvoiceStatus } from './Badge';
import { fmtAmount, fmtDate, fmtWhen } from '@/lib/format';

type LineItem = { id: string; description: string | null; quantity: number | null; unitPrice: number | null; lineTotal: number | null };
type PaymentRow = { id: string; payAmount: number; creditAmount: number; payDate: string | null; paymentType: string | null; createdAt: string };

type InvoiceDetail = {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  amountDue: number | null;
  totalAmount: number | null;
  paidAmount: number | null;
  currency: string | null;
  status: string;
  invoiceNotes: string | null;
  // banking (trimmed server-side for viewer/agent)
  bankName?: string | null;
  bsb?: string | null;
  accountNumber?: string | null;
  swiftCode?: string | null;
  remittanceName?: string | null;
  remittanceContact?: string | null;
  lineItems: LineItem[];
  payments: PaymentRow[];
};

type CustomerContact = {
  id: string;
  businessName: string;
  contactPerson: string | null;
  contactPhone?: string | null;
  email?: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postCode: string | null;
};

function Amount({ label, value, currency, accent }: { label: string; value: number | null | undefined; currency: string | null; accent?: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 tabular-nums ${accent ?? 'text-slate-900'}`}>{fmtAmount(currency, value ?? 0)}</p>
    </div>
  );
}

/**
 * Invoice detail slide-in — matches the accounts "Bill Settlement" view: amounts
 * (total / paid / balance / credit), the debtor contact block, line items, bank &
 * remittance details, and recorded payments. Fetches GET /api/invoices/[id].
 */
export function InvoiceDetailDrawer({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [customer, setCustomer] = useState<CustomerContact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/invoices/${invoiceId}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('load failed');
      const d = await r.json();
      setInvoice(d.invoice);
      setCustomer(d.customer);
    } catch {
      setError('Could not load this invoice.');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    if (!invoiceId) { setInvoice(null); setCustomer(null); setError(null); return; }
    load();
  }, [invoiceId, load]);

  if (invoiceId == null) return null;

  const cur = invoice?.currency ?? 'AUD';
  const total = invoice?.totalAmount ?? invoice?.amountDue ?? 0;
  const paid = invoice?.paidAmount ?? 0;
  const balance = Math.max(0, (invoice?.amountDue ?? 0) - paid);
  const credits = (invoice?.payments ?? []).reduce((s, p) => s + (p.creditAmount ?? 0), 0);
  const hasBank = !!(invoice && (invoice.bankName || invoice.bsb || invoice.accountNumber || invoice.swiftCode || invoice.remittanceName || invoice.remittanceContact));
  const address = customer ? [customer.addressLine, customer.city, customer.state, customer.postCode].filter(Boolean).join(', ') : '';

  return (
    <Drawer open={invoiceId != null} onClose={onClose} title={invoice?.invoiceNumber ? `Invoice #${invoice.invoiceNumber}` : 'Invoice'} width="max-w-xl">
      {loading && <LoadingOverlay message="Loading invoice…" />}
      {!loading && error && <div className="p-6 text-sm text-red-600">{error}</div>}

      {!loading && !error && invoice && (
        <div className="p-5 space-y-6">
          {/* Meta */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <InvoiceStatusBadge status={invoice.status as InvoiceStatus} />
            {invoice.invoiceDate && <span>Invoice date: {fmtDate(invoice.invoiceDate)}</span>}
            {invoice.dueDate && <span>Due: {fmtDate(invoice.dueDate)}</span>}
          </div>

          {/* Amounts */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-2xl border border-slate-100 p-4">
            <Amount label="Total" value={total} currency={cur} />
            <Amount label="Paid" value={paid} currency={cur} accent="text-emerald-700" />
            <Amount label="Balance" value={balance} currency={cur} accent={balance > 0 ? 'text-brand' : 'text-slate-900'} />
            <Amount label="Credit" value={credits} currency={cur} />
          </section>

          {/* Customer contact block */}
          {customer && (
            <section>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Customer</p>
              <p className="text-sm font-semibold text-slate-900">{customer.businessName}</p>
              {customer.contactPerson && <p className="text-sm text-slate-600 mt-0.5">{customer.contactPerson}</p>}
              <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                {customer.contactPhone && <p className="font-mono">{customer.contactPhone}</p>}
                {customer.email && <p>{customer.email}</p>}
                {address && <p>{address}</p>}
              </div>
            </section>
          )}

          {/* Line items */}
          {invoice.lineItems.length > 0 && (
            <section>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Line items</p>
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 bg-slate-50/60">
                      <th className="px-3 py-2 font-semibold">Description</th>
                      <th className="px-3 py-2 font-semibold text-right">Qty</th>
                      <th className="px-3 py-2 font-semibold text-right">Unit</th>
                      <th className="px-3 py-2 font-semibold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {invoice.lineItems.map((li) => (
                      <tr key={li.id}>
                        <td className="px-3 py-2 text-slate-700">{li.description || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{li.quantity ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{li.unitPrice != null ? fmtAmount(cur, li.unitPrice) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-800 font-medium">{li.lineTotal != null ? fmtAmount(cur, li.lineTotal) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Bank & remittance */}
          {hasBank && (
            <section>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Bank & remittance</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {invoice.bankName && <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Bank</p><p className="text-slate-800">{invoice.bankName}</p></div>}
                {invoice.bsb && <div><p className="text-[10px] uppercase tracking-wider text-slate-400">BSB</p><p className="text-slate-800 font-mono">{invoice.bsb}</p></div>}
                {invoice.accountNumber && <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Account</p><p className="text-slate-800 font-mono">{invoice.accountNumber}</p></div>}
                {invoice.swiftCode && <div><p className="text-[10px] uppercase tracking-wider text-slate-400">SWIFT</p><p className="text-slate-800 font-mono">{invoice.swiftCode}</p></div>}
                {invoice.remittanceName && <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Remittance</p><p className="text-slate-800">{invoice.remittanceName}</p></div>}
                {invoice.remittanceContact && <div><p className="text-[10px] uppercase tracking-wider text-slate-400">Remittance contact</p><p className="text-slate-800">{invoice.remittanceContact}</p></div>}
              </div>
            </section>
          )}

          {/* Payment history */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Payments</p>
            {invoice.payments.length === 0 ? (
              <p className="text-xs italic text-slate-400">No payments recorded yet.</p>
            ) : (
              <div className="space-y-1.5">
                {invoice.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm rounded-xl border border-slate-100 px-3 py-2">
                    <div>
                      <span className="text-slate-700 capitalize">{p.paymentType || 'payment'}</span>
                      <span className="text-xs text-slate-400 ml-2">{p.payDate ? fmtDate(p.payDate) : fmtWhen(p.createdAt)}</span>
                    </div>
                    <span className="font-mono text-slate-800 tabular-nums">{fmtAmount(cur, p.payAmount)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {invoice.invoiceNotes && (
            <section>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Notes</p>
              <p className="text-sm leading-relaxed text-slate-600">{invoice.invoiceNotes}</p>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
