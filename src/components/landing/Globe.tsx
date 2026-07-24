'use client';

import { useEffect, useRef, useState } from 'react';
import { GLOBE_LAND_LATLON } from './globeLandPoints';

// Canvas dot-globe, ported from EnvoyIn's RotatingGlobe. GLOBE_LAND_LATLON is real country
// boundary data (see globeLandPoints.ts), so the globe traces coastlines rather than being an
// even scatter. For Envoy (outbound), it reads as "every call radiating out from the AU HQ."

const LAND_XYZ: [number, number, number][] = (() => {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < GLOBE_LAND_LATLON.length; i += 2) {
    const lat = (GLOBE_LAND_LATLON[i] * Math.PI) / 180;
    const lon = (GLOBE_LAND_LATLON[i + 1] * Math.PI) / 180;
    const y = Math.sin(lat);
    const x = Math.cos(lat) * Math.cos(lon);
    const z = Math.cos(lat) * Math.sin(lon);
    pts.push([x, y, z]);
  }
  return pts;
})();

type Side = 'right' | 'left' | 'top' | 'bottom';

// iSOFT office locations — pins fade in on the near side, fade out on the far side.
const OFFICES: { name: string; lat: number; lon: number; side: Side }[] = [
  { name: 'Sydney · HQ', lat: -33.8, lon: 151.08, side: 'right' },
  { name: 'Albury/Wodonga', lat: -36.0737, lon: 146.9135, side: 'bottom' },
  { name: 'Melbourne', lat: -37.8136, lon: 144.9631, side: 'left' },
  { name: 'Noida', lat: 28.5355, lon: 77.391, side: 'top' },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198, side: 'right' },
];
const OFFICE_XYZ = OFFICES.map(({ name, lat, lon, side }) => {
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  return { name, side, xyz: [Math.cos(latR) * Math.cos(lonR), Math.sin(latR), Math.cos(latR) * Math.sin(lonR)] as [number, number, number] };
});

const LABEL_OFFSET: Record<Side, { flex: string; gap: string; shift: string }> = {
  right: { flex: 'flex-row', gap: '0.375rem', shift: 'translate(10px, -50%)' },
  left: { flex: 'flex-row-reverse', gap: '0.375rem', shift: 'translate(calc(-100% - 10px), -50%)' },
  top: { flex: 'flex-col-reverse', gap: '0.25rem', shift: 'translate(-50%, calc(-100% - 10px))' },
  bottom: { flex: 'flex-col', gap: '0.25rem', shift: 'translate(-50%, 10px)' },
};

export function RotatingGlobe({ className = '', size = 640 }: { className?: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rotRef = useRef({ x: 0.4, y: 0 });
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const effectiveSize = compact ? Math.min(size, 320) : size;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = effectiveSize * dpr;
    canvas.height = effectiveSize * dpr;
    canvas.style.width = `${effectiveSize}px`;
    canvas.style.height = `${effectiveSize}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;

    function draw() {
      if (!ctx) return;
      const { x: rotX, y: rotY } = rotRef.current;
      ctx.clearRect(0, 0, effectiveSize, effectiveSize);

      const cx = effectiveSize / 2;
      const cy = effectiveSize / 2;
      const scale = effectiveSize * 0.44;
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);

      const projected = LAND_XYZ.map(([x, y, z]) => {
        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        return [x1, y2, z2] as [number, number, number];
      });
      projected.sort((a, b) => a[2] - b[2]);

      for (const [x, y, z] of projected) {
        const depth = (z + 1) / 2;
        const px = cx - x * scale;
        const py = cy - y * scale;
        const r = 0.4 + depth * 1.15;
        const alpha = 0.16 + depth * 0.78;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(227, 30, 36, ${alpha})`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(227, 30, 36, 0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();

      OFFICE_XYZ.forEach(({ xyz: [x, y, z] }, i) => {
        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        const px = cx - x1 * scale;
        const py = cy - y2 * scale;
        const facing = Math.max(0, Math.min(1, (z2 + 0.12) / 0.5));
        const el = markerRefs.current[i];
        if (el) {
          el.style.setProperty('--px', `${px}px`);
          el.style.setProperty('--py', `${py}px`);
          el.style.opacity = String(facing);
          el.style.pointerEvents = facing > 0.2 ? 'auto' : 'none';
        }
      });

      if (!dragRef.current.dragging && !reduceMotion) {
        rotRef.current.y += 0.0016;
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    function onDown(e: PointerEvent) {
      dragRef.current.dragging = true;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      canvas?.setPointerCapture?.(e.pointerId);
    }
    function onMove(e: PointerEvent) {
      if (!dragRef.current.dragging) return;
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      rotRef.current.y += dx * 0.006;
      rotRef.current.x = Math.max(-1.15, Math.min(1.15, rotRef.current.x + dy * 0.006));
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    }
    function onUp() { dragRef.current.dragging = false; }

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [effectiveSize]);

  return (
    <div className={`relative select-none ${className}`} style={{ width: effectiveSize, height: effectiveSize }}>
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(227,30,36,0.4) 0%, rgba(227,30,36,0.1) 45%, transparent 72%)', filter: 'blur(28px)' }}
      />
      <canvas ref={canvasRef} className="relative cursor-grab active:cursor-grabbing touch-none" />

      <div className="absolute inset-0 pointer-events-none">
        {OFFICE_XYZ.map(({ name, side }, i) => {
          const cfg = LABEL_OFFSET[side];
          return (
            <div
              key={name}
              ref={(el) => { markerRefs.current[i] = el; }}
              className="globe-pin absolute left-0 top-0"
              style={{ opacity: 0, transform: 'translate(var(--px, 0), var(--py, 0)) translate(-50%, -50%)' }}
            >
              <span className="block w-1.5 h-1.5 rounded-full bg-white ring-2 ring-brand" style={{ boxShadow: '0 0 6px 2px rgba(227,30,36,0.6)' }} />
              {!compact && (
                <div
                  className={`globe-pin-label absolute top-1/2 left-1/2 z-0 hover:z-20 flex items-center ${cfg.flex} pointer-events-auto`}
                  style={{ gap: cfg.gap, transform: cfg.shift }}
                >
                  <span className="text-[10px] font-semibold text-white/85 bg-[#1a0209]/90 border border-brand/40 rounded-full px-2 py-0.5 whitespace-nowrap transition-colors duration-150 hover:text-white hover:bg-brand hover:border-brand">
                    {name}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
