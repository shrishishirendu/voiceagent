'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, CardBody } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { Drawer } from '@/components/shared/Drawer';
import { Modal } from '@/components/shared/Modal';
import { InvoiceDetailDrawer } from '@/components/shared/InvoiceDetailDrawer';
import { Badge, Pill } from '@/components/shared/Badge';
import { PanelSkeleton } from '@/components/shared/Skeleton';
import { useAddToast } from '@/components/shared/Toast';
import { IconArrowLeft, IconEdit } from '@/components/shared/Icons';
import { fmtAmount, fmtDate, fmtWhen, hasCallableNumber } from '@/lib/format';
import { fmtMoneyByCurrency, totalMoneyMagnitude, type MoneyByCurrency } from '@/lib/money';

type CustomerFields = {
  id: string; accountCode: string | null; businessName: string; contactPerson: string | null; contactPhone: string | null;
  email: string | null; email2: string | null; abn: string | null; addressLine: string | null; city: string | null;
  state: string | null; postCode: string | null; deliveryInstructions: string | null;
  paymentTermsDays: number | null; creditLimit: number | null; balanceAmount: number;
  ignoreMinPrice: boolean; ignoreProductMinPrice: boolean; hideInvoice: boolean; isActive: boolean;
  salesPersonId: string | null; salesPersonName: string | null;
  locationId: string | null; locationCode: string | null; locationName: string | null;
  invoiceCount: number; openInvoiceCount: number; ticketCount: number; callCount: number; outstanding: MoneyByCurrency;
};

type Detail = {
  customer: CustomerFields;
  invoices: { id: string; invoiceNumber: string | null; invoiceDate: string | null; dueDate: string | null; amountDue: number | null; totalAmount: number | null; paidAmount: number | null; currency: string | null; status: string; sourceFilePath: string | null; toNumber: string | null; groupKey: string }[];
  tickets: { id: string; title: string | null; channel: string; status: string; tags: string[]; aiSummary: string | null; createdAt: string }[];
  calls: { id: string; contactBusiness: string; status: string; outcome: string | null; summary: string | null; durationSec: number | null; createdAt: string }[];
};

