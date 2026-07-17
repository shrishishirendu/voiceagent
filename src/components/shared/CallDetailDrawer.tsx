'use client';

import { useEffect, useState } from 'react';
import { Drawer } from './Drawer';
import { LoadingOverlay } from './Spinner';
import { CallOutcomeBadge } from './Badge';
import { fmtWhen, fmtDuration, fmtAmount, fmtDate } from '@/lib/format';
import type { Call, LinkedInvoice, TranscriptLine } from '@/lib/client-types';

// Voicemail detection — ported verbatim from demo2.0's Detail() (src/app/page.tsx lines 1687-1691).
const VOICEMAIL_PHRASES =
  /audio message|leave a message|leave your message|not available|unavailable|voicemail|answering machine|at the tone|after the beep|record your message|send a message/i;

function isVoicemailCall(call: Call): boolean {
  return !!(
    (call.endedReason && /voicemail|machine/i.test(call.endedReason)) ||
    (call.transcript ?? []).some((l) => l.who === 'them' && VOICEMAIL_PHRASES.test(l.text))
  );
}

/**
 * For voicemail calls, show the actual message left. Two detection paths exist:
 * - Vapi-detected (endedReason = voicemail/machine): Vapi speaks its static voicemailMessage
 *   TTS directly — this never appears in messages[]. Use the stored voicemailScript instead.
 * - AI-detected (transcript phrase matched): Claude said the vmScript as a conversational
 *   message — it IS in the transcript. Skip the opening greeting (index 0) and pick the
 *   longest remaining Envoy message.
 * Ported verbatim from demo2.0's Detail() (src/app/page.tsx lines 1701-1715).
 */
function voicemailLinesFor(call: Call): TranscriptLine[] {
  const vmScript = call.voicemailScript;
  const vapiDetected = !!(call.endedReason && /voicemail|machine/i.test(call.endedReason));
  if (vapiDetected && vmScript) {
    return [{ who: 'envoy', text: vmScript }];
  }
  const envoyLines = (call.transcript ?? []).filter((l) => l.who === 'envoy');
  const candidates = envoyLines.slice(1); // skip opening greeting
  if (candidates.length > 0) {
    return [candidates.reduce((a, b) => (b.text.length > a.text.length ? b : a))];
  }
  if (vmScript) return [{ who: 'envoy', text: vmScript }];
  return [];
}

/**
 * Self-contained call detail panel — fetches its own data from GET /api/calls/[id] whenever
 * `callId` changes, and renders inside the shared Drawer primitive. Used by the dashboard call
 * list as well as the bulk invoice / queue screens (any place that needs to show a call's
 * outcome, brief, linked invoices, transcript, and recording).
 */
export function CallDetailDrawer({ callId, onClose }: { callId: string | null; onClose: () => void }) {
  const [call, setCall] = useState<Call | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!callId) {
      setCall(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/calls/${callId}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load call');
        return r.json();
      })
      .then((d: Call) => {
        if (cancelled) return;
        setCall(d);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this call.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [callId]);

  if (callId == null) return null;

  const isInvoice = !!call?.invoiceNumber;
  const linkedInvoices: LinkedInvoice[] = call?.invoices ?? [];
  const aggregateTotal = linkedInvoices.reduce((s, i) => s + (i.amountDue ?? 0), 0);
  const voicemail = call ? isVoicemailCall(call) : false;
  const vmLines = call && voicemail ? voicemailLinesFor(call) : [];

  return (
    <Drawer open={callId != null} onClose={onClose} title={call ? call.contactBusiness : 'Call details'}>
      {loading && <LoadingOverlay message="Loading call…" />}

      {!loading && error && (
        <div className="p-6 text-sm text-red-600">{error}</div>
      )}

      {!loading && !error && call && (
        <div className="p-5 space-y-6">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CallOutcomeBadge outcome={call.outcome} />
              <span className="font-mono text-xs text-slate-400">
                {fmtWhen(call.createdAt)}
                {call.durationSec != null ? ` · ${fmtDuration(call.durationSec)}` : ''}
              </span>
            </div>
            <h2 className="font-display text-xl font-semibold text-slate-900 leading-tight">{call.contactBusiness}</h2>
            <p className="font-mono text-xs text-slate-400 mt-0.5">{call.toNumber}</p>
          </div>

          {/* Outcome — invoice calls show the full AI summary, others the brief result line */}
          {isInvoice ? (
            call.summary && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Outcome</p>
                <p className="text-sm leading-relaxed text-slate-700">{call.summary}</p>
              </section>
            )
          ) : (
            call.result && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Outcome</p>
                <p className="font-display text-base font-semibold text-brand leading-snug">{call.result}</p>
              </section>
            )
          )}

          {/* Linked invoices (aggregated calls) */}
          {linkedInvoices.length > 1 && (
            <section>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                {linkedInvoices.length} invoices · {fmtAmount(linkedInvoices[0]?.currency, aggregateTotal)}
              </p>
              <div className="flex flex-col gap-1.5">
                {linkedInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between text-sm rounded-xl border border-slate-100 px-3 py-2">
                    <span className="text-slate-700">
                      {inv.invoiceNumber ? `#${inv.invoiceNumber}` : 'Invoice'}
                      {inv.dueDate ? ` · due ${fmtDate(inv.dueDate)}` : ''}
                    </span>
                    <span className="font-mono text-slate-500">{fmtAmount(inv.currency, inv.amountDue)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* The original brief */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">The brief</p>
            <p className="text-sm leading-relaxed text-slate-700">{call.objective}</p>
          </section>

          {/* Envoy's report — carries the voicemail note when relevant; skipped for invoice
              calls since the summary is already shown above */}
          {call.summary && !isInvoice && (
            <section>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Envoy&apos;s report</p>
              <p className="text-sm leading-relaxed text-slate-600">{call.summary}</p>
            </section>
          )}

          {/* Voicemail message or transcript */}
          {voicemail ? (
            vmLines.length > 0 && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Voicemail message</p>
                <div className="space-y-3">
                  {vmLines.map((line, i) => (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-brand-faint px-3.5 py-2.5 text-sm leading-relaxed text-slate-900">
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-brand-dark/70">Envoy</p>
                        {line.text}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          ) : (
            call.transcript &&
            call.transcript.length > 0 && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Transcript</p>
                <div className="space-y-3">
                  {call.transcript.map((line, i) => (
                    <div key={i} className={`flex ${line.who === 'envoy' ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                          line.who === 'envoy'
                            ? 'rounded-tl-sm bg-brand-faint text-slate-900'
                            : 'rounded-tr-sm bg-slate-100 text-slate-700'
                        }`}
                      >
                        <p
                          className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${
                            line.who === 'envoy' ? 'text-brand-dark/70' : 'text-slate-400'
                          }`}
                        >
                          {line.who === 'envoy' ? 'Envoy' : call.contactBusiness.split(' ')[0]}
                        </p>
                        {line.text}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          )}

          {/* Recording player */}
          {call.recordingUrl && (
            <section>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Recording</p>
              <audio controls src={`/api/calls/${callId}/recording`} className="w-full" />
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
