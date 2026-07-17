'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { SchedulerSettings } from '@/lib/client-types';

/** Replaces EnvoyIn's signed-in-user block — the most relevant always-visible state for
 * an unauthenticated, single-tenant ops tool is whether the scheduler worker is actively
 * dialing the queue, not who's logged in (there's no auth here). */
export function SchedulerStatusPill({ collapsed }: { collapsed: boolean }) {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/settings', { cache: 'no-store' });
        if (!r.ok || !alive) return;
        const data = (await r.json()) as SchedulerSettings;
        if (alive) setOn(data.schedulerOn);
      } catch {
        // non-blocking — pill just stays in its loading state
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const dotClass = on == null ? 'bg-white/20' : on ? 'bg-emerald-400' : 'bg-white/25';

  if (collapsed) {
    return (
      <Link href="/app/settings" title={on == null ? 'Scheduler status' : on ? 'Scheduler: On' : 'Scheduler: Off'} className="flex justify-center">
        <span className={`inline-block w-2 h-2 rounded-full ${dotClass} ${on ? 'dot-pulse' : ''}`} />
      </Link>
    );
  }

  return (
    <Link href="/app/settings" className="flex items-center gap-2 rounded-lg -mx-1 px-1 py-1 hover:bg-white/5 transition-colors group">
      <span className={`inline-block w-2 h-2 rounded-full flex-none ${dotClass} ${on ? 'dot-pulse' : ''}`} />
      <span className="text-xs text-white/50 group-hover:text-white/80 transition-colors">
        Scheduler: {on == null ? '…' : on ? 'On' : 'Off'}
      </span>
    </Link>
  );
}