type Tab = 'details' | 'invoices' | 'tickets' | 'calls' | 'payments';
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
  const [tab, setTab] = useState<Tab>('details');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState<PaymentEntry[] | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState<string | null>(null);

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
  // Inline "we need a number before we can dial" prompt — replaces the old dead-end toast
  // that told the user to edit the invoice on a tab that has no edit control.
  const [phonePrompt, setPhonePrompt] = useState<{ invId: string; dispatchNow: boolean } | null>(null);
  const [promptNumber, setPromptNumber] = useState('+61 ');
  const [promptSaveDefault, setPromptSaveDefault] = useState(true);

  // `override`, when set, is dialed for THIS call only — it is never written to the invoice.
  // It only becomes permanent if the user asked to save it as the customer's default.
  const runEnqueue = useCallback(async (invId: string, dispatchNow: boolean, override: string | null, saveAsDefault: boolean) => {
    setInvBusy(invId);
    try {
      if (saveAsDefault && override && id) {
        const cr = await fetch(`/api/customers/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactPhone: override }),
        });
        if (!cr.ok) {
          const b = await cr.json().catch(() => ({}));
          throw new Error(b.error || 'Could not save the default number.');
        }
      }
      const patch = await fetch(`/api/invoices/${invId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending', chaseAfter: new Date().toISOString() }),
      });
      if (!patch.ok) {
        const b = await patch.json().catch(() => ({}));
        throw new Error(b.error || `Could not queue this invoice (HTTP ${patch.status}).`);
      }
      if (dispatchNow) {
        const r = await fetch('/api/invoices/dispatch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId: invId, ...(override ? { toNumber: override } : {}) }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Dispatch failed (HTTP ${r.status}).`);
        if (j.errors?.length) throw new Error(j.errors[0]);
        if (j.dispatched > 0) addToast('Call dispatched.', 'success');
        else addToast(j.reason || 'Queued — will dial in business hours.', 'info');
      } else {
        addToast('Invoice queued for chasing.', 'success');
      }
      await load();
    } catch (e) {
      console.error(e);
      addToast(e instanceof Error ? e.message : 'Action failed.', 'error');
    } finally {
      setInvBusy(null);
    }
  }, [addToast, load, id]);

  const enqueueInvoice = useCallback((invId: string, dispatchNow: boolean, toNumber: string | null) => {
    // The customer's master number is the primary; the invoice's own is the fallback. Only
    // when neither exists do we have to ask (the dispatcher applies the same precedence).
    if (!(data?.customer.contactPhone || toNumber)) {
      setPromptNumber('+61 ');
      setPromptSaveDefault(true);
      setPhonePrompt({ invId, dispatchNow });
      return;
    }
    runEnqueue(invId, dispatchNow, null, false);
  }, [data, runEnqueue]);

  // Reconcile — mark an invoice as paid. Records a payment for the remaining balance, which
  // advances paidAmount and flips the invoice to resolved (so it drops out of Outstanding).
  const markPaid = useCallback(async (invId: string, remaining: number) => {
    setInvBusy(invId);
    try {
      const r = await fetch('/api/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invId, payAmount: remaining, paymentType: 'reconciled' }),
      });
      if (!r.ok) throw new Error('mark-paid failed');
      addToast('Invoice marked as paid.', 'success');
      setPayments(null); // force payments sub-tab to refetch
      await load();
    } catch (e) {
      console.error(e);
      addToast('Could not mark as paid.', 'error');
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
  const counts: Record<Tab, number> = { details: 0, invoices: data.invoices.length, tickets: data.tickets.length, calls: data.calls.length, payments: 0 };

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
              <p className="text-lg font-semibold text-slate-900">{totalMoneyMagnitude(c.outstanding ?? []) > 0 ? fmtMoneyByCurrency(c.outstanding) : '—'}</p>
            </div>
            <Button variant="secondary" icon={<IconEdit className="w-4 h-4" />} onClick={() => setEditing(true)}>Edit</Button>
          </div>
        </div>

        <div className="mt-5 flex gap-1">
          {(['details', 'invoices', 'tickets', 'calls', 'payments'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${tab === t ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              {t} {t !== 'payments' && t !== 'details' && <span className={tab === t ? 'text-white/60' : 'text-slate-400'}>{counts[t]}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
        {tab === 'details' && <DetailsTab c={c} />}

        {tab === 'invoices' && (
          <TabList empty={data.invoices.length === 0} emptyText="No invoices for this customer.">
            {data.invoices.map((inv) => {
              const canDispatch = inv.status === 'stored' || inv.status === 'pending';
              const paid = inv.paidAmount ?? 0;
              const total = inv.totalAmount ?? inv.amountDue ?? 0;
              const remaining = Math.max(0, (inv.amountDue ?? 0) - paid);
              const canMarkPaid = inv.status !== 'cancelled' && remaining > 0;
              return (
                <div key={inv.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <button onClick={() => setInvoiceOpen(inv.id)} className="min-w-0 flex-1 text-left group">
                    <p className="text-sm font-medium text-slate-900 truncate group-hover:text-brand transition-colors">{inv.invoiceNumber || 'No number'}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {inv.invoiceDate ? fmtDate(inv.invoiceDate) : 'No date'}
                      {inv.dueDate ? ` · due ${fmtDate(inv.dueDate)}` : ''}
                    </p>
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="hidden md:flex items-center gap-5 text-right">
                      <div><p className="text-[9px] uppercase tracking-wider text-slate-400">Total</p><p className="text-sm text-slate-800 tabular-nums">{fmtAmount(inv.currency, total) || '—'}</p></div>
                      <div><p className="text-[9px] uppercase tracking-wider text-slate-400">Paid</p><p className="text-sm text-emerald-700 tabular-nums">{fmtAmount(inv.currency, paid) || '—'}</p></div>
                      <div><p className="text-[9px] uppercase tracking-wider text-slate-400">Balance</p><p className={`text-sm tabular-nums ${remaining > 0 ? 'text-brand' : 'text-slate-800'}`}>{fmtAmount(inv.currency, remaining) || '—'}</p></div>
                    </div>
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
                    <StatusPill status={inv.status} />
                    <div className="flex items-center gap-1.5">
                      {canDispatch && inv.status === 'stored' && (
                        <button
                          className="btn-ghost text-xs !py-1 !px-2"
                          disabled={invBusy === inv.id}
                          onClick={() => enqueueInvoice(inv.id, false, inv.toNumber)}
                        >
                          {invBusy === inv.id ? '…' : 'Queue'}
                        </button>
                      )}
                      {canDispatch && (
                        <button
                          className="btn-secondary text-xs !py-1 !px-2"
                          disabled={invBusy === inv.id}
                          onClick={() => enqueueInvoice(inv.id, true, inv.toNumber)}
                        >
                          {invBusy === inv.id ? '…' : 'Call now'}
                        </button>
                      )}
                      {canMarkPaid && (
                        <button
                          className="btn-ghost text-xs !py-1 !px-2 text-emerald-700 hover:bg-emerald-50"
                          disabled={invBusy === inv.id}
                          onClick={() => markPaid(inv.id, remaining)}
                          title="Reconcile — record full payment and clear from Outstanding"
                        >
                          {invBusy === inv.id ? '…' : 'Mark paid'}
                        </button>
                      )}
                    </div>
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

      <Modal
        open={!!phonePrompt}
        onClose={() => setPhonePrompt(null)}
        title={phonePrompt?.dispatchNow ? 'Number to call' : 'Number to chase on'}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500 leading-relaxed">
            Neither this invoice nor {c.businessName} has a phone number on file. Enter one to continue.
          </p>
          <div>
            <label className="label">Number</label>
            <input
              type="tel"
              className="input font-mono"
              value={promptNumber}
              onChange={(e) => setPromptNumber(e.target.value)}
              placeholder="+61 4..."
              autoFocus
            />
          </div>
          {phonePrompt?.dispatchNow ? (
            <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-brand"
                checked={promptSaveDefault}
                onChange={(e) => setPromptSaveDefault(e.target.checked)}
              />
              <span>
                Also save as {c.businessName}&rsquo;s default number
                <span className="block text-slate-400">
                  Leave unticked to use it for this call only — nothing is written to the invoice either way.
                </span>
              </span>
            </label>
          ) : (
            // Queue-only: there's no call to scope the number to, so it has to be saved
            // somewhere or the invoice would sit in the queue undialable.
            <p className="text-xs text-slate-400 leading-relaxed">
              This will be saved as {c.businessName}&rsquo;s default number so the scheduler can reach them.
              The invoice itself is not modified.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setPhonePrompt(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!hasCallableNumber(promptNumber)}
              onClick={() => {
                if (!phonePrompt) return;
                const { invId, dispatchNow } = phonePrompt;
                setPhonePrompt(null);
                runEnqueue(invId, dispatchNow, promptNumber.trim(), dispatchNow ? promptSaveDefault : true);
              }}
            >
              {phonePrompt?.dispatchNow ? 'Call now' : 'Queue'}
            </Button>
          </div>
        </div>
      </Modal>

      <InvoiceDetailDrawer invoiceId={invoiceOpen} onClose={() => setInvoiceOpen(null)} />

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

// ── Details tab — the full customer record, grouped like the accounts master ──
function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-sm text-slate-800 mt-0.5 ${mono ? 'font-mono' : ''}`}>{empty ? <span className="text-slate-300">—</span> : value}</p>
    </div>
  );
}

function FlagBadge({ on }: { on: boolean }) {
  return <Badge className={on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}>{on ? 'Yes' : 'No'}</Badge>;
}

function InfoGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-4">{title}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">{children}</div>
      </CardBody>
    </Card>
  );
}

function DetailsTab({ c }: { c: CustomerFields }) {
  return (
    <div className="space-y-4 max-w-4xl">
      <InfoGroup title="Identity">
        <Field label="Account #" value={c.accountCode} mono />
        <Field label="Party name" value={c.businessName} />
        <Field label="Status" value={<Badge className={c.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}>{c.isActive ? 'Active' : 'Inactive'}</Badge>} />
        <Field label="Shop / location" value={c.locationName ? `${c.locationName}${c.locationCode ? ` (${c.locationCode})` : ''}` : c.locationCode} />
        <Field label="Sales person" value={c.salesPersonName} />
        <Field label="Hide invoice" value={<FlagBadge on={c.hideInvoice} />} />
      </InfoGroup>

      <InfoGroup title="Contact">
        <Field label="Person name" value={c.contactPerson} />
        <Field label="Contact #" value={c.contactPhone} mono />
        <Field label="Email 1" value={c.email} />
        <Field label="Email 2" value={c.email2} />
        <Field label="ABN" value={c.abn} mono />
      </InfoGroup>

      <InfoGroup title="Address">
        <Field label="Address line" value={c.addressLine} />
        <Field label="City" value={c.city} />
        <Field label="State" value={c.state} />
        <Field label="Post code" value={c.postCode} mono />
        <Field label="Delivery instructions" value={c.deliveryInstructions} />
      </InfoGroup>

      <InfoGroup title="Commercial">
        <Field label="Terms" value={c.paymentTermsDays != null ? `${c.paymentTermsDays} days` : null} />
        <Field label="Credit / outstanding limit" value={c.creditLimit != null ? fmtAmount('AUD', c.creditLimit) : null} />
        <Field label="Balance amount" value={fmtAmount('AUD', c.balanceAmount)} />
        <Field label="Outstanding" value={totalMoneyMagnitude(c.outstanding ?? []) > 0 ? fmtMoneyByCurrency(c.outstanding) : '—'} />
        <Field label="Ignore min price" value={<FlagBadge on={c.ignoreMinPrice} />} />
        <Field label="Ignore product min price" value={<FlagBadge on={c.ignoreProductMinPrice} />} />
      </InfoGroup>
    </div>
  );
}

type EditPatch = {
  businessName: string; accountCode: string | null; contactPerson: string | null; contactPhone: string | null;
  email: string | null; email2: string | null; abn: string | null; addressLine: string | null; city: string | null;
  state: string | null; postCode: string | null; deliveryInstructions: string | null;
  paymentTermsDays: number | null; creditLimit: number | null;
  ignoreMinPrice: boolean; ignoreProductMinPrice: boolean; hideInvoice: boolean; isActive: boolean;
  salesPersonId: string | null; locationId: string | null;
};

type RefOption = { id: string; label: string };

function EditForm({ customer, saving, onCancel, onSave }: { customer: CustomerFields; saving: boolean; onCancel: () => void; onSave: (p: EditPatch) => void }) {
  const [s, setS] = useState({
    businessName: customer.businessName ?? '', accountCode: customer.accountCode ?? '',
    contactPerson: customer.contactPerson ?? '', contactPhone: customer.contactPhone ?? '',
    email: customer.email ?? '', email2: customer.email2 ?? '', abn: customer.abn ?? '',
    addressLine: customer.addressLine ?? '', city: customer.city ?? '', state: customer.state ?? '', postCode: customer.postCode ?? '',
    deliveryInstructions: customer.deliveryInstructions ?? '',
    paymentTermsDays: customer.paymentTermsDays != null ? String(customer.paymentTermsDays) : '',
    creditLimit: customer.creditLimit != null ? String(customer.creditLimit) : '',
    salesPersonId: customer.salesPersonId ?? '', locationId: customer.locationId ?? '',
  });
  const [flags, setFlags] = useState({
    ignoreMinPrice: customer.ignoreMinPrice, ignoreProductMinPrice: customer.ignoreProductMinPrice,
    hideInvoice: customer.hideInvoice, isActive: customer.isActive,
  });
  const [salesPeople, setSalesPeople] = useState<RefOption[]>([]);
  const [locations, setLocations] = useState<RefOption[]>([]);

  useEffect(() => {
    fetch('/api/salespersons', { cache: 'no-store' }).then((r) => r.json()).then((d) => setSalesPeople((d.salesPersons ?? []).map((x: { id: string; name: string }) => ({ id: x.id, label: x.name })))).catch(() => {});
    fetch('/api/locations', { cache: 'no-store' }).then((r) => r.json()).then((d) => setLocations((d.locations ?? []).map((x: { id: string; code: string; name: string }) => ({ id: x.id, label: `${x.name}${x.code ? ` (${x.code})` : ''}` })))).catch(() => {});
  }, []);

  const set = (k: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setS((v) => ({ ...v, [k]: e.target.value }));
  const toggle = (k: keyof typeof flags) => setFlags((v) => ({ ...v, [k]: !v[k] }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Account #</label><input className="input" value={s.accountCode} onChange={set('accountCode')} /></div>
        <div><label className="label">Business name</label><input className="input" value={s.businessName} onChange={set('businessName')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Sales person</label>
          <select className="input" value={s.salesPersonId} onChange={set('salesPersonId')}>
            <option value="">—</option>
            {salesPeople.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div><label className="label">Shop / location</label>
          <select className="input" value={s.locationId} onChange={set('locationId')}>
            <option value="">—</option>
            {locations.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Contact person</label><input className="input" value={s.contactPerson} onChange={set('contactPerson')} /></div>
        <div><label className="label">Phone</label><input className="input" value={s.contactPhone} onChange={set('contactPhone')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Email 1</label><input className="input" value={s.email} onChange={set('email')} /></div>
        <div><label className="label">Email 2</label><input className="input" value={s.email2} onChange={set('email2')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">ABN</label><input className="input" value={s.abn} onChange={set('abn')} /></div>
        <div><label className="label">Terms (days)</label><input className="input" type="number" value={s.paymentTermsDays} onChange={set('paymentTermsDays')} /></div>
      </div>
      <div><label className="label">Delivery address</label><input className="input" value={s.addressLine} onChange={set('addressLine')} /></div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="label">City</label><input className="input" value={s.city} onChange={set('city')} /></div>
        <div><label className="label">State</label><input className="input" value={s.state} onChange={set('state')} /></div>
        <div><label className="label">Postcode</label><input className="input" value={s.postCode} onChange={set('postCode')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Credit / outstanding limit</label><input className="input" type="number" value={s.creditLimit} onChange={set('creditLimit')} /></div>
      </div>
      <div><label className="label">Delivery instructions</label><textarea className="input min-h-[64px]" value={s.deliveryInstructions} onChange={set('deliveryInstructions')} /></div>
      <div>
        <label className="label">Flags</label>
        <div className="flex flex-wrap gap-2">
          {([['isActive', 'Active'], ['hideInvoice', 'Hide invoice'], ['ignoreMinPrice', 'Ignore min price'], ['ignoreProductMinPrice', 'Ignore product min price']] as [keyof typeof flags, string][]).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={flags[k]}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${flags[k] ? 'bg-brand/10 border-brand/30 text-brand' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
              {lbl}: {flags[k] ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={s.businessName.trim().length === 0 || saving}
          onClick={() => onSave({
            businessName: s.businessName, accountCode: s.accountCode || null,
            contactPerson: s.contactPerson || null, contactPhone: s.contactPhone || null,
            email: s.email || null, email2: s.email2 || null, abn: s.abn || null,
            addressLine: s.addressLine || null, city: s.city || null, state: s.state || null, postCode: s.postCode || null,
            deliveryInstructions: s.deliveryInstructions || null,
            paymentTermsDays: s.paymentTermsDays.trim() === '' ? null : Number(s.paymentTermsDays),
            creditLimit: s.creditLimit.trim() === '' ? null : Number(s.creditLimit),
            ignoreMinPrice: flags.ignoreMinPrice, ignoreProductMinPrice: flags.ignoreProductMinPrice,
            hideInvoice: flags.hideInvoice, isActive: flags.isActive,
            salesPersonId: s.salesPersonId || null, locationId: s.locationId || null,
          })}
        >Save</Button>
      </div>
    </div>
  );
}
