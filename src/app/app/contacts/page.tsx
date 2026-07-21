'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardBody } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { Drawer } from '@/components/shared/Drawer';
import { PanelSkeleton } from '@/components/shared/Skeleton';
import { WarningBadge } from '@/components/shared/Badge';
import { useAddToast } from '@/components/shared/Toast';
import { IconPlus, IconEdit, IconSearch } from '@/components/shared/Icons';

interface Contact {
  id: string;
  businessName: string;
  abn: string | null;
  phone: string | null;
  email: string | null;
  contactPerson: string | null;
}

type FormState = {
  businessName: string;
  phone: string;
  contactPerson: string;
  abn: string;
  email: string;
};

const emptyForm: FormState = { businessName: '', phone: '', contactPerson: '', abn: '', email: '' };

function toForm(c: Contact): FormState {
  return {
    businessName: c.businessName ?? '',
    phone: c.phone ?? '',
    contactPerson: c.contactPerson ?? '',
    abn: c.abn ?? '',
    email: c.email ?? '',
  };
}

function ContactForm({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: FormState;
  saving: boolean;
  onCancel: () => void;
  onSave: (state: FormState) => void;
}) {
  const [state, setState] = useState<FormState>(initial);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setState((s) => ({ ...s, [k]: e.target.value }));
  const canSave = state.businessName.trim().length > 0 && !saving;

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Business name</label>
        <input className="input" value={state.businessName} onChange={set('businessName')} placeholder="e.g. Little Corner Cafe" />
      </div>
      <div>
        <label className="label">Phone</label>
        <input className="input" value={state.phone} onChange={set('phone')} placeholder="e.g. 0412 345 678" />
      </div>
      <div>
        <label className="label">Contact person</label>
        <input className="input" value={state.contactPerson} onChange={set('contactPerson')} placeholder="e.g. Amit Shrestha" />
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
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(state)} disabled={!canSave} loading={saving}>Save</Button>
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const addToast = useAddToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Contact | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/contacts', { cache: 'no-store' });
      if (r.ok) setContacts((await r.json()).rows ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.businessName.toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.contactPerson ?? '').toLowerCase().includes(q)
    );
  }, [contacts, query]);

  const missingPhone = contacts.filter((c) => !c.phone).length;

  const saveEdit = async (state: FormState) => {
    if (!editing) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/contacts/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: state.businessName,
          phone: state.phone || null,
          contactPerson: state.contactPerson || null,
          abn: state.abn || null,
          email: state.email || null,
        }),
      });
      if (!r.ok) throw new Error('save failed');
      addToast('Contact updated.', 'success');
      setEditing(null);
      await load();
    } catch (e) {
      console.error(e);
      addToast('Failed to save contact.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveNew = async (state: FormState) => {
    setSaving(true);
    try {
      const r = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: state.businessName,
          phone: state.phone || null,
          contactPerson: state.contactPerson || null,
          abn: state.abn || null,
          email: state.email || null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('create failed');
      addToast(data.added === 0 ? 'A matching contact already exists.' : 'Contact added.', data.added === 0 ? 'info' : 'success');
      setAdding(false);
      await load();
    } catch (e) {
      console.error(e);
      addToast('Failed to add contact.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="flex-none px-8 pt-8 pb-5 border-b border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-slate-900 tracking-tight">Contacts</h1>
            <p className="mt-1 text-sm text-slate-500">
              {contacts.length} contact{contacts.length === 1 ? '' : 's'}
              {missingPhone > 0 ? ` · ${missingPhone} missing a phone number` : ''}
            </p>
          </div>
          <Button variant="primary" icon={<IconPlus className="w-4 h-4" />} onClick={() => setAdding(true)}>
            Add contact
          </Button>
        </div>
        <div className="mt-4 relative max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <IconSearch className="w-4 h-4" />
          </span>
          <input
            className="input pl-9"
            placeholder="Search by business, phone, or person"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
        {loading && <PanelSkeleton />}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-20">
            <p className="font-display text-lg italic text-slate-400 mb-1.5">
              {contacts.length === 0 ? 'No contacts yet.' : 'No matches.'}
            </p>
            <p className="text-sm text-slate-400">
              {contacts.length === 0 ? 'Add a contact, or they appear automatically as invoices are processed.' : 'Try a different search.'}
            </p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <Card>
            <CardBody className="p-0">
              <div className="divide-y divide-slate-50">
                {filtered.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">{c.businessName}</p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {[c.contactPerson, c.abn ? `ABN ${c.abn}` : null, c.email].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <div className="flex-none flex items-center gap-3">
                      {c.phone ? (
                        <span className="font-mono text-sm text-slate-700">{c.phone}</span>
                      ) : (
                        <WarningBadge>No phone</WarningBadge>
                      )}
                      <button
                        onClick={() => setEditing(c)}
                        className="text-slate-300 hover:text-slate-600 transition-colors"
                        title="Edit contact"
                      >
                        <IconEdit className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      <Drawer open={adding} onClose={() => setAdding(false)} title="Add contact" width="max-w-lg">
        {adding && <ContactForm initial={emptyForm} saving={saving} onCancel={() => setAdding(false)} onSave={saveNew} />}
      </Drawer>

      <Drawer open={!!editing} onClose={() => setEditing(null)} title="Edit contact" width="max-w-lg">
        {editing && (
          <ContactForm key={editing.id} initial={toForm(editing)} saving={saving} onCancel={() => setEditing(null)} onSave={saveEdit} />
        )}
      </Drawer>
    </div>
  );
}
