'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { CallListSkeleton } from '@/components/shared/Skeleton';
import { CallDetailDrawer } from '@/components/shared/CallDetailDrawer';
import { TicketDetailDrawer } from '@/components/shared/TicketDetailDrawer';
import { TicketBoard, laneCounts, cleanTitle, type BoardTicket } from '@/components/shared/TicketBoard';
import { DonutChart, VBar, type Segment } from '@/components/shared/charts/Charts';
import { IconPhone, IconUpload, IconRefresh, IconSearch, IconX } from '@/components/shared/Icons';
import { fmtWhen } from '@/lib/format';
import type { Call } from '@/lib/client-types';
import { useAddToast } from '@/components/shared/Toast';

const VISIBLE_STATUSES = new Set(['ringing', 'in-progress', 'completed', 'failed']);

// Validated status palette (shared with the Outbound stats).
const C = { resolved: '#10b981', voicemail: '#94a3b8', failed: '#E31E24', active: '#f59e0b' };

type Stats = {
  totalCalls: number;
  outcome: { resolved: number; voicemail: number; failed: number; active: number };
  resolutionRate: number;
  queue: { queued: number; calling: number };
  outboundTickets: { incoming: number; inProgress: number; resolved: number };
  callsPerDay: { date: string; count: number }[];
};

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ── Cursor-tracking 3D tilt card (ported from EnvoyIn's Dashboard) ──────────
function TiltCard({ bg, glow, className = '', children }: { bg: string; glow: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  function handleMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      el.style.transform = `perspective(700px) rotateX(${-(py - 0.5) * 16}deg) rotateY(${(px - 0.5) * 16}deg) scale3d(1.04,1.04,1.04)`;
      el.style.setProperty('--mx', `${px * 100}%`);
      el.style.setProperty('--my', `${py * 100}%`);
      el.style.setProperty('--glow-opacity', '1');
    });
  }
  function handleLeave() {
    const el = ref.current;
    if (!el) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    el.style.transform = 'perspective(700px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)';
    el.style.setProperty('--glow-opacity', '0');
  }
  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`tilt-card metric-card-fade rounded-2xl shadow-sm overflow-hidden ${className}`}
      style={{ background: bg, ['--glow' as string]: glow }}
    >
      {children}
      <div className="tilt-shine" />
    </div>
  );
}

function MetricCard({ label, value, sub, cfg }: { label: string; value: number | string; sub?: string; cfg: MetricStyle }) {
  if (cfg.solid) {
    return (
      <TiltCard bg={cfg.bg} glow={cfg.glow}>
        <div className="px-4 py-3.5 relative">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/70 mb-2">{label}</p>
          <p className="text-3xl font-bold tabular-nums leading-none text-white">{value}</p>
          {sub && <p className="text-[11px] text-white/70 mt-1.5">{sub}</p>}
        </div>
      </TiltCard>
    );
  }
  return (
    <div className="metric-card metric-card-interactive rounded-2xl border border-slate-100 shadow-sm overflow-hidden" style={{ background: cfg.bg, ['--glow' as string]: cfg.glow }}>
      <div className="px-4 py-3.5">
        <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${cfg.labelColor}`}>{label}</p>
        <p className={`text-3xl font-bold tabular-nums leading-none ${cfg.color}`}>{value}</p>
        {sub && <p className={`text-[11px] mt-1.5 ${cfg.subColor}`}>{sub}</p>}
      </div>
    </div>
  );
}

type MetricStyle = {
  bg: string; glow: string; solid?: boolean;
  color?: string; labelColor?: string; subColor?: string;
};
const METRIC_STYLES: Record<'total' | 'queued' | 'attention' | 'resolved', MetricStyle> = {
  total: { solid: true, bg: 'linear-gradient(135deg, #ff5c5c 0%, #E31E24 40%, #99101a 100%)', glow: 'rgba(227,30,36,0.45)' },
  queued: { bg: 'linear-gradient(135deg, #fde68a 0%, #fcd34d 100%)', glow: 'rgba(245,158,11,0.35)', color: 'text-amber-900', labelColor: 'text-amber-700', subColor: 'text-amber-700/70' },
  attention: { bg: 'linear-gradient(135deg, #fecaca 0%, #fca5a5 100%)', glow: 'rgba(239,68,68,0.35)', color: 'text-red-900', labelColor: 'text-red-700', subColor: 'text-red-700/70' },
  resolved: { bg: 'linear-gradient(135deg, #a7f3d0 0%, #6ee7b7 100%)', glow: 'rgba(16,185,129,0.35)', color: 'text-emerald-900', labelColor: 'text-emerald-700', subColor: 'text-emerald-700/70' },
};

// ── Live activity rail (recent calls, newest first) ─────────────────────────
function LiveActivity({ calls, onOpen }: { calls: Call[]; onOpen: (id: string) => void }) {
  return (
    <div className="flex flex-col min-h-0 max-h-[700px] rounded-2xl border border-slate-100 shadow-sm overflow-hidden bg-white">
      <div className="flex-none px-4 py-3.5 flex items-center gap-2 gradient-shine" style={{ background: 'linear-gradient(135deg, #ff5c5c 0%, #E31E24 40%, #99101a 100%)' }}>
        <span className="w-2 h-2 rounded-full bg-white animate-pulse flex-none" />
        <span className="text-sm font-bold text-white tracking-tight">Live Activity</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide divide-y divide-slate-50">
        {calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 px-4">
            <span className="text-xs text-slate-300 font-medium">No activity yet</span>
          </div>
        ) : (
          calls.map((call) => <ActivityItem key={call.id} call={call} onClick={() => onOpen(call.id)} />)
        )}
      </div>
    </div>
  );
}

function ActivityItem({ call, onClick }: { call: Call; onClick: () => void }) {
  const outcome = call.outcome;
  const settled = call.status === 'completed' || call.status === 'failed';
  const statusLabel = !settled
    ? 'In progress'
    : outcome === 'success' || outcome === 'partial'
      ? 'Resolved'
      : outcome === 'no-answer'
        ? 'Voicemail / no answer'
        : 'Failed';
  const dotCls = !settled
    ? 'bg-blue-400'
    : outcome === 'success' || outcome === 'partial'
      ? 'bg-emerald-400'
      : outcome === 'no-answer'
        ? 'bg-slate-300'
        : 'bg-brand';
  return (
    <button onClick={onClick} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors duration-100 flex items-start gap-2.5 group">
      <span className={`w-1.5 h-1.5 rounded-full flex-none mt-1.5 ${dotCls}`} />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-slate-800 leading-snug truncate group-hover:text-brand transition-colors">
          {statusLabel} · {call.contactBusiness}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-slate-400 truncate">{call.invoiceNumber ? `Invoice #${call.invoiceNumber}` : call.toNumber}</span>
          <span className="text-[10px] text-slate-300 ml-auto flex-none tabular-nums">{fmtWhen(call.createdAt)}</span>
        </div>
      </div>
    </button>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<CallListSkeleton />}>
      <DashboardPageInner />
    </Suspense>
  );
}

