'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardBody } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { Drawer } from '@/components/shared/Drawer';
import { PanelSkeleton } from '@/components/shared/Skeleton';
import { WarningBadge } from '@/components/shared/Badge';
import { useAddToast } from '@/components/shared/Toast';
import { IconPlus, IconSearch, IconChevronRight } from '@/components/shared/Icons';
import { fmtMoneyByCurrency, mergeMoney, totalMoneyMagnitude, type MoneyByCurrency } from '@/lib/money';

interface CustomerSummary {
  id: string;
  businessName: string;
  contactPerson: string | null;
  contactPhone: string | null;
  email: string | null;
  abn: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postCode: string | null;
  deliveryInstructions: string | null;
  isActive: boolean;
  invoiceCount: number;
  openInvoiceCount: number;
  ticketCount: number;
  callCount: number;
  outstanding: MoneyByCurrency;
}

type FormState = {
  businessName: string;
  contactPerson: string;
  contactPhone: string;
  email: string;
  abn: string;
  addressLine: string;
  city: string;
  state: string;
  postCode: string;
  deliveryInstructions: string;
};

const emptyForm: FormState = {
  businessName: '', contactPerson: '', contactPhone: '', email: '', abn: '',
  addressLine: '', city: '', state: '', postCode: '', deliveryInstructions: '',
};

function CustomerForm({ saving, onCancel, onSave }: { saving: boolean; onCancel: () => void; onSave: (s: FormState) => void }) {
  const [state, setState] = useState<FormState>(emptyForm);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setState((s) => ({ ...s, [k]: e.target.value }));
  const canSave = state.businessName.trim().length > 0 && !saving;

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Business name</label>
        <input className="input" value={state.businessName} onChange={set('businessName')} placeholder="e.g. Little Corner Cafe" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Contact person</label>
          <input className="input" value={state.contactPerson} onChange={set('contactPerson')} placeholder="e.g. Amit Shrestha" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={state.contactPhone} onChange={set('contactPhone')} placeholder="e.g. 0412 345 678" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">ABN</label>
          <input className="input" value={state.abn} onChange={set('abn')} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={state.email} onChange={set('email')} />
        </div>
      </div>
      <div>
        <label className="label">Delivery address</label>
        <input className="input" value={state.addressLine} onChange={set('addressLine')} placeholder="Street address" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">City</label>
          <input className="input" value={state.city} onChange={set('city')} />
        </div>
        <div>
          <label className="label">State</label>
          <input className="input" value={state.state} onChange={set('state')} />
        </div>
        <div>
          <label className="label">Postcode</label>
          <input className="input" value={state.postCode} onChange={set('postCode')} />
        </div>
      </div>
      <div>
        <label className="label">Delivery instructions</label>
        <textarea className="input min-h-[64px]" value={state.deliveryInstructions} onChange={set('deliveryInstructions')} placeholder="e.g. Leave at rear dock, ask for the manager" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(state)} disabled={!canSave} loading={saving}>Save</Button>
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const addToast = useAddToast();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/customers', { cache: 'no-store' });
      if (r.ok) setCustomers((await r.json()).customers ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.businessName.toLowerCase().includes(q) ||
        (c.contactPhone ?? '').toLowerCase().includes(q) ||
        (c.contactPerson ?? '').toLowerCase().includes(q)
    );
  }, [customers, query]);

  const totalOutstanding = mergeMoney(customers.map((c) => c.outstanding ?? []));

  const saveNew = async (state: FormState) => {
    setSaving(true);
    try {
      const r = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: state.businessName,
          contactPerson: state.contactPerson || null,
          contactPhone: state.contactPhone || null,
          email: state.email || null,
          abn: state.abn || null,
          addressLine: state.addressLine || null,
          city: state.city || null,
          state: state.state || null,
          postCode: state.postCode || null,
          deliveryInstructions: state.deliveryInstructions || null,
        }),
      });
      if (!r.ok) throw new Error('create failed');
      addToast('Customer added.', 'success');
      setAdding(false);
      await load();
    } catch (e) {
      console.error(e);
      addToast('Failed to add customer.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="flex-none px-8 pt-8 pb-5 border-b border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-slate-900 tracking-tight">Customers</h1>
            <p className="mt-1 text-sm text-slate-500">
              {customers.length} customer{customers.length === 1 ? '' : 's'}
              {totalMoneyMagnitude(totalOutstanding) > 0 ? ` · ${fmtMoneyByCurrency(totalOutstanding)} outstanding` : ''}
            </p>
          </div>
          <Button variant="primary" icon={<IconPlus className="w-4 h-4" />} onClick={() => setAdding(true)}>
            Add customer
          </Button>
        </div>
        <div className="mt-4 relative max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <IconSearch className="w-4 h-4" />
          </span>
          <input className="input pl-9" placeholder="Search by business, phone, or person" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
        {loading && <PanelSkeleton />}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-20">
            <p className="font-display text-lg italic text-slate-400 mb-1.5">
              {customers.length === 0 ? 'No customers yet.' : 'No matches.'}
            </p>
            <p className="text-sm text-slate-400">
              {customers.length === 0 ? 'Add a customer, or they appear automatically as invoices are processed.' : 'Try a different search.'}
            </p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <Card>
            <CardBody className="p-0">
              <div className="divide-y divide-slate-50">
                {filtered.map((c) => (
                  <Link key={c.id} href={`/app/customers/${c.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">{c.businessName}</p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {[c.contactPerson, c.abn ? `ABN ${c.abn}` : null, c.email].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <div className="flex-none flex items-center gap-4">
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-slate-400">Outstanding</p>
                        <p className="text-sm font-medium text-slate-800">{totalMoneyMagnitude(c.outstanding ?? []) > 0 ? fmtMoneyByCurrency(c.outstanding) : '—'}</p>
                      </div>
                      <div className="text-right hidden md:block w-20">
                        <p className="text-xs text-slate-400">Open / Tickets</p>
                        <p className="text-sm font-medium text-slate-800">{c.openInvoiceCount} / {c.ticketCount}</p>
                      </div>
                      {c.contactPhone ? (
                        <span className="font-mono text-sm text-slate-700 hidden lg:inline">{c.contactPhone}</span>
                      ) : (
                        <WarningBadge>No phone</WarningBadge>
                      )}
                      <IconChevronRight className="w-4 h-4 text-slate-300" />
                    </div>
                  </Link>
                ))}
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      <Drawer open={adding} onClose={() => setAdding(false)} title="Add customer" width="max-w-lg">
        {adding && <CustomerForm saving={saving} onCancel={() => setAdding(false)} onSave={saveNew} />}
      </Drawer>
    </div>
  );
}
