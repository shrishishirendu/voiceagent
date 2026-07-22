'use client';

import { useRef, useState } from 'react';

// Hand-rolled SVG line/area forecast chart (Phase 3-D), following the dataviz skill:
// a single series (history solid + forecast dashed) with a shaded confidence band,
// recessive grid, thin 2px non-scaling strokes, and a hover crosshair+tooltip. One
// series ⇒ no legend box; the title names it. No charting library.

export type ForecastPoint = { date: string; value: number; lower: number; upper: number; forecast: boolean };

const BRAND = '#E31E24';
const H = 220; // internal height (px); width is fluid via viewBox + non-scaling strokes
const PAD_T = 12;
const PAD_B = 22;

export function ForecastChart({ series, unit = '' }: { series: ForecastPoint[]; unit?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const n = series.length;
  if (n < 2) {
    return <p className="text-sm text-slate-400 py-10 text-center">Not enough history yet to forecast.</p>;
  }

  const maxV = Math.max(1, ...series.map((p) => p.upper));
  const plotH = H - PAD_T - PAD_B;
  const x = (i: number) => (i / (n - 1)) * 100; // 0..100 user units
  const y = (v: number) => PAD_T + (1 - v / maxV) * plotH;

  const firstForecast = series.findIndex((p) => p.forecast);
  const histLine = series.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  // Band polygon over the forecast region (upper across, then lower back).
  const fc = series.filter((p) => p.forecast);
  const fcStart = firstForecast === -1 ? n - 1 : firstForecast;
  const bandUpper = fc.map((p, k) => `${x(fcStart + k)},${y(p.upper)}`);
  const bandLower = fc.map((p, k) => `${x(fcStart + k)},${y(p.lower)}`).reverse();
  const bandPath = fc.length > 1 ? `${bandUpper.join(' ')} ${bandLower.join(' ')}` : '';

  // Solid history polyline (up to and including the boundary point) + dashed forecast.
  const histPts = series.slice(0, fcStart === -1 ? n : fcStart + 1).map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  const fcPts = series.slice(Math.max(0, fcStart)).map((p, k) => `${x(Math.max(0, fcStart) + k)},${y(p.value)}`).join(' ');

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxV * f));

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(f * (n - 1)));
  };

  const hp = hover !== null ? series[hover] : null;

  return (
    <div className="relative" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="overflow-visible">
        {/* recessive horizontal grid */}
        {gridVals.map((gv, i) => (
          <line key={i} x1="0" y1={y(gv)} x2="100" y2={y(gv)} stroke="#eef2f6" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {/* forecast confidence band */}
        {bandPath && <polygon points={bandPath} fill={BRAND} opacity={0.08} />}
        {/* boundary marker between history and forecast */}
        {fcStart > 0 && fcStart < n && (
          <line x1={x(fcStart)} y1={PAD_T} x2={x(fcStart)} y2={H - PAD_B} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        {/* history (solid) + forecast (dashed) */}
        <polyline points={histPts} fill="none" stroke={BRAND} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={fcPts} fill="none" stroke={BRAND} strokeWidth="2" strokeDasharray="4 3" opacity={0.65} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {/* hover crosshair + marker */}
        {hp && (
          <>
            <line x1={x(hover!)} y1={PAD_T} x2={x(hover!)} y2={H - PAD_B} stroke="#94a3b8" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover!)} cy={y(hp.value)} r="3.5" fill="#fff" stroke={BRAND} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>

      {/* y-axis labels (absolute, left) */}
      <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ top: 0 }}>
        {gridVals.map((gv, i) => (
          <span key={i} className="absolute -translate-y-1/2 text-[10px] text-slate-300 tabular-nums" style={{ top: y(gv), left: 0 }}>
            {gv}
          </span>
        ))}
      </div>

      {/* x-axis end labels */}
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>{series[0].date.slice(5)}</span>
        <span>{fcStart > 0 && fcStart < n ? series[fcStart].date.slice(5) : ''}</span>
        <span>{series[n - 1].date.slice(5)}</span>
      </div>

      {/* tooltip */}
      {hp && (
        <div
          className="absolute -top-1 px-2.5 py-1.5 rounded-md bg-slate-900 text-white text-xs whitespace-nowrap pointer-events-none -translate-x-1/2 -translate-y-full shadow-lg"
          style={{ left: `${x(hover!)}%` }}
        >
          <div className="font-medium tabular-nums">
            {hp.value}
            {unit} {hp.forecast && <span className="text-white/50">· forecast</span>}
          </div>
          <div className="text-white/60">{hp.date}{hp.forecast ? ` · ${hp.lower}–${hp.upper}` : ''}</div>
        </div>
      )}
    </div>
  );
}
