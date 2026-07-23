'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, CardBody } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { Drawer } from '@/components/shared/Drawer';
import { Badge, Pill } from '@/components/shared/Badge';
import { PanelSkeleton } from '@/components/shared/Skeleton';
import { useAddToast } from '@/components/shared/Toast';
import { IconArrowLeft, IconEdit } from '@/components/shared/Icons';
import { fmtAmount, fmtDate, fmtWhen } from '@/lib/format';

type Detail = {
  customer: {
    id: string; businessName: string; contactPerson: string | null; contactPhone: string | null;
    email: string | null; abn: string | null; addressLine: string | null; city: string | null;
    state: string | null; postCode: string | null; deliveryInstructions: string | null;
    isActive: boolean; invoiceCount: number; openInvoiceCount: number; ticketCount: number;
    callCount: number; outstanding: number;
  };
  invoices: { id: string; invoiceNumber: string | null; invoiceDate: string | null; dueDate: string | null; amountDue: number | null; currency: string | null; status: string; sourceFilePath: string | null; toNumber: string | null; groupKey: string }[];
  tickets: { id: string; title: string | null; channel: string; status: string; tags: string[]; aiSummary: string | null; createdAt: string }[];
  calls: { id: string; contactBusiness: string; status: string; outcome: string | null; summary: string | null; durationSec: number | null; createdAt: string }[];
};

type Tab = 'invoices' | 'tickets' | 'calls' | 'payments';
type PaymentEntry = { id: string; source: 'ar' | 'inbound'; invoiceNumber: string | null; amount: number; currency: string | null; date: string; type: string | null };

