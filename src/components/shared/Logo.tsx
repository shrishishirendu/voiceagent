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

/**
 * Envoy's own wordmark + mark. It is ALREADY a link — never wrap it in another one, or
 * you get nested <a> elements and a hydration mismatch.
 *
 * `onDark` (the default) is the dark sidebar it was built for; the signed-out auth cards
 * are light, where a white wordmark would be invisible, and they link to the public
 * landing page rather than into the app.
 */
export function EnvoyLogo({
  collapsed = false,
  href = '/app/dashboard',
  onDark = true,
}: {
  collapsed?: boolean;
  href?: string;
  onDark?: boolean;
}) {
  return (
    <Link href={href} className="logo-link flex items-center gap-3 group" aria-label="Envoy">
      <IconEnvoy className="w-8 h-8 flex-none" />
      {!collapsed && (
        <span
          className={`logo-wordmark font-bold text-xl tracking-tight whitespace-nowrap ${
            onDark ? 'text-white' : 'text-slate-900'
          }`}
        >
          Envoy
        </span>
      )}
    </Link>
  );
}
