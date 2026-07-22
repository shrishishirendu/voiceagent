'use client';

import { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/shared/Card';
import { PanelSkeleton } from '@/components/shared/Skeleton';
import { StatTile, DonutChart, VBar, type Segment } from '@/components/shared/charts/Charts';

type Stats = {
  totalCalls: number;
  outcome: { resolved: number; voicemail: number; failed: number; active: number };
  resolutionRate: number;
  queue: { queued: number; calling: number };
  outboundTickets: { incoming: number; inProgress: number; resolved: number };
  callsPerDay: { date: string; count: number }[];
};

// Status palette (validated with the dataviz skill's checks) — reserved status hues,
// each always shown with a text label + legend, never color-alone.
const C = { resolved: '#10b981', voicemail: '#94a3b8', failed: '#E31E24', active: '#f59e0b' };

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function OutboundPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/outbound/stats', { cache: 'no-store' });
        if (r.ok) setStats(await r.json());
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const outcomeSegments: Segment[] = stats
    ? [
        { label: 'Resolved', value: stats.outcome.resolved, color: C.resolved },
        { label: 'Voicemail / no answer', value: stats.outcome.voicemail, color: C.voicemail },
        { label: 'Failed', value: stats.outcome.failed, color: C.failed },
        { label: 'In progress', value: stats.outcome.active, color: C.active },
      ].filter((s) => s.value > 0)
    : [];

  return (
    <div className="h-full flex flex-col">
      <header className="flex-none px-8 pt-8 pb-5 border-b border-slate-100">
        <h1 className="font-display text-2xl font-semibold text-slate-900 tracking-tight">Outbound</h1>
        <p className="mt-1 text-sm text-slate-500">Queued, resolved and voicemail breakdown across your collection calls.</p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 space-y-6">
        {loading && <PanelSkeleton />}

        {!loading && stats && (
          <>
            {/* KPI row — hero numbers */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatTile label="Total calls" value={stats.totalCalls} />
              <StatTile label="Resolution rate" value={`${Math.round(stats.resolutionRate * 100)}%`} accent={C.resolved} sub="of calls that reached a person" />
              <StatTile label="Queued invoices" value={stats.queue.queued} sub={stats.queue.calling > 0 ? `${stats.queue.calling} in progress` : undefined} />
              <StatTile label="Voicemail / no answer" value={stats.outcome.voicemail} accent={C.voicemail} />
            </div>

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
                  {stats.callsPerDay.some((d) => d.count > 0) ? (
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

            {/* Outbound ticket status */}
            <Card>
              <CardHeader>Outbound tickets</CardHeader>
              <CardBody>
                <div className="grid grid-cols-3 gap-4">
                  <StatTile label="Incoming" value={stats.outboundTickets.incoming} />
                  <StatTile label="In progress" value={stats.outboundTickets.inProgress} accent={C.active} />
                  <StatTile label="Resolved" value={stats.outboundTickets.resolved} accent={C.resolved} />
                </div>
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
