'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardBody } from '@/components/shared/Card';
import { PanelSkeleton } from '@/components/shared/Skeleton';
import { StatTile, DonutChart, VBar, type Segment } from '@/components/shared/charts/Charts';

type SegmentStats = { total: number; incoming: number; inProgress: number; resolved: number; resolutionRate: number };
type Analytics = {
  totals: { tickets: number; resolved: number; resolutionRate: number };
  channel: { outbound: number; inbound: number; other: number };
  outbound: SegmentStats;
  inbound: SegmentStats;
  perDay: { date: string; outbound: number; inbound: number }[];
};

// Categorical channel colours (red vs blue vs gray — high CVD separation; always paired
// with the donut's legend + counts so identity is never colour-alone).
const C_OUTBOUND = '#E31E24';
const C_INBOUND = '#3b82f6';
const C_OTHER = '#94a3b8';
// Status states (Incoming / In Progress / Resolved).
const S_INCOMING = '#f59e0b';
const S_PROGRESS = '#6366f1';
const S_RESOLVED = '#10b981';

function statusSegments(s: SegmentStats): Segment[] {
  return [
    { label: 'Incoming', value: s.incoming, color: S_INCOMING },
    { label: 'In Progress', value: s.inProgress, color: S_PROGRESS },
    { label: 'Resolved', value: s.resolved, color: S_RESOLVED },
  ];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/analytics', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="p-8 text-sm text-slate-500">Failed to load analytics.</div>;
  if (!data) return <div className="p-8"><PanelSkeleton rows={4} /></div>;

  const channelSegments: Segment[] = [
    { label: 'Outbound', value: data.channel.outbound, color: C_OUTBOUND },
    { label: 'Inbound', value: data.channel.inbound, color: C_INBOUND },
    ...(data.channel.other > 0 ? [{ label: 'Other', value: data.channel.other, color: C_OTHER }] : []),
  ];
  const label = (d: string) => d.slice(5); // MM-DD

  return (
    <div className="h-full flex flex-col">
      <header className="flex-none px-8 pt-8 pb-5 border-b border-slate-100">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Analytics</h1>
        <p className="text-sm text-slate-500 mt-0.5">Tickets segmented by channel — outbound (this app) and inbound (once merged).</p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatTile label="Total tickets" value={data.totals.tickets} />
          <StatTile label="Outbound" value={data.channel.outbound} accent={C_OUTBOUND} />
          <StatTile label="Inbound" value={data.channel.inbound} accent={C_INBOUND} />
          <StatTile label="Resolution rate" value={`${Math.round(data.totals.resolutionRate * 100)}%`} accent={S_RESOLVED} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><h2 className="text-sm font-semibold text-slate-900">Channel mix</h2></CardHeader>
            <CardBody>
              <DonutChart segments={channelSegments} centerLabel="tickets" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader><h2 className="text-sm font-semibold text-slate-900">Outbound status</h2></CardHeader>
            <CardBody>
              <DonutChart segments={statusSegments(data.outbound)} centerLabel="outbound" />
            </CardBody>
          </Card>
        </div>

        {/* Small multiples: one bar chart per channel (never a dual-series bar). */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Tickets per day — last 14 days</h2>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: C_OUTBOUND }} /> outbound</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: C_INBOUND }} /> inbound</span>
            </div>
          </CardHeader>
          <CardBody className="space-y-5">
            <div>
              <p className="text-xs text-slate-400 mb-1.5">Outbound</p>
              <VBar data={data.perDay.map((d) => ({ label: label(d.date), value: d.outbound }))} color={C_OUTBOUND} />
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1.5">Inbound</p>
              <VBar data={data.perDay.map((d) => ({ label: label(d.date), value: d.inbound }))} color={C_INBOUND} />
            </div>
          </CardBody>
        </Card>

        {data.channel.inbound === 0 && (
          <p className="text-xs text-slate-400">
            No inbound tickets yet — inbound analytics populate automatically once EnvoyIn&apos;s inbound tickets
            (tagged <span className="font-mono">inbound</span>) share this workspace after the merge.
          </p>
        )}
      </div>
    </div>
  );
}
