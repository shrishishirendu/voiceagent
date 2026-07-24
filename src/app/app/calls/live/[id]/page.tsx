'use client';

// Live call screen — ported from demo2.0's Live() (src/app/page.tsx lines 1493-1671).
// Polls GET /api/calls/[id] every 2s until the call reaches a terminal status, drives an
// elapsed-time counter, and derives a "display status" that stays on Ringing until the
// transcript actually has content — Vapi fires in-progress when its audio stream connects
// (e.g. voicemail detection), not necessarily when a human picks up.
//
// Visual: while the call is active the screen goes full-bleed dark (.sidebar-bg, the same
// dot-grid-on-maroon surface as the sidebar) with light text and the brand-red WaveformViz;
// once the call finishes it swaps to a plain light surface with normal dark text.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WaveformViz } from '@/components/shared/WaveformViz';
import { statusLabel, type Call, type Status } from '@/lib/client-types';
import { fmtDuration } from '@/lib/format';

const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

export default function LiveCallPage({ params }: { params: { id: string } }) {
  const callId = params.id;
  const router = useRouter();

  const [call, setCall] = useState<Call | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const startedAt = useRef(Date.now());
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Elapsed-time counter.
  useEffect(() => {
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(i);
  }, []);

  // Poll the backend until the call is completed/failed, or we hit the 5-minute cap.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive || Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
        if (alive) setPollTimedOut(true);
        return;
      }
      try {
        const r = await fetch(`/api/calls/${callId}`, { cache: 'no-store' });
        if (!alive) return;
        if (r.ok) {
          const c = (await r.json()) as Call;
          setCall(c);
          if (c.status === 'completed' || c.status === 'failed') return; // stop polling
        }
      } catch {
        // transient network error — keep polling
      }
      if (alive) setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [callId]);

  // Auto-scroll the transcript as new lines arrive.
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [call?.transcript]);

  const status: Status = call?.status ?? 'dispatching';
  const finished = status === 'completed' || status === 'failed' || pollTimedOut;
  // Stay on "Ringing" until actual speech is present, even if the backend advanced to
  // "in-progress" — Vapi fires in-progress on audio-stream-connect, not human pickup.
  const displayStatus: Status =
    status === 'in-progress' && (!call?.transcript || call.transcript.length === 0) ? 'ringing' : status;

  const businessInitial = (call?.contactBusiness ?? '').split(' ')[0] || 'Them';

  return (
    <div className={`h-full flex flex-col fade-in ${finished ? 'bg-white' : 'sidebar-bg'}`}>
      <header className="px-8 pt-10 pb-6 flex-none">
        <div className="flex items-center justify-between mb-8">
          <p className={`smallcaps ${finished ? 'text-slate-400' : 'text-white/40'}`}>Live · Envoy</p>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                finished ? 'bg-emerald-500' : 'bg-brand-light dot-pulse'
              }`}
            />
            <span className={`smallcaps ${finished ? 'text-slate-500' : 'text-white/70'}`}>{statusLabel(displayStatus)}</span>
          </div>
        </div>

        <h2 className={`font-display text-3xl leading-tight font-light tracking-tight mb-1 ${finished ? 'text-slate-900' : 'text-white'}`}>
          {call?.contactBusiness ?? '…'}
        </h2>
        <p className={`font-mono text-sm ${finished ? 'text-slate-400' : 'text-white/50'}`}>{call?.toNumber ?? ''}</p>

        {call?.objective && (
          <div
            className={`mt-5 p-4 rounded-2xl border ${
              finished ? 'bg-slate-50 border-slate-100' : 'bg-white/[0.06] border-white/10'
            }`}
          >
            <p className={`smallcaps mb-1.5 ${finished ? 'text-slate-400' : 'text-white/50'}`}>Brief</p>
            <p className={`text-sm leading-snug ${finished ? 'text-slate-700' : 'text-white/90'}`}>{call.objective}</p>
          </div>
        )}
      </header>

      {!finished && (
        <div className="flex flex-col items-center justify-center py-6 flex-none">
          <div
            className={`relative mb-4 w-[78px] h-[78px] rounded-full bg-brand flex items-center justify-center ${
              displayStatus === 'dispatching' || displayStatus === 'ringing' ? 'pulse-ring' : ''
            }`}
          >
            <WaveformViz active={displayStatus === 'in-progress'} />
          </div>
          <div className="font-mono text-xl tracking-wider text-white/90">{fmtDuration(elapsed)}</div>
        </div>
      )}

      <div ref={transcriptRef} className="flex-1 min-h-0 overflow-y-auto px-8 pb-6 transcript-scroll">
        {call?.transcript?.map((line, i) => (
          <div key={i} className="mb-4 fade-up">
            <p className={`smallcaps mb-1 ${line.who === 'envoy' ? 'text-brand-light' : finished ? 'text-slate-400' : 'text-white/50'}`}>
              {line.who === 'envoy' ? 'Envoy' : businessInitial}
            </p>
            <p className={`text-[0.95rem] leading-relaxed ${finished ? 'text-slate-700' : 'text-white/90'}`}>{line.text}</p>
          </div>
        ))}

        {finished && call?.summary && (
          <div className="mt-6 fade-up">
            <p className="smallcaps mb-2 text-slate-400">Envoy&rsquo;s report</p>
            <p className="font-display text-base leading-relaxed text-slate-700">{call.summary}</p>
          </div>
        )}

        {pollTimedOut && status !== 'completed' && status !== 'failed' && (
          <div className="mt-6 fade-up">
            <p className="smallcaps mb-2 text-slate-400">Report pending</p>
            <p className="text-sm leading-relaxed text-slate-500">
              The call ended but the report hasn&rsquo;t arrived yet. It will appear in your call history once it finishes
              processing.
            </p>
          </div>
        )}
      </div>

      <div className="px-8 pb-8 pt-3 flex-none">
        {finished ? (
          <button
            onClick={() => router.push(`/app/dashboard?call=${callId}`)}
            className="w-full py-4 rounded-full text-base font-medium transition active:scale-[0.98] bg-slate-900 text-white hover:bg-slate-800"
          >
            View details
          </button>
        ) : (
          <button
            onClick={() => router.push('/app/dashboard')}
            className="w-full py-4 rounded-full text-base font-medium transition active:scale-[0.98] bg-white/[0.08] border border-white/20 text-white hover:bg-white/[0.12]"
          >
            Back to dashboard
          </button>
        )}
      </div>
    </div>
  );
}
