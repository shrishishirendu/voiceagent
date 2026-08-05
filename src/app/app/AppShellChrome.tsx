'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import Link from 'next/link';
import { EnvoyLogo, IsoftLogo } from '@/components/shared/Logo';
import { IconGrid, IconUpload, IconCalendar, IconGear, IconChevronRight, IconUsers, IconWallet, IconTrend, IconPie, IconLogout } from '@/components/shared/Icons';
import { SchedulerStatusPill } from './SchedulerStatusPill';
import { canSeeNav, ROLE_LABELS, type Role } from '@/lib/permissions';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: IconGrid, href: '/app/dashboard' },
  { id: 'forecasting', label: 'Forecast', icon: IconTrend, href: '/app/forecasting' },
  { id: 'analytics', label: 'Analytics', icon: IconPie, href: '/app/analytics' },
  { id: 'invoices', label: 'Invoices', icon: IconUpload, href: '/app/invoices/select' },
  { id: 'queue', label: 'Queue', icon: IconCalendar, href: '/app/queue' },
  { id: 'customers', label: 'Customers', icon: IconUsers, href: '/app/customers' },
  { id: 'payments', label: 'Payments', icon: IconWallet, href: '/app/payments' },
  { id: 'settings', label: 'Settings', icon: IconGear, href: '/app/settings' },
];

// `role` is resolved server-side in app/app/layout.tsx and passed down, rather than
// fetched here — the sidebar renders on the first paint, and a fetch would flash the full
// nav to a viewer before trimming it.
export function AppShellChrome({
  children,
  role,
  email,
}: {
  children: React.ReactNode;
  role: Role;
  email: string;
}) {
  const pathname = usePathname();
  const activeId = pathname?.split('/')[2] || 'dashboard';

  // Hiding these is presentation only — each corresponding route/API enforces the same
  // rule server-side, so typing the URL directly still gets a 403.
  const nav = NAV.filter((item) => canSeeNav(role, item.id));

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem('envoy3_sidebar_collapsed') === '1');
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      localStorage.setItem('envoy3_sidebar_collapsed', v ? '0' : '1');
      return !v;
    });
  }

  return (
    <div className="app-bg flex h-screen overflow-hidden">
      <aside className={`sidebar-bg flex-none flex flex-col py-6 px-3.5 transition-[width] duration-200 ease-out relative ${collapsed ? 'w-[80px]' : 'w-[248px]'}`}>
        <div className={`mb-9 ${collapsed ? 'flex flex-col items-center gap-3' : 'flex items-center justify-between px-2'}`}>
          <EnvoyLogo collapsed={collapsed} />
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="group/collapse flex-none w-7 h-7 rounded-lg bg-white text-slate-700 shadow-sm flex items-center justify-center hover:shadow-md hover:bg-slate-50 hover:scale-105 active:scale-95 transition-all duration-200"
          >
            <IconChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 group-hover/collapse:scale-125 ${collapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>

        <nav className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto -mr-1.5 pr-1.5">
          {nav.map(({ id, label, icon: Icon, href }) => (
            <Link
              key={id}
              href={href}
              title={collapsed ? label : undefined}
              className={`nav-btn flex items-center gap-3.5 w-full py-3 rounded-xl text-base font-medium transition-all duration-100 ${
                collapsed ? 'px-0 justify-center' : 'px-3.5'
              } ${activeId === id ? 'nav-active' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
            >
              <span className={`nav-icon nav-icon-${id} inline-flex flex-none`}>
                <Icon className="w-5 h-5" />
              </span>
              {!collapsed && <span className="whitespace-nowrap">{label}</span>}
            </Link>
          ))}
        </nav>

        <div className={`flex-none mt-3 pt-3 border-t border-white/10 ${collapsed ? 'px-0' : 'px-2'}`}>
          {/* Who am I and what can I do — the answer to "why can't I see Payments?" */}
          {!collapsed && (
            <div className="mb-3">
              <p className="text-[13px] text-white/70 font-medium truncate" title={email}>
                {email}
              </p>
              <p className="text-[11px] text-white/35 uppercase tracking-widest mt-0.5">
                {ROLE_LABELS[role]}
              </p>
            </div>
          )}
          <button
            onClick={() => signOut({ callbackUrl: '/login?notice=signed_out' })}
            title={collapsed ? 'Sign out' : undefined}
            className={`nav-btn flex items-center gap-3.5 w-full py-2.5 mb-3 rounded-xl text-sm font-medium text-white/50 hover:text-white/90 hover:bg-white/5 transition-all duration-100 ${
              collapsed ? 'px-0 justify-center' : 'px-3.5'
            }`}
          >
            <IconLogout className="w-5 h-5 flex-none" />
            {!collapsed && <span className="whitespace-nowrap">Sign out</span>}
          </button>
          <div className={`mb-3 pb-3 border-b border-white/10 ${collapsed ? 'flex justify-center' : ''}`}>
            <SchedulerStatusPill collapsed={collapsed} />
          </div>
          {!collapsed && (
            <>
              <p className="text-[11px] text-white/30 font-medium uppercase tracking-widest mb-2">Powered by</p>
              <a href="https://isoftanz.com.au/" target="_blank" rel="noopener noreferrer" className="block transition-opacity duration-150 opacity-80 hover:opacity-100">
                <IsoftLogo white className="h-6" />
              </a>
              <p className="text-[11px] text-white/20 font-mono mt-3">Envoy v3.0</p>
            </>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-hidden flex flex-col relative">
        <div className="absolute inset-0 min-h-0 overflow-hidden flex flex-col animate-view-in">{children}</div>
      </main>
    </div>
  );
}
