'use client';

import { useState } from 'react';

// Hand-rolled SVG chart primitives for the Outbound dashboard, following EnvoyIn's
// Analytics convention (no charting library) and the dataviz skill's mark specs:
// thin marks, 4px rounded bar-ends anchored to the baseline, a 2px surface gap
// between donut segments, a legend always present for >=2 series, and a hover layer.

export type Segment = { label: string; value: number; color: string };

// ── Stat tile (hero number — no plot) ────────────────────────────────────
export function StatTile({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="card p-5">
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">{label}</p>
      <p className="text-3xl font-semibold text-slate-900 mt-1 tabular-nums" style={accent ? { color: accent } : undefined}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── Donut (part-to-whole for a small set of status categories) ───────────
export function DonutChart({ segments, centerLabel }: { segments: Segment[]; centerLabel?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const size = 168;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 0 ? 2 : 0; // 2px surface gap between segments

  let offset = 0;
  const arcs = segments.map((seg, i) => {
    const frac = total > 0 ? seg.value / total : 0;
    const len = Math.max(0, frac * c - gap);
    const arc = (
      <circle
        key={i}
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={seg.color}
        strokeWidth={active === i ? stroke + 3 : stroke}
        strokeDasharray={`${len} ${c - len}`}
        strokeDashoffset={-offset}
        strokeLinecap="butt"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-[stroke-width] duration-150 cursor-pointer"
        onMouseEnter={() => setActive(i)}
        onMouseLeave={() => setActive(null)}
        style={{ opacity: active === null || active === i ? 1 : 0.5 }}
      />
    );
    offset += frac * c;
    return arc;
  });

  const shown = active !== null ? segments[active] : null;
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

  return (
    <div className="flex items-center gap-6">
      <div className="relative flex-none" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          {total === 0 ? (
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
          ) : arcs}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {shown ? (
            <>
              <span className="text-2xl font-semibold text-slate-900 tabular-nums">{pct(shown.value)}%</span>
              <span className="text-[11px] text-slate-400">{shown.label}</span>
            </>
          ) : (
            <>
              <span className="text-2xl font-semibold text-slate-900 tabular-nums">{total}</span>
              <span className="text-[11px] text-slate-400">{centerLabel ?? 'total'}</span>
            </>
          )}
        </div>
      </div>

      <ul className="space-y-1.5 min-w-0">
        {segments.map((seg, i) => (
          <li
            key={i}
            className="flex items-center gap-2.5 text-sm cursor-default rounded px-1 -mx-1 transition-colors"
            style={{ background: active === i ? '#f1f5f9' : 'transparent' }}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="w-2.5 h-2.5 rounded-sm flex-none" style={{ background: seg.color }} />
            <span className="text-slate-600 flex-1">{seg.label}</span>
            <span className="text-slate-900 font-medium tabular-nums">{seg.value}</span>
            <span className="text-slate-400 tabular-nums w-9 text-right">{pct(seg.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Vertical bars (change over time) ─────────────────────────────────────
export function VBar({ data, color = '#E31E24', height = 140 }: { data: { label: string; value: number }[]; color?: string; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = 100 / (data.length * 1.5);
  const gap = barW * 0.5;

  return (
    <div className="relative">
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="overflow-visible">
        {/* recessive baseline */}
        <line x1="0" y1={height - 0.5} x2="100" y2={height - 0.5} stroke="#e2e8f0" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 12);
          const x = i * (barW + gap) + gap / 2;
          const y = height - h;
          return (
            <rect
              key={i}
              x={x}
              y={h > 0 ? y : height - 2}
              width={barW}
              height={h > 0 ? h : 2}
              rx="1.5"
              fill={color}
              className="transition-opacity duration-150"
              style={{ opacity: active === null || active === i ? 1 : 0.4 }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            />
          );
        })}
      </svg>
      {active !== null && (
        <div
          className="absolute -top-1 px-2 py-1 rounded-md bg-slate-900 text-white text-xs whitespace-nowrap pointer-events-none -translate-x-1/2 -translate-y-full shadow-lg"
          style={{ left: `${(active * (barW + gap) + gap / 2 + barW / 2)}%` }}
        >
          <span className="font-medium tabular-nums">{data[active].value}</span> · {data[active].label}
        </div>
      )}
    </div>
  );
}
