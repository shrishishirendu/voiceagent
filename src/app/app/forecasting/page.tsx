'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardBody } from '@/components/shared/Card';
import { PanelSkeleton } from '@/components/shared/Skeleton';
import { StatTile } from '@/components/shared/charts/Charts';
import { ForecastChart, type ForecastPoint } from '@/components/shared/charts/ForecastChart';
import { fmtAmount } from '@/lib/format';

type ForecastResponse = {
  series: ForecastPoint[];
  horizon: number;
  projectedActivity: number;
  upcomingDue: number;
  recentCollections: number;
  lookbackDays: number;
};

export default function ForecastingPage() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/forecasting', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="p-8 text-sm text-slate-500">Failed to load forecast.</div>;
  if (!data) return <div className="p-8"><PanelSkeleton rows={4} /></div>;

  return (
    <div className="h-full flex flex-col">
      <header className="flex-none px-8 pt-8 pb-5 border-b border-slate-100">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Forecast</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Projected from your live activity — trend + weekly seasonality over the last {data.lookbackDays} days.
        </p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label={`Projected activity (${data.horizon}d)`} value={data.projectedActivity} sub="outbound tickets" />
          <StatTile label={`Upcoming due (${data.horizon}d)`} value={fmtAmount('AUD', data.upcomingDue) || '$0'} sub="open invoices due soon" accent="#f59e0b" />
          <StatTile label={`Collected (${data.lookbackDays}d)`} value={fmtAmount('AUD', data.recentCollections) || '$0'} sub="payments received" accent="#10b981" />
        </div>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Outbound workload — tickets per day</h2>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: '#E31E24' }} /> history</span>
              <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: '#E31E24', opacity: 0.65 }} /> forecast</span>
            </div>
          </CardHeader>
          <CardBody className="pl-6">
            <ForecastChart series={data.series} />
          </CardBody>
        </Card>

        <p className="text-xs text-slate-400">
          The forecast decomposes daily ticket activity into a linear trend, a day-of-week seasonal pattern, and a
          short-term (AR1) carry, then projects {data.horizon} days forward with an ~80% confidence band. Cash tiles come
          from live invoice due-dates and recorded payments.
        </p>
      </div>
    </div>
  );
}
