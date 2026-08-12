'use client';

import { TicketStatusBadge, type OutboundTicketStatus } from '@/components/shared/Badge';
import { fmtWhen } from '@/lib/format';

// Shared outbound kanban board — the Dashboard's live board. One card per outbound
// collection ticket, bucketed into three lanes by the fine-grained derived status.

export type BoardTicket = {
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

// Three board lanes bucket the five derived statuses. Labels match the requirement:
// Queued (active pipeline) · Requires attention (needs a human) · Resolved.
export const LANES: { id: string; label: string; dot: string; colBg: string; countCls: string; statuses: OutboundTicketStatus[] }[] = [
  { id: 'queued', label: 'Queued', dot: 'bg-amber-400', colBg: 'bg-amber-50/40', countCls: 'bg-amber-100 text-amber-700', statuses: ['Queued', 'Calling'] },
  { id: 'attention', label: 'Requires attention', dot: 'bg-red-400', colBg: 'bg-red-50/40', countCls: 'bg-red-100 text-red-700', statuses: ['Voicemail', 'Failed'] },
  { id: 'resolved', label: 'Resolved', dot: 'bg-emerald-400', colBg: 'bg-emerald-50/40', countCls: 'bg-emerald-100 text-emerald-700', statuses: ['Resolved'] },
];

export function cleanTitle(t: string | null): string {
  return (t ?? 'Ticket').replace(/^\[(?:CHAT|PHONE|EMAIL|SIMULATED|CALL)\]\s*/, '');
}

/** Count how many tickets fall in each lane (for KPI summary blocks). */
export function laneCounts(tickets: BoardTicket[]) {
  const in_ = (s: OutboundTicketStatus[]) => tickets.filter((t) => s.includes(t.derivedStatus)).length;
  return {
    queued: in_(['Queued', 'Calling']),
    attention: in_(['Voicemail', 'Failed']),
    resolved: in_(['Resolved']),
    total: tickets.length,
  };
}

export function TicketBoard({ tickets, onOpen }: { tickets: BoardTicket[]; onOpen: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {LANES.map((lane) => {
        const laneTickets = tickets.filter((t) => lane.statuses.includes(t.derivedStatus));
        return (
          <div key={lane.id} className={`rounded-2xl ${lane.colBg} p-3 min-h-[120px] max-h-[700px] flex flex-col`}>
            <div className="flex-none flex items-center gap-2 px-1 pb-3">
              <span className={`w-2 h-2 rounded-full ${lane.dot}`} />
              <span className="text-sm font-semibold text-slate-700">{lane.label}</span>
              <span className={`ml-auto text-[11px] font-mono px-1.5 py-0.5 rounded-full ${lane.countCls}`}>{laneTickets.length}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-hide space-y-2.5 pr-1">
              {laneTickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <span className="text-slate-300 text-lg leading-none">○</span>
                  <span className="text-[11px] text-slate-300 font-medium">No {lane.label.toLowerCase()} tickets</span>
                </div>
              ) : (
                laneTickets.map((t) => <TicketCard key={t.id} t={t} onOpen={() => onOpen(t.id)} />)
              )}
            </div>
          </div>
        );
      })}
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
      {t.customer?.businessName && cleanTitle(t.title) && cleanTitle(t.title) !== t.customer.businessName && (
        <p className="text-[11px] font-medium text-slate-500 pl-3.5 -mt-0.5 mb-1 truncate">{cleanTitle(t.title)}</p>
      )}
      {t.aiSummary
        ? <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2 pl-3.5">{t.aiSummary}</p>
        : <p className="text-[11px] text-slate-300 italic leading-relaxed pl-3.5">No summary yet</p>}
      <div className="flex items-center gap-1.5 pl-3.5 mt-1.5">
        <span className="text-[11px] text-slate-300 tabular-nums">{fmtWhen(t.updatedAt)}</span>
        {t.call?.durationSec != null && <span className="text-[11px] text-slate-300">· {t.call.durationSec}s</span>}
      </div>
    </button>
  );
}
