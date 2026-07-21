'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { EnvoyLogo, IsoftLogo } from '@/components/shared/Logo';
import { IconGrid, IconPhone, IconUpload, IconCalendar, IconGear, IconChevronRight, IconUsers } from '@/components/shared/Icons';
import { SchedulerStatusPill } from './SchedulerStatusPill';

const NAV = [
  { id: 'dashboard', label: 'Home', icon: IconGrid, href: '/app/dashboard' },
  { id: 'calls', label: 'New Call', icon: IconPhone, href: '/app/calls/new', iconKey: 'new-call' },
  { id: 'invoices', label: 'Invoices', icon: IconUpload, href: '/app/invoices/select' },
  { id: 'queue', label: 'Queue', icon: IconCalendar, href: '/app/queue' },
  { id: 'contacts', label: 'Contacts', icon: IconUsers, href: '/app/contacts' },
  { id: 'settings', label: 'Settings', icon: IconGear, href: '/app/settings' },
];

export function AppShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const activeId = pathname?.split('/')[2] || 'dashboard';

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

        <nav className="flex flex-col gap-1.5">
          {NAV.map(({ id, label, icon: Icon, href, iconKey }) => (
            <Link
              key={id}
              href={href}
              title={collapsed ? label : undefined}
              className={`nav-btn flex items-center gap-3.5 w-full py-3 rounded-xl text-base font-medium transition-all duration-100 ${
                collapsed ? 'px-0 justify-center' : 'px-3.5'
              } ${activeId === id ? 'nav-active' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
            >
              <span className={`nav-icon nav-icon-${iconKey ?? id} inline-flex flex-none`}>
                <Icon className="w-5 h-5" />
              </span>
              {!collapsed && <span className="whitespace-nowrap">{label}</span>}
            </Link>
          ))}
        </nav>

        <div className={`mt-auto ${collapsed ? 'px-0' : 'px-2'}`}>
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