const STATUS_CLS: Record<string, string> = {
  stored: 'bg-slate-100 text-slate-600',
  pending: 'bg-amber-50 text-amber-700', queued: 'bg-sky-50 text-sky-700', calling: 'bg-indigo-50 text-indigo-700',
  resolved: 'bg-emerald-50 text-emerald-700', failed: 'bg-rose-50 text-rose-700', cancelled: 'bg-slate-100 text-slate-500',
  Incoming: 'bg-amber-50 text-amber-700', 'In Progress': 'bg-indigo-50 text-indigo-700', Resolved: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-emerald-50 text-emerald-700', success: 'bg-emerald-50 text-emerald-700', 'no-answer': 'bg-slate-100 text-slate-500', partial: 'bg-amber-50 text-amber-700',
};
function StatusPill({ status }: { status: string }) {
  return <Badge className={STATUS_CLS[status] ?? 'bg-slate-100 text-slate-500'}>{status}</Badge>;
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const addToast = useAddToast();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>('invoices');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState<PaymentEntry[] | null>(null);

  const loadPayments = useCallback(async () => {
    if (!id) return;
    try {
      const r = await fetch(`/api/payments?customerId=${id}`, { cache: 'no-store' });
      if (r.ok) setPayments((await r.json()).ledger ?? []);
    } catch {
      setPayments([]);
    }
  }, [id]);

  useEffect(() => {
    if (tab === 'payments' && payments === null) loadPayments();
  }, [tab, payments, loadPayments]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await fetch(`/api/customers/${id}`, { cache: 'no-store' });
      if (r.status === 404) { setNotFound(true); return; }
      if (r.ok) setData(await r.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const [invBusy, setInvBusy] = useState<string | null>(null);

  const enqueueInvoice = useCallback(async (invId: string, dispatchNow: boolean, groupKey: string, toNumber: string | null) => {
    if (!toNumber) { addToast('This invoice has no phone number — add one via Edit first.', 'error'); return; }
    setInvBusy(invId);
    try {
      const patch = await fetch(`/api/invoices/${invId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending', chaseAfter: new Date().toISOString() }),
      });
      if (!patch.ok) throw new Error('enqueue failed');
      if (dispatchNow) {
        const r = await fetch('/api/invoices/dispatch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupKey }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.dispatched > 0) addToast('Call dispatched.', 'success');
        else addToast(j.reason || j.errors?.[0] || 'Queued — will dial in business hours.', 'info');
      } else {
        addToast('Invoice queued for chasing.', 'success');
      }
      await load();
    } catch (e) {
      console.error(e);
      addToast('Action failed.', 'error');
    } finally {
      setInvBusy(null);
    }
  }, [addToast, load]);

  if (loading) return <div className="p-8"><PanelSkeleton /></div>;
  if (notFound || !data) {
    return (
      <div className="p-8 text-center py-20">
        <p className="font-display text-lg italic text-slate-400 mb-3">Customer not found.</p>
        <Link href="/app/customers"><Button variant="secondary">Back to customers</Button></Link>
      </div>
    );
  }

  const c = data.customer;
  const address = [c.addressLine, c.city, c.state, c.postCode].filter(Boolean).join(', ');
  const counts: Record<Tab, number> = { invoices: data.invoices.length, tickets: data.tickets.length, calls: data.calls.length, payments: 0 };

  return (
    <div className="h-full flex flex-col">
      <header className="flex-none px-8 pt-8 pb-5 border-b border-slate-100">
        <Link href="/app/customers" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-3">
          <IconArrowLeft className="w-4 h-4" /> Customers
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold text-slate-900 tracking-tight truncate">{c.businessName}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {[c.contactPerson, c.contactPhone, c.abn ? `ABN ${c.abn}` : null].filter(Boolean).join(' · ') || 'No contact details yet'}
            </p>
            {address && <p className="mt-0.5 text-sm text-slate-400">{address}</p>}
            {c.deliveryInstructions && <p className="mt-0.5 text-xs text-slate-400 italic">Delivery: {c.deliveryInstructions}</p>}
          </div>
          <div className="flex-none flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-slate-400">Outstanding</p>
              <p className="text-lg font-semibold text-slate-900">{c.outstanding > 0 ? fmtAmount('AUD', c.outstanding) : '—'}</p>
            </div>
            <Button variant="secondary" icon={<IconEdit className="w-4 h-4" />} onClick={() => setEditing(true)}>Edit</Button>
          </div>
        </div>

        <div className="mt-5 flex gap-1">
          {(['invoices', 'tickets', 'calls', 'payments'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${tab === t ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              {t} {t !== 'payments' && <span className={tab === t ? 'text-white/60' : 'text-slate-400'}>{counts[t]}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
        {tab === 'invoices' && (
          <TabList empty={data.invoices.length === 0} emptyText="No invoices for this customer.">
            {data.invoices.map((inv) => {
              const canDispatch = inv.status === 'stored' || inv.status === 'pending';
              return (
                <div key={inv.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{inv.invoiceNumber || 'No number'}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{inv.dueDate ? `Due ${fmtDate(inv.dueDate)}` : 'No due date'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {inv.sourceFilePath && (
                      <a
                        href={`/api/files/invoice?path=${encodeURIComponent(inv.sourceFilePath)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-slate-400 hover:text-brand transition-colors"
                        title="Open the stored PDF"
                      >
                        PDF
                      </a>
                    )}
                    <span className="text-sm font-medium text-slate-800">{fmtAmount(inv.currency, inv.amountDue) || '—'}</span>
                    <StatusPill status={inv.status} />
                    {canDispatch && (
                      <div className="flex items-center gap-1.5">
                        {inv.status === 'stored' && (
                          <button
                            className="btn-ghost text-xs !py-1 !px-2"
                            disabled={invBusy === inv.id}
                            onClick={() => enqueueInvoice(inv.id, false, inv.groupKey, inv.toNumber)}
                          >
                            {invBusy === inv.id ? '…' : 'Queue'}
                          </button>
                        )}
                        <button
                          className="btn-secondary text-xs !py-1 !px-2"
                          disabled={invBusy === inv.id}
                          onClick={() => enqueueInvoice(inv.id, true, inv.groupKey, inv.toNumber)}
                        >
                          {invBusy === inv.id ? '…' : 'Call now'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </TabList>
        )}

        {tab === 'tickets' && (
          <TabList empty={data.tickets.length === 0} emptyText="No tickets for this customer.">
            {data.tickets.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{t.title || 'Ticket'}</p>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{t.aiSummary || fmtWhen(t.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {t.tags.includes('outbound') && <Pill>outbound</Pill>}
                  {t.tags.includes('inbound') && <Pill>inbound</Pill>}
                  <StatusPill status={t.status} />
                </div>
              </div>
            ))}
          </TabList>
        )}

        {tab === 'calls' && (
          <TabList empty={data.calls.length === 0} emptyText="No calls for this customer.">
            {data.calls.map((call) => (
              <Link key={call.id} href={`/app/calls/live/${call.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{call.summary || call.contactBusiness}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{fmtWhen(call.createdAt)}{call.durationSec ? ` · ${call.durationSec}s` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {call.outcome && <StatusPill status={call.outcome} />}
                  <StatusPill status={call.status} />
                </div>
              </Link>
            ))}
          </TabList>
        )}

        {tab === 'payments' && (
          payments === null ? (
            <PanelSkeleton rows={3} />
          ) : (
            <TabList empty={payments.length === 0} emptyText="No payments recorded for this customer.">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{p.invoiceNumber ? `Invoice ${p.invoiceNumber}` : (p.source === 'inbound' ? 'Inbound payment' : 'Payment')}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{fmtWhen(p.date)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={p.source === 'inbound' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}>{p.source === 'inbound' ? 'inbound' : p.type || 'payment'}</Badge>
                    <span className="text-sm font-semibold text-slate-800">{fmtAmount(p.currency, p.amount) || '—'}</span>
                  </div>
                </div>
              ))}
            </TabList>
          )
        )}
      </div>

      <Drawer open={editing} onClose={() => setEditing(false)} title="Edit customer" width="max-w-lg">
        {editing && (
          <EditForm
            customer={c}
            saving={saving}
            onCancel={() => setEditing(false)}
            onSave={async (patch) => {
              setSaving(true);
              try {
                const r = await fetch(`/api/customers/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
                if (!r.ok) throw new Error('save failed');
                addToast('Customer updated.', 'success');
                setEditing(false);
                await load();
              } catch (e) {
                console.error(e);
                addToast('Failed to save.', 'error');
              } finally {
                setSaving(false);
              }
            }}
          />
        )}
      </Drawer>
    </div>
  );
}

function TabList({ children, empty, emptyText }: { children: React.ReactNode; empty: boolean; emptyText: string }) {
  if (empty) return <div className="text-center py-16"><p className="font-display text-base italic text-slate-400">{emptyText}</p></div>;
  return (
    <Card><CardBody className="p-0"><div className="divide-y divide-slate-50">{children}</div></CardBody></Card>
  );
}

type EditPatch = {
  businessName: string; contactPerson: string | null; contactPhone: string | null; email: string | null;
  abn: string | null; addressLine: string | null; city: string | null; state: string | null;
  postCode: string | null; deliveryInstructions: string | null;
};

function EditForm({ customer, saving, onCancel, onSave }: { customer: Detail['customer']; saving: boolean; onCancel: () => void; onSave: (p: EditPatch) => void }) {
  const [s, setS] = useState({
    businessName: customer.businessName ?? '', contactPerson: customer.contactPerson ?? '', contactPhone: customer.contactPhone ?? '',
    email: customer.email ?? '', abn: customer.abn ?? '', addressLine: customer.addressLine ?? '', city: customer.city ?? '',
    state: customer.state ?? '', postCode: customer.postCode ?? '', deliveryInstructions: customer.deliveryInstructions ?? '',
  });
  const set = (k: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS((v) => ({ ...v, [k]: e.target.value }));
  return (
    <div className="space-y-4">
      <div><label className="label">Business name</label><input className="input" value={s.businessName} onChange={set('businessName')} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Contact person</label><input className="input" value={s.contactPerson} onChange={set('contactPerson')} /></div>
        <div><label className="label">Phone</label><input className="input" value={s.contactPhone} onChange={set('contactPhone')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">ABN</label><input className="input" value={s.abn} onChange={set('abn')} /></div>
        <div><label className="label">Email</label><input className="input" value={s.email} onChange={set('email')} /></div>
      </div>
      <div><label className="label">Delivery address</label><input className="input" value={s.addressLine} onChange={set('addressLine')} /></div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="label">City</label><input className="input" value={s.city} onChange={set('city')} /></div>
        <div><label className="label">State</label><input className="input" value={s.state} onChange={set('state')} /></div>
        <div><label className="label">Postcode</label><input className="input" value={s.postCode} onChange={set('postCode')} /></div>
      </div>
      <div><label className="label">Delivery instructions</label><textarea className="input min-h-[64px]" value={s.deliveryInstructions} onChange={set('deliveryInstructions')} /></div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={s.businessName.trim().length === 0 || saving}
          onClick={() => onSave({
            businessName: s.businessName,
            contactPerson: s.contactPerson || null, contactPhone: s.contactPhone || null, email: s.email || null,
            abn: s.abn || null, addressLine: s.addressLine || null, city: s.city || null, state: s.state || null,
            postCode: s.postCode || null, deliveryInstructions: s.deliveryInstructions || null,
          })}
        >Save</Button>
      </div>
    </div>
  );
}
