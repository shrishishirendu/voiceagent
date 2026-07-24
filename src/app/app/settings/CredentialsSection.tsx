'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardBody } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { useAddToast } from '@/components/shared/Toast';
import { IconPhone } from '@/components/shared/Icons';

type FieldStatus = { tenantSet: boolean; envFallback: boolean; masked: string | null };
type CredentialField = 'vapiPrivateKey' | 'twilioAccountSid' | 'twilioAuthToken' | 'anthropicKey';
type Status = {
  encryptionEnabled: boolean;
  phoneNumber: string | null;
  fields: Record<CredentialField, FieldStatus>;
};
type Me = { role: string };

const FIELD_META: { key: CredentialField; label: string; hint: string }[] = [
  { key: 'vapiPrivateKey', label: 'Vapi private key', hint: 'Places the outbound call.' },
  { key: 'twilioAccountSid', label: 'Twilio account SID', hint: 'The Twilio account the caller-id belongs to.' },
  { key: 'twilioAuthToken', label: 'Twilio auth token', hint: 'Authorises the Twilio line.' },
  { key: 'anthropicKey', label: 'Anthropic API key', hint: 'Reserved for tenant-specific model billing.' },
];

// Per-tenant outbound credentials + caller-id (Phase 3-G). Owner-only. Secret values are
// never sent back to the browser — only a masked "••••1234" and whether the tenant has
// set its own or is falling back to the server env. One caller-id number per business.
export function CredentialsSection() {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [phone, setPhone] = useState('');
  const [values, setValues] = useState<Record<CredentialField, string>>({
    vapiPrivateKey: '',
    twilioAccountSid: '',
    twilioAuthToken: '',
    anthropicKey: '',
  });
  const [saving, setSaving] = useState(false);
  const addToast = useAddToast();

  const load = useCallback(async () => {
    try {
      const meRes = await fetch('/api/me', { cache: 'no-store' });
      if (!meRes.ok) return;
      const meData: Me = await meRes.json();
      setMe(meData);
      if (meData.role !== 'owner') return; // credentials are owner-only
      const r = await fetch('/api/credentials', { cache: 'no-store' });
      if (!r.ok) return;
      const data: Status = await r.json();
      setStatus(data);
      setPhone(data.phoneNumber ?? '');
    } catch {
      /* leave hidden on failure */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!me || me.role !== 'owner') return null;

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = { phoneNumber: phone.trim() };
      for (const f of FIELD_META) if (values[f.key].trim()) payload[f.key] = values[f.key].trim();
      const r = await fetch('/api/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setStatus(data);
      setPhone(data.phoneNumber ?? '');
      setValues({ vapiPrivateKey: '', twilioAccountSid: '', twilioAuthToken: '', anthropicKey: '' });
      addToast('Credentials saved.', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Save failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const statusLabel = (s?: FieldStatus) => {
    if (!s) return '';
    if (s.tenantSet) return `Set (${s.masked})`;
    if (s.envFallback) return 'Using server default';
    return 'Not set';
  };

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <IconPhone className="w-4 h-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-900">Outbound credentials &amp; caller-id</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-slate-500 -mt-1">
          Bring your own Vapi / Twilio / Anthropic keys and the phone number your agent calls from.
          Anything left blank falls back to the server&apos;s shared configuration.{' '}
          {status && !status.encryptionEnabled && (
            <span className="text-amber-600">
              CREDENTIALS_SECRET isn&apos;t set — saved keys are stored unencrypted (dev only).
            </span>
          )}
        </p>

        <div>
          <label className="label" htmlFor="cred-phone">
            Caller-id number (one per business)
          </label>
          <input
            id="cred-phone"
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+61 2 5943 7289"
          />
          <p className="text-xs text-slate-500 mt-1.5">The Twilio number outbound calls are placed from.</p>
        </div>

        {FIELD_META.map((f) => (
          <div key={f.key}>
            <div className="flex items-center justify-between">
              <label className="label" htmlFor={`cred-${f.key}`}>
                {f.label}
              </label>
              <span className="text-xs text-slate-400">{statusLabel(status?.fields[f.key])}</span>
            </div>
            <input
              id={`cred-${f.key}`}
              type="password"
              autoComplete="new-password"
              className="input font-mono"
              value={values[f.key]}
              onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
              placeholder={status?.fields[f.key]?.tenantSet ? 'Leave blank to keep current' : 'Leave blank to use server default'}
            />
            <p className="text-xs text-slate-500 mt-1.5">{f.hint}</p>
          </div>
        ))}

        <div className="flex justify-end pt-1">
          <Button variant="secondary" onClick={save} loading={saving}>
            Save credentials
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
