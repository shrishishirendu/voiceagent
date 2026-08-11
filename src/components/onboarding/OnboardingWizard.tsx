'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/shared/Button';
import { EnvoyLogo } from '@/components/shared/Logo';
import { IconPlus, IconTrash, IconCheck } from '@/components/shared/Icons';

type Contact = { businessName: string; phone: string };
type State = {
  businessName: string; phone: string;
  addressLine: string; city: string; state: string; postCode: string;
  voice: 'iris' | 'arjun' | 'theo'; manner: 'warm' | 'crisp' | 'formal'; objective: string;
  bhStartHour: number; bhEndHour: number; days: number[]; timezone: string;
  contacts: Contact[];
};

const STEPS = ['Business', 'Contacts', 'Call moment', 'Credentials', 'Review'];
const DAY_LABELS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['7', 'Sun']] as const;

const initial: State = {
  businessName: '', phone: '', addressLine: '', city: '', state: '', postCode: '',
  voice: 'iris', manner: 'warm', objective: 'Chase the overdue invoice politely, confirm the amount owed, and secure a payment date.',
  bhStartHour: 9, bhEndHour: 17, days: [1, 2, 3, 4, 5], timezone: 'Australia/Sydney',
  contacts: [],
};

// `initialBusinessName` carries the company name typed at signup so step 1 arrives
// prefilled rather than asking for it a second time.
export function OnboardingWizard({ initialBusinessName = '' }: { initialBusinessName?: string }) {
  const [step, setStep] = useState(0);
  const [s, setS] = useState<State>({ ...initial, businessName: initialBusinessName });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }));
  const canNext = step !== 0 || s.businessName.trim().length > 0;

  const toggleDay = (d: number) => set('days', s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort());
  const addContact = () => set('contacts', [...s.contacts, { businessName: '', phone: '' }]);
  const setContact = (i: number, k: keyof Contact, v: string) => set('contacts', s.contacts.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const removeContact = (i: number) => set('contacts', s.contacts.filter((_, j) => j !== i));

  async function finish() {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: s.businessName,
          phone: s.phone || undefined,
          addressLine: s.addressLine || undefined, city: s.city || undefined, state: s.state || undefined, postCode: s.postCode || undefined,
          callMoment: { voice: s.voice, manner: s.manner, objective: s.objective || undefined },
          businessHours: {
            bhStartHour: s.bhStartHour, bhEndHour: s.bhEndHour,
            bhDays: (s.days.length ? s.days : [1, 2, 3, 4, 5]).join(','), timezone: s.timezone,
          },
          contacts: s.contacts.filter((c) => c.businessName.trim()).map((c) => ({ businessName: c.businessName, phone: c.phone || undefined })),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Onboarding failed');
      // Hard navigation (not router.push) so the /app layout gate re-evaluates on the server with
      // the just-created Tenant row — a client-side push serves the cached "no tenant → /onboarding"
      // result and bounces the user back to step 1.
      window.location.assign('/app/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <main className="app-bg min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="flex justify-center mb-6"><EnvoyLogo /></div>

        {/* step rail */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-400'}`}>
                {i < step ? <IconCheck className="w-3.5 h-3.5" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && <span className={`w-6 h-px ${i < step ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        <div className="card p-8">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
              <h2 className="font-display text-xl font-semibold text-slate-900 mb-1">{STEPS[step]}</h2>

              {step === 0 && (
                <div className="space-y-4 mt-4">
                  <p className="text-sm text-slate-500 -mt-1">Tell us about your business — this is the identity your AI agent calls on behalf of.</p>
                  <div><label className="label">Business name *</label><input className="input" value={s.businessName} onChange={(e) => set('businessName', e.target.value)} placeholder="e.g. Golden Valley Produce Co." /></div>
                  <div><label className="label">Phone</label><input className="input" value={s.phone} onChange={(e) => set('phone', e.target.value)} placeholder="e.g. +61 2 5943 7289" /></div>
                  <div><label className="label">Delivery address</label><input className="input" value={s.addressLine} onChange={(e) => set('addressLine', e.target.value)} placeholder="Street address" /></div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><label className="label">City</label><input className="input" value={s.city} onChange={(e) => set('city', e.target.value)} /></div>
                    <div><label className="label">State</label><input className="input" value={s.state} onChange={(e) => set('state', e.target.value)} /></div>
                    <div><label className="label">Postcode</label><input className="input" value={s.postCode} onChange={(e) => set('postCode', e.target.value)} /></div>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-3 mt-4">
                  <p className="text-sm text-slate-500 -mt-1">Add customers you chase for payment. You can skip this and add them later, or they appear automatically as invoices are processed.</p>
                  {s.contacts.map((c, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input className="input flex-1" value={c.businessName} onChange={(e) => setContact(i, 'businessName', e.target.value)} placeholder="Business name" />
                      <input className="input w-40" value={c.phone} onChange={(e) => setContact(i, 'phone', e.target.value)} placeholder="Phone" />
                      <button onClick={() => removeContact(i)} className="text-slate-300 hover:text-rose-500 transition-colors p-1"><IconTrash className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <Button variant="secondary" icon={<IconPlus className="w-4 h-4" />} onClick={addContact}>Add customer</Button>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4 mt-4">
                  <p className="text-sm text-slate-500 -mt-1">Defaults for how your agent sounds and what it aims to achieve on each call.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="label">Voice</label>
                      <select className="input" value={s.voice} onChange={(e) => set('voice', e.target.value as State['voice'])}>
                        <option value="iris">Iris</option><option value="arjun">Arjun</option><option value="theo">Theo</option>
                      </select>
                    </div>
                    <div><label className="label">Manner</label>
                      <select className="input" value={s.manner} onChange={(e) => set('manner', e.target.value as State['manner'])}>
                        <option value="warm">Warm</option><option value="crisp">Crisp</option><option value="formal">Formal</option>
                      </select>
                    </div>
                  </div>
                  <div><label className="label">Default objective</label><textarea className="input min-h-[72px]" value={s.objective} onChange={(e) => set('objective', e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="label">Call from (hour)</label><input type="number" min={0} max={23} className="input" value={s.bhStartHour} onChange={(e) => set('bhStartHour', Number(e.target.value))} /></div>
                    <div><label className="label">Call until (hour)</label><input type="number" min={1} max={24} className="input" value={s.bhEndHour} onChange={(e) => set('bhEndHour', Number(e.target.value))} /></div>
                  </div>
                  <div>
                    <label className="label">Call days</label>
                    <div className="flex gap-1.5">
                      {DAY_LABELS.map(([num, lbl]) => {
                        const d = Number(num);
                        const on = s.days.includes(d);
                        return <button key={num} onClick={() => toggleDay(d)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${on ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>{lbl}</button>;
                      })}
                    </div>
                  </div>
                  <div><label className="label">Timezone</label><input className="input" value={s.timezone} onChange={(e) => set('timezone', e.target.value)} /></div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3 mt-4">
                  <p className="text-sm text-slate-500 -mt-1">Your outbound calling credentials (Vapi, Twilio, Gemini).</p>
                  <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 text-sm text-slate-500">
                    Credential setup lands in a later release — for now these are configured centrally via environment variables. You can finish onboarding and start using the app right away.
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-3 mt-4 text-sm">
                  <p className="text-slate-500 -mt-1">Review and finish.</p>
                  <Row label="Business" value={s.businessName || '—'} />
                  <Row label="Phone" value={s.phone || '—'} />
                  <Row label="Address" value={[s.addressLine, s.city, s.state, s.postCode].filter(Boolean).join(', ') || '—'} />
                  <Row label="Voice / manner" value={`${s.voice} · ${s.manner}`} />
                  <Row label="Call hours" value={`${s.bhStartHour}:00–${s.bhEndHour}:00 · ${s.days.length} day(s) · ${s.timezone}`} />
                  <Row label="Seed customers" value={`${s.contacts.filter((c) => c.businessName.trim()).length}`} />
                  {error && <p className="text-sm text-[var(--brand,#E31E24)]">{error}</p>}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="flex justify-between items-center mt-8">
            {step === 0 ? (
              // No previous step to go back to — offer an exit that signs out to the login screen.
              <Button variant="ghost" onClick={() => signOut({ callbackUrl: '/login' })} disabled={submitting}>Exit</Button>
            ) : (
              <Button variant="ghost" onClick={() => setStep((v) => Math.max(0, v - 1))} disabled={submitting}>Back</Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => setStep((v) => v + 1)} disabled={!canNext}>Continue</Button>
            ) : (
              <Button variant="primary" onClick={finish} loading={submitting} disabled={!s.businessName.trim()}>Finish &amp; go to dashboard</Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-800 font-medium text-right">{value}</span>
    </div>
  );
}
