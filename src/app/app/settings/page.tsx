'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardBody } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { PanelSkeleton } from '@/components/shared/Skeleton';
import { useAddToast } from '@/components/shared/Toast';
import { IconGear, IconCalendar, IconSearch, IconRefresh } from '@/components/shared/Icons';
import type { SchedulerSettings } from '@/lib/client-types';
import { TeamSection } from './TeamSection';
import { CredentialsSection } from './CredentialsSection';

/** Sliding on/off switch. Only used on this page, so it lives here rather than as a shared component. */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-10 flex-none items-center rounded-full transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-brand/30 ${
        checked ? 'bg-brand' : 'bg-slate-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

const DAYS = [
  { iso: '1', label: 'Mon' },
  { iso: '2', label: 'Tue' },
  { iso: '3', label: 'Wed' },
  { iso: '4', label: 'Thu' },
  { iso: '5', label: 'Fri' },
  { iso: '6', label: 'Sat' },
  { iso: '7', label: 'Sun' },
];

const HOURS_0_23 = Array.from({ length: 24 }, (_, i) => i);
const HOURS_1_24 = Array.from({ length: 24 }, (_, i) => i + 1);

function hourLabel(h: number) {
  if (h === 24) return '24:00 (midnight)';
  return `${String(h).padStart(2, '0')}:00`;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SchedulerSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const addToast = useAddToast();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await fetch('/api/settings', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as SchedulerSettings;
      setSettings(data);
    } catch {
      setLoadError('Failed to load settings.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = <K extends keyof SchedulerSettings>(key: K, value: SchedulerSettings[K]) => {
    setSettings((prev) => (prev ? ({ ...prev, [key]: value } as SchedulerSettings) : prev));
  };

  const dayActive = (iso: string) => (settings?.bhDays ?? '').split(',').includes(iso);
  const toggleDay = (iso: string) => {
    if (!settings) return;
    const set = new Set(settings.bhDays.split(',').filter(Boolean));
    if (set.has(iso)) set.delete(iso);
    else set.add(iso);
    const ordered = ['1', '2', '3', '4', '5', '6', '7'].filter((d) => set.has(d));
    update('bhDays', ordered.join(','));
  };

  // Mirrors the server-side check in PUT /api/settings (bhEndHour must be after bhStartHour)
  // so the user gets immediate feedback instead of waiting on a 400 response.
  const hoursInvalid = !!settings && settings.bhEndHour <= settings.bhStartHour;

  const save = async () => {
    if (!settings) return;
    if (hoursInvalid) {
      addToast('Business hours end must be after the start hour.', 'error');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setSettings(data);
      addToast('Settings saved.', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Save failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!settings && !loadError) {
    return <PanelSkeleton rows={4} />;
  }

  if (!settings && loadError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-slate-500">{loadError}</p>
        <Button variant="secondary" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="h-full flex flex-col">
      <header className="flex-none px-6 pt-6 pb-4 border-b border-slate-100 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
          <p className="text-sm text-slate-500 mt-0.5">Scheduler, business hours, and chasing behavior.</p>
        </div>
        <Button variant="primary" onClick={save} loading={saving} disabled={hoursInvalid}>
          Save settings
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {/* Scheduler */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <IconGear className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Scheduler</h2>
          </CardHeader>
          <CardBody>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-700">Scheduler on</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  The standalone worker dials the queue every minute while this is on. Turn it off to pause all outbound dispatch.
                </p>
              </div>
              <Toggle checked={settings.schedulerOn} onChange={(v) => update('schedulerOn', v)} label="Scheduler on" />
            </div>
          </CardBody>
        </Card>

        {/* Business hours */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <IconCalendar className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Business hours</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <label className="label">Hours (recipient local time)</label>
              <div className="flex items-center gap-3">
                <select
                  className="input"
                  value={settings.bhStartHour}
                  onChange={(e) => update('bhStartHour', Number(e.target.value))}
                >
                  {HOURS_0_23.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-slate-400 flex-none">to</span>
                <select
                  className="input"
                  value={settings.bhEndHour}
                  onChange={(e) => update('bhEndHour', Number(e.target.value))}
                >
                  {HOURS_1_24.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </div>
              {hoursInvalid && <p className="text-xs text-red-600 mt-1.5">End hour must be after the start hour.</p>}
            </div>

            <div>
              <label className="label">Business days</label>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map((d) => (
                  <button
                    key={d.iso}
                    type="button"
                    aria-pressed={dayActive(d.iso)}
                    onClick={() => toggleDay(d.iso)}
                    className={`pill border transition-colors duration-150 ${
                      dayActive(d.iso)
                        ? 'bg-brand text-white border-brand'
                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="settings-timezone">
                Timezone (IANA)
              </label>
              <input
                id="settings-timezone"
                className="input"
                value={settings.timezone}
                onChange={(e) => update('timezone', e.target.value)}
                placeholder="Australia/Sydney"
              />
            </div>
          </CardBody>
        </Card>

        {/* Chasing behavior */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <IconSearch className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Chasing behavior</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <label className="label" htmlFor="settings-due-offset">
                Chase offset (days after due date)
              </label>
              <input
                id="settings-due-offset"
                type="number"
                min={-365}
                max={365}
                className="input"
                value={settings.dueOffsetDays}
                onChange={(e) => update('dueOffsetDays', Number(e.target.value))}
              />
              <p className="text-xs text-slate-500 mt-1.5">0 = start chasing on the due date. Negative values remind before it&apos;s due.</p>
            </div>

            <div>
              <label className="label">Call order</label>
              <div className="flex items-center gap-2">
                <select
                  className="input"
                  value={settings.sortField}
                  onChange={(e) => update('sortField', e.target.value as SchedulerSettings['sortField'])}
                >
                  <option value="overdue">Most overdue</option>
                  <option value="amount">Amount owed</option>
                </select>
                <select
                  className="input"
                  value={settings.sortDir}
                  onChange={(e) => update('sortDir', e.target.value as SchedulerSettings['sortDir'])}
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Follow-up & retry */}
        <Card>
          <CardHeader className="flex items-center gap-2">
            <IconRefresh className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Follow-up &amp; retry</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-700">SMS follow-up</p>
                <p className="text-xs text-slate-500 mt-0.5">Auto-send an SMS after every call with invoice and payment details.</p>
              </div>
              <Toggle checked={settings.smsEnabled} onChange={(v) => update('smsEnabled', v)} label="SMS follow-up" />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-700">Auto-retry</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automatically requeue failed or no-answer calls. Turn off to leave them failed for manual retry from the queue.
                </p>
              </div>
              <Toggle checked={settings.autoRetry} onChange={(v) => update('autoRetry', v)} label="Auto-retry" />
            </div>

            <div className={settings.autoRetry ? '' : 'opacity-50'}>
              <label className="label" htmlFor="settings-retry-delay">
                Retry delay (hours)
              </label>
              <input
                id="settings-retry-delay"
                type="number"
                min={1}
                max={168}
                className="input"
                disabled={!settings.autoRetry}
                value={settings.retryDelayHours}
                onChange={(e) => update('retryDelayHours', Number(e.target.value))}
              />
              <p className="text-xs text-slate-500 mt-1.5">Hours before a no-answer or failed call is retried. Max 168 (1 week).</p>
            </div>
          </CardBody>
        </Card>

        {/* Outbound credentials + caller-id (Phase 3-G) — owner/admin only, self-hides otherwise */}
        <CredentialsSection />

        {/* Team & access (Phase 3-C) — owner/admin only, self-hides otherwise */}
        <TeamSection />
      </div>
    </div>
  );
}
