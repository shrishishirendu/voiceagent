'use client';

// Manual single-call brief — ported from demo2.0's Compose() (src/app/page.tsx lines 655-841).
// Dispatches straight to POST /api/calls/dispatch, then routes to the live-call screen.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/shared/Button';
import { Card, CardBody } from '@/components/shared/Card';
import { IconArrowLeft } from '@/components/shared/Icons';
import { useAddToast } from '@/components/shared/Toast';
import { phoneDigitCount } from '@/lib/format';

const VOICES = [
  { id: 'iris', name: 'Iris', desc: 'Warm, female' },
  { id: 'arjun', name: 'Arjun', desc: 'Natural, Indian male' },
  { id: 'theo', name: 'Theo', desc: 'Hindi/Hinglish, male' },
];

const MANNERS = [
  { id: 'warm', name: 'Warm', desc: 'Friendly, conversational' },
  { id: 'crisp', name: 'Crisp', desc: 'Direct, time-efficient' },
  { id: 'formal', name: 'Formal', desc: 'Professional, precise' },
];

export default function NewCallPage() {
  const router = useRouter();
  const addToast = useAddToast();

  const [number, setNumber] = useState('+61 ');
  const [contact, setContact] = useState('');
  const [userName, setUserName] = useState('');
  const [objective, setObjective] = useState('');
  const [voice, setVoice] = useState('iris');
  const [manner, setManner] = useState('warm');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneDigits = phoneDigitCount(number);
  const needsPhone = phoneDigits < 9;
  const needsObjective = objective.trim().length <= 9;
  const isValid = !needsPhone && !needsObjective && !submitting;

  // Say WHY the button is disabled rather than leaving it inertly greyed out.
  const blockedReason = needsPhone
    ? needsObjective
      ? 'Enter a full phone number and an objective of at least 10 characters.'
      : 'Enter a full phone number (at least 9 digits).'
    : needsObjective
      ? 'Add a bit more detail to the objective — at least 10 characters.'
      : null;

  const submit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/calls/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactBusiness: contact || 'Unknown contact',
          toNumber: number,
          objective,
          voice,
          manner,
          userName: userName || 'the caller',
        }),
      });
      // Parse defensively: a non-JSON body (e.g. an SSO/Deployment-Protection HTML page)
      // would otherwise throw a confusing "Unexpected token '<'" instead of the real status.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/app/calls/live/${data.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to dispatch';
      setError(msg);
      addToast(msg, 'error');
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto app-bg">
      <div className="max-w-2xl mx-auto px-8 py-10 pb-16">
        <button onClick={() => router.back()} className="btn-ghost -ml-3 mb-6">
          <IconArrowLeft />
          Back
        </button>

        <p className="smallcaps text-slate-400 mb-2">New brief</p>
        <h1 className="font-display text-3xl font-light tracking-tight text-slate-900 mb-8">
          Who should I call, <span className="italic text-brand">and what for?</span>
        </h1>

        <Card>
          <CardBody className="p-6 space-y-6">
            <div>
              <label className="label">Number to call</label>
              <input
                type="tel"
                className="input font-mono"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="+61 4..."
              />
            </div>

            <div>
              <label className="label">
                Contact / business <span className="normal-case tracking-normal font-normal text-slate-300">· optional</span>
              </label>
              <input
                type="text"
                className="input"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="e.g. Joe at the plumbers"
              />
            </div>

            <div>
              <label className="label">
                Your name / business <span className="normal-case tracking-normal font-normal text-slate-300">· how Envoy refers to you</span>
              </label>
              <input
                type="text"
                className="input"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="e.g. Suresh"
              />
            </div>

            <div>
              <label className="label">Objective</label>
              <textarea
                className="input resize-none leading-relaxed"
                rows={4}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="What do you want Envoy to achieve? Be specific — dates, names, prices, alternatives."
              />
            </div>

            <div>
              <label className="label mb-3">Voice</label>
              <div className="grid grid-cols-3 gap-2">
                {VOICES.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVoice(v.id)}
                    className={`text-left p-3 rounded-xl border transition ${
                      voice === v.id
                        ? 'border-brand bg-brand text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-display text-sm font-medium leading-none mb-1">{v.name}</div>
                    <div className={`text-[11px] leading-tight ${voice === v.id ? 'text-white/70' : 'text-slate-400'}`}>{v.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label mb-3">Manner</label>
              <div className="grid grid-cols-3 gap-2">
                {MANNERS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setManner(m.id)}
                    className={`text-left p-3 rounded-xl border transition ${
                      manner === m.id
                        ? 'border-brand bg-brand text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-display text-sm font-medium leading-none mb-1">{m.name}</div>
                    <div className={`text-[11px] leading-tight ${manner === m.id ? 'text-white/70' : 'text-slate-400'}`}>{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="p-4 rounded-xl bg-brand-faint text-brand-dark text-sm leading-snug">
                <strong className="block mb-1">Dispatch failed</strong>
                {error}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="mt-6 flex items-start justify-between gap-6">
          <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
            The call is recorded. Envoy identifies itself as an AI agent.
          </p>
          <div className="shrink-0 flex flex-col items-end gap-2">
            <Button variant="primary" disabled={!isValid} loading={submitting} onClick={submit} className="px-8 py-3 rounded-full">
              {submitting ? 'Dispatching…' : 'Dispatch Envoy'}
            </Button>
            {blockedReason && !submitting && (
              <p className="text-xs text-slate-400 text-right max-w-[16rem] leading-relaxed">{blockedReason}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
