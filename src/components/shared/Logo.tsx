'use client';

import Link from 'next/link';
import { IconEnvoy } from './Icons';

/**
 * iSOFT brand logo (transparent PNGs), same assets as EnvoyIn.
 * `white`: render in pure white for dark backgrounds (sidebar footer).
 */
export function IsoftLogo({ className = 'h-8', tagline = false, white = false }: { className?: string; tagline?: boolean; white?: boolean }) {
  const src = tagline ? '/isoft-logo.png' : '/isoft-wordmark.png';
  return (
    <img
      src={src}
      alt="iSOFT — Valuing Relationships, Delivering Outcomes"
      className={className}
      draggable={false}
      style={white ? { filter: 'brightness(0) invert(1)' } : undefined}
    />
  );
}

/** Envoy's own wordmark + mark, used in the sidebar header. */
export function EnvoyLogo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link href="/app/dashboard" className="logo-link flex items-center gap-3 group">
      <IconEnvoy className="w-8 h-8 flex-none" />
      {!collapsed && <span className="logo-wordmark text-white font-bold text-xl tracking-tight whitespace-nowrap">Envoy</span>}
    </Link>
  );
}