type StatusFilter = 'all' | 'queued' | 'attention' | 'resolved';
type OutcomeFilter = 'all' | 'success' | 'no-answer' | 'failed';

function DashboardPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const addToast = useAddToast();

  const [calls, setCalls] = useState<Call[]>([]);
  const [tickets, setTickets] = useState<BoardTicket[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const selectedCallId = searchParams.get('call');

  const fetchData = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      else setRefreshing(true);
      Promise.all([
        fetch('/api/calls', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ calls: [] })),
        fetch('/api/tickets?tag=outbound', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ tickets: [] })),
        fetch('/api/outbound/stats', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
        .then(([c, t, s]) => {
          setCalls(Array.isArray(c.calls) ? c.calls : []);
          setTickets(Array.isArray(t.tickets) ? t.tickets : []);
          if (s) setStats(s);
        })
        .catch(() => addToast('Failed to load dashboard', 'error'))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [addToast]
  );

  useEffect(() => {
    fetchData();
    const id = setInterval(() => fetchData({ silent: true }), 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCall(id: string) {
    router.push(`${pathname}?call=${id}`, { scroll: false });
  }
  function closeCall() {
    router.replace(pathname, { scroll: false });
  }

  const hasActiveFilters = q !== '' || status !== 'all' || outcome !== 'all' || dateFrom !== '' || dateTo !== '';
  function clearFilters() {
    setQ(''); setStatus('all'); setOutcome('all'); setDateFrom(''); setDateTo('');
  }

  const inRange = useCallback(
    (iso: string) => {
      const d = iso.slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    },
    [dateFrom, dateTo]
  );

  const STATUS_SET: Record<Exclude<StatusFilter, 'all'>, string[]> = {
    queued: ['Queued', 'Calling'],
    attention: ['Voicemail', 'Failed'],
    resolved: ['Resolved'],
  };

  const filteredTickets = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tickets.filter((t) => {
      if (needle) {
        const hay = [t.title, t.requester, t.customer?.businessName, t.aiSummary].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (status !== 'all' && !STATUS_SET[status].includes(t.derivedStatus)) return false;
      if (outcome !== 'all' && t.call?.outcome !== outcome) return false;
      if (!inRange(t.createdAt)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, q, status, outcome, inRange]);

  const visibleCalls = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return calls
      .filter((c) => VISIBLE_STATUSES.has(c.status))
      .filter((c) => (needle ? [c.contactBusiness, c.toNumber, c.invoiceNumber].filter(Boolean).join(' ').toLowerCase().includes(needle) : true))
      .filter((c) => inRange(c.createdAt))
      .filter((c) => (outcome !== 'all' ? c.outcome === outcome : true))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [calls, q, outcome, inRange]);

  const counts = laneCounts(filteredTickets);
  const resolvedPct = counts.total > 0 ? Math.round((counts.resolved / counts.total) * 100) : 0;

  const outcomeSegments: Segment[] = stats
    ? [
        { label: 'Resolved', value: stats.outcome.resolved, color: C.resolved },
        { label: 'Voicemail / no answer', value: stats.outcome.voicemail, color: C.voicemail },
        { label: 'Failed', value: stats.outcome.failed, color: C.failed },
        { label: 'In progress', value: stats.outcome.active, color: C.active },
      ].filter((s) => s.value > 0)
    : [];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
            <p className="text-sm text-slate-400 mt-1">Live outbound board · auto-refreshes every 15s.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-gradient gradient-shine" onClick={() => fetchData({ silent: true })} disabled={refreshing}>
              <IconRefresh className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <Button variant="secondary" icon={<IconUpload className="w-4 h-4" />} onClick={() => router.push('/app/invoices/select')}>
              Select invoice
            </Button>
            <Button variant="primary" icon={<IconPhone className="w-4 h-4" />} onClick={() => router.push('/app/calls/new')}>
              New call
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative">
            <IconSearch className="w-4 h-4 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="input text-xs !py-2 pl-9 w-64" placeholder="Search business, invoice…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input text-xs !py-2 !w-auto" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">All statuses</option>
            <option value="queued">Queued</option>
            <option value="attention">Requires attention</option>
            <option value="resolved">Resolved</option>
          </select>
          <select className="input text-xs !py-2 !w-auto" value={outcome} onChange={(e) => setOutcome(e.target.value as OutcomeFilter)}>
            <option value="all">All outcomes</option>
            <option value="success">Resolved</option>
            <option value="no-answer">Voicemail / no answer</option>
            <option value="failed">Failed</option>
          </select>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <input type="date" className="input text-xs !py-2 !w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
            <span>–</span>
            <input type="date" className="input text-xs !py-2 !w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
          </div>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-xs text-slate-400 hover:text-brand transition-colors flex items-center gap-1">
              <IconX className="w-3 h-3" /> Clear filters
            </button>
          )}
        </div>

        {/* KPI summary blocks */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Total calls" value={counts.total} sub="collection tickets" cfg={METRIC_STYLES.total} />
          <MetricCard label="Queued" value={counts.queued} sub="in the pipeline" cfg={METRIC_STYLES.queued} />
          <MetricCard label="Requires attention" value={counts.attention} sub="voicemail or failed" cfg={METRIC_STYLES.attention} />
          <MetricCard label="Resolved" value={counts.resolved} sub={`${resolvedPct}% of tickets`} cfg={METRIC_STYLES.resolved} />
        </div>

        {loading ? (
          <CallListSkeleton />
        ) : (
          <div className="flex flex-col xl:flex-row gap-6">
            {/* Main column: charts + kanban */}
            <div className="flex-1 min-w-0 space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>Call outcomes</CardHeader>
                  <CardBody>
                    {outcomeSegments.length > 0 ? (
                      <DonutChart segments={outcomeSegments} centerLabel="calls" />
                    ) : (
                      <p className="text-sm italic text-slate-400 py-8 text-center">No calls yet.</p>
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader>Calls per day · last 14 days</CardHeader>
                  <CardBody>
                    {stats && stats.callsPerDay.some((d) => d.count > 0) ? (
                      <>
                        <VBar data={stats.callsPerDay.map((d) => ({ label: dayLabel(d.date), value: d.count }))} color={C.failed} />
                        <div className="flex justify-between mt-2 text-[11px] text-slate-400">
                          <span>{dayLabel(stats.callsPerDay[0].date)}</span>
                          <span>{dayLabel(stats.callsPerDay[stats.callsPerDay.length - 1].date)}</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm italic text-slate-400 py-8 text-center">No calls in the last 14 days.</p>
                    )}
                  </CardBody>
                </Card>
              </div>

              <div className="xl:min-h-screen">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Live board</h2>
                <div className="xl:sticky xl:top-2">
                  {filteredTickets.length === 0 ? (
                    <div className="text-center py-16 rounded-2xl border border-dashed border-slate-200">
                      <p className="font-display text-base italic text-slate-400">{tickets.length === 0 ? 'No outbound tickets yet.' : 'No tickets match your filters.'}</p>
                      <p className="text-xs text-slate-400 mt-1">Dispatch a call from the Queue or an invoice to create one.</p>
                    </div>
                  ) : (
                    <TicketBoard tickets={filteredTickets} onOpen={setOpenTicketId} />
                  )}
                </div>
              </div>
            </div>

            {/* Right rail: live activity */}
            <aside className="w-full xl:w-72 flex-none">
              <div className="xl:sticky xl:top-2">
                <LiveActivity calls={visibleCalls} onOpen={openCall} />
              </div>
            </aside>
          </div>
        )}
      </div>

      <CallDetailDrawer callId={selectedCallId} onClose={closeCall} />
      <TicketDetailDrawer ticketId={openTicketId} onClose={() => setOpenTicketId(null)} onChanged={() => fetchData({ silent: true })} />
    </div>
  );
}
