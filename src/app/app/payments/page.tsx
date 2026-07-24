'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardBody } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { Badge } from '@/components/shared/Badge';
import { Drawer } from '@/components/shared/Drawer';
import { PanelSkeleton } from '@/components/shared/Skeleton';
import { useAddToast } from '@/components/shared/Toast';
import { IconPlus } from '@/components/shared/Icons';
import { fmtAmount, fmtWhen } from '@/lib/format';
import { fmtMoneyByCurrency, type MoneyByCurrency } from '@/lib/money';

type LedgerEntry = {
  id: string; source: 'ar' | 'inbound'; customerId: string | null; customerName: string | null;
  invoiceId: string | null; invoiceNumber: string | null; amount: number; currency: string | null;
  date: string; type: string | null; note: string | null;
};
type Summary = { totalReceived: number; totalCredits: number; outstanding: MoneyByCurrency; entryCount: number };
type OpenInvoice = { id: string; invoiceNumber: string | null; contactBusiness: string; amountDue: number | null; currency: string | null };

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'slate' }) {
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900';
  return (
    <Card>
      <CardBody>
        <p className="text-xs text-slate-400">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${color}`}>{value}</p>
      </CardBody>
    </Card>
  );
}

export default function PaymentsPage() {
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recording, setRecording] = useState(false);
  const addToast = useAddToast();

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/payments', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setLedger(data.ledger);
      setSummary(data.summary);
    } catch {
      setLedger([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!ledger || !summary) return <div className="p-8"><PanelSkeleton rows={4} /></div>;

  return (
    <div className="h-full flex flex-col">
      <header className="flex-none px-8 pt-8 pb-5 border-b border-slate-100 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Payments</h1>
          <p className="text-sm text-slate-500 mt-0.5">Received payments (AR) and inbound-initiated payments in one ledger.</p>
        </div>
        <Button variant="primary" icon={<IconPlus className="w-4 h-4" />} onClick={() => setRecording(true)}>Record payment</Button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label="Received" value={fmtAmount('AUD', summary.totalReceived) || '$0'} tone="emerald" />
          <StatTile label="Credits" value={fmtAmount('AUD', summary.totalCredits) || '$0'} tone="slate" />
          <StatTile label="Outstanding" value={fmtMoneyByCurrency(summary.outstanding ?? [])} tone="amber" />
        </div>

        {ledger.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-display text-lg italic text-slate-400 mb-1.5">No payments recorded yet.</p>
            <p className="text-sm text-slate-400">Record a received payment against an invoice to start the ledger.</p>
          </div>
        ) : (
          <Card>
            <CardBody className="p-0">
              <div className="divide-y divide-slate-50">
                {ledger.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {e.customerId ? (
                          <Link href={`/app/customers/${e.customerId}`} className="hover:underline">{e.customerName || 'Customer'}</Link>
                        ) : (e.customerName || 'Unknown')}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {e.invoiceNumber ? `Invoice ${e.invoiceNumber} · ` : ''}{fmtWhen(e.date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-none">
                      <Badge className={e.source === 'inbound' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}>
                        {e.source === 'inbound' ? 'inbound' : e.type || 'payment'}
                      </Badge>
                      <span className="text-sm font-semibold text-slate-800">{fmtAmount(e.currency, e.amount) || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      <Drawer open={recording} onClose={() => setRecording(false)} title="Record payment" width="max-w-md">
        {recording && (
          <RecordForm
            onDone={async () => { setRecording(false); await load(); }}
            onCancel={() => setRecording(false)}
            addToast={addToast}
          />
        )}
      </Drawer>
    </div>
  );
}

function RecordForm({ onDone, onCancel, addToast }: { onDone: () => void; onCancel: () => void; addToast: (m: string, t?: 'success' | 'error') => void }) {
  const [invoices, setInvoices] = useState<OpenInvoice[] | null>(null);
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentType, setPaymentType] = useState('bank transfer');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/invoices', { cache: 'no-store' });
        if (!r.ok) throw new Error();
        const data = await r.json();
        const open: OpenInvoice[] = (data.invoices ?? [])
          .filter((i: { status: string }) => ['pending', 'queued', 'calling', 'failed'].includes(i.status))
          .map((i: OpenInvoice) => ({ id: i.id, invoiceNumber: i.invoiceNumber, contactBusiness: i.contactBusiness, amountDue: i.amountDue, currency: i.currency }));
        setInvoices(open);
        if (open[0]) setInvoiceId(open[0].id);
      } catch {
        setInvoices([]);
      }
    })();
  }, []);

  const save = async () => {
    const amt = Number(amount);
    if (!invoiceId || !amt || amt <= 0) { addToast('Choose an invoice and a positive amount.', 'error'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, payAmount: amt, payDate, paymentType }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      addToast('Payment recorded.', 'success');
      onDone();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to record payment.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!invoices) return <PanelSkeleton rows={3} />;
  if (invoices.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-500">No open invoices to record a payment against.</p>
        <div className="flex justify-end"><Button variant="secondary" onClick={onCancel}>Close</Button></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Invoice</label>
        <select className="input" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
          {invoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.contactBusiness} — {i.invoiceNumber || 'no number'} ({fmtAmount(i.currency, i.amountDue) || '—'})
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Amount</label><input type="number" min={0} step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
        <div><label className="label">Date</label><input type="date" className="input" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
      </div>
      <div>
        <label className="label">Method</label>
        <select className="input" value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
          <option value="bank transfer">Bank transfer</option>
          <option value="card">Card</option>
          <option value="cash">Cash</option>
          <option value="cheque">Cheque</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving}>Record payment</Button>
      </div>
    </div>
  );
}
