'use client';

import { useEffect, useMemo, useState } from 'react';
import { PanelSkeleton } from '@/components/shared/Skeleton';
import { TicketStatusBadge, Pill, type OutboundTicketStatus } from '@/components/shared/Badge';
import { TicketDetailDrawer } from '@/components/shared/TicketDetailDrawer';
import { IconRefresh, IconSearch } from '@/components/shared/Icons';
import { fmtWhen } from '@/lib/format';

type BoardTicket = {
  id: string;
  title: string | null;
  requester: string | null;
  channel: string;
  status: string;
  derivedStatus: OutboundTicketStatus;
  aiSummary: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  call: { id: string; status: string; outcome: string | null; durationSec: number | null } | null;
  customer: { id: string; businessName: string } | null;
};

// Fine-grained outbound status → 4px left-accent (hex, applied inline so it wins over the
// card's all-sides border) + dot color (matches TicketStatusBadge hues).
const ACCENT: Record<OutboundTicketStatus, { border: string; dot: string }> = {
  Queued: { border: '#f59e0b', dot: 'bg-amber-400' },
  Calling: { border: '#3b82f6', dot: 'bg-blue-500' },
  Voicemail: { border: '#cbd5e1', dot: 'bg-slate-300' },
  Failed: { border: '#E31E24', dot: 'bg-red-500' },
  Resolved: { border: '#10b981', dot: 'bg-emerald-500' },
};

// Three board lanes bucket the five derived statuses.
const LANES: { id: string; label: string; dot: string; colBg: string; countCls: string; statuses: OutboundTicketStatus[] }[] = [
  { id: 'in_progress', label: 'In progress', dot: 'bg-blue-400', colBg: 'bg-blue-50/40', countCls: 'bg-blue-100 text-blue-700', statuses: ['Queued', 'Calling'] },
  { id: 'follow_up', label: 'Needs follow-up', dot: 'bg-amber-400', colBg: 'bg-amber-50/40', countCls: 'bg-amber-100 text-amber-700', statuses: ['Voicemail', 'Failed'] },
  { id: 'resolved', label: 'Resolved', dot: 'bg-emerald-400', colBg: 'bg-emerald-50/40', countCls: 'bg-emerald-100 text-emerald-700', statuses: ['Resolved'] },
];

function cleanTitle(t: string | null): string {
  return (t ?? 'Ticket').replace(/^\[(?:CHAT|PHONE|EMAIL|SIMULATED|CALL)\]\s*/, '');
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<BoardTicket[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'board' | 'table'>('board');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  async function load(showSpinner = false) {
    if (showSpinner) setRefreshing(true);
    try {
      const r = await fetch('/api/tickets?tag=outbound', { cache: 'no-store' });
      if (r.ok) setTickets((await r.json()).tickets);
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!tickets) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return tickets;
    return tickets.filter((t) => {
      const hay = [t.title, t.requester, t.customer?.businessName, t.aiSummary].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [tickets, q]);

  return (
    <div className="h-full flex flex-col">
      <header className="flex-none px-6 py-4 border-b border-slate-100 bg-white/80 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Tickets</h1>
            <p className="text-xs text-slate-400">Outbound collection tickets · one per call</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <IconSearch className="w-4 h-4 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="input text-xs !py-1.5 pl-9 w-56"
                placeholder="Search business, invoice…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
              {(['board', 'table'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 capitalize transition-colors ${view === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <button className="btn-secondary text-xs !py-1.5" onClick={() => load(true)} disabled={refreshing}>
              <IconRefresh className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {tickets === null ? (
          <PanelSkeleton rows={4} />
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="font-display text-base italic text-slate-400">No outbound tickets yet.</p>
            <p className="text-xs text-slate-400 mt-1">Dispatch a call from the Queue or an invoice to create one.</p>
          </div>
        ) : view === 'board' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {LANES.map((lane) => {
              const laneTickets = filtered.filter((t) => lane.statuses.includes(t.derivedStatus));
              return (
                <div key={lane.id} className={`rounded-2xl ${lane.colBg} p-3 min-h-[120px]`}>
                  <div className="flex items-center gap-2 px-1 pb-3">
                    <span className={`w-2 h-2 rounded-full ${lane.dot}`} />
                    <span className="text-sm font-semibold text-slate-700">{lane.label}</span>
                    <span className={`ml-auto text-[11px] font-mono px-1.5 py-0.5 rounded-full ${lane.countCls}`}>{laneTickets.length}</span>
                  </div>
                  <div className="space-y-2.5">
                    {laneTickets.map((t) => (
                      <TicketCard key={t.id} t={t} onOpen={() => setOpenId(t.id)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card overflow-hidden !p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2.5 font-semibold">Business</th>
                  <th className="px-4 py-2.5 font-semibold">Ticket</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Channel</th>
                  <th className="px-4 py-2.5 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((t) => (
                  <tr key={t.id} onClick={() => setOpenId(t.id)} className="cursor-pointer hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{t.customer?.businessName || t.requester || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-[280px] truncate">{cleanTitle(t.title)}</td>
                    <td className="px-4 py-3"><TicketStatusBadge status={t.derivedStatus} /></td>
                    <td className="px-4 py-3"><Pill className="capitalize">{t.channel}</Pill></td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{fmtWhen(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TicketDetailDrawer ticketId={openId} onClose={() => setOpenId(null)} onChanged={() => load()} />
    </div>
  );
}

function TicketCard({ t, onOpen }: { t: BoardTicket; onOpen: () => void }) {
  const accent = ACCENT[t.derivedStatus] ?? ACCENT.Queued;
  return (
    <button
      onClick={onOpen}
      style={{ borderLeftColor: accent.border, borderLeftWidth: 4 }}
      className="row-card group w-full text-left bg-white rounded-2xl border border-slate-100 px-4 py-3 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-start gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full flex-none mt-1.5 ${accent.dot}`} />
          <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2 min-w-0">
            {t.customer?.businessName || t.requester || cleanTitle(t.title)}
          </p>
        </div>
        <TicketStatusBadge status={t.derivedStatus} />
      </div>
      {t.aiSummary && <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2 pl-3.5">{t.aiSummary}</p>}
      <div className="flex items-center gap-1.5 pl-3.5 mt-1.5">
        <span className="text-[11px] text-slate-300 tabular-nums">{fmtWhen(t.updatedAt)}</span>
        {t.call?.durationSec != null && <span className="text-[11px] text-slate-300">· {t.call.durationSec}s</span>}
      </div>
    </button>
  );
}
