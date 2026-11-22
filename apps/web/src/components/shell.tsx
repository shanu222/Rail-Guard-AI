'use client';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Bell,
  ClipboardCheck,
  ClipboardList,
  Cpu,
  Gauge,
  LogOut,
  Map as MapIcon,
  Menu,
  ScanSearch,
  Settings,
  ShieldAlert,
  TrainTrack,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { Permission } from '@railguard/shared';
import { DEMO_MODE, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLive } from '@/lib/live';
import { Badge, SkeletonRows, cn } from './ui';

const NAV: {
  href: string;
  label: string;
  icon: typeof Gauge;
  perm?: Permission;
  roles?: string[];
}[] = [
  { href: '/overview', label: 'Overview', icon: Gauge },
  { href: '/risk-map', label: 'Risk Map', icon: MapIcon },
  { href: '/detections', label: 'Detections', icon: ScanSearch },
  { href: '/review', label: 'Inspector Review', icon: ClipboardCheck, perm: 'detections:review' },
  { href: '/crossings', label: 'Level Crossings', icon: TrainTrack },
  { href: '/work-orders', label: 'Work Orders', icon: ClipboardList },
  { href: '/devices', label: 'Devices', icon: Cpu },
  { href: '/analytics', label: 'Analytics & Reports', icon: BarChart3, perm: 'reports:read' },
  { href: '/pilot', label: 'Pilot Evaluation', icon: Activity },
  { href: '/admin', label: 'Admin', icon: Settings, roles: ['ADMIN', 'DIVISIONAL_ENGINEER'] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout, can } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const { toast, dismiss, connected } = useLive();
  const [open, setOpen] = useState(false);
  const [rtl, setRtl] = useState(false);
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => api<{ demoMode: boolean }>('/v1/config'),
    staleTime: 3_600_000,
  });
  const demo = DEMO_MODE || config.data?.demoMode;

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);
  useEffect(() => {
    setOpen(false);
  }, [path]);
  useEffect(() => {
    try {
      setRtl(localStorage.getItem('rg_dir') === 'rtl');
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('rg_dir', rtl ? 'rtl' : 'ltr');
    } catch {
      /* ignore */
    }
  }, [rtl]);
  useEffect(() => {
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-navy p-8">
        <SkeletonRows n={4} />
      </div>
    );
  }

  const items = NAV.filter(
    (n) => (!n.perm || can(n.perm)) && (!n.roles || n.roles.includes(user.role)),
  );
  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-3">
      {items.map((n) => {
        const active = path === n.href || path.startsWith(n.href + '/');
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
              active ? 'bg-accent text-white' : 'text-slate-200 hover:bg-navy-700',
            )}
          >
            <n.icon className="h-4 w-4 shrink-0" aria-hidden />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 bg-navy lg:block">
        <div className="flex items-center gap-2 px-5 py-5 text-white">
          <ShieldAlert className="h-6 w-6 text-accent" aria-hidden />
          <span className="text-lg font-semibold tracking-tight">RAILGUARD AI</span>
        </div>
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-64 bg-navy">
            <div className="flex items-center justify-between px-5 py-4 text-white">
              <span className="font-semibold">RAILGUARD AI</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-navy-700 bg-navy px-4 py-2.5 text-white">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-6 w-6" />
          </button>
          <span className="font-semibold lg:hidden">RAILGUARD AI</span>
          {demo && (
            <span
              className="rounded bg-accent px-2 py-0.5 text-xs font-bold tracking-wide"
              title="Seeded / simulated data. Never real Pakistan Railways results."
            >
              DEMO DATA
            </span>
          )}
          <div className="ms-auto flex items-center gap-3 text-sm">
            <span
              className={cn(
                'hidden items-center gap-1.5 text-xs sm:flex',
                connected ? 'text-teal' : 'text-slate-400',
              )}
              title="Live alert connection"
            >
              <span
                className={cn('h-2 w-2 rounded-full', connected ? 'bg-teal' : 'bg-slate-500')}
              />{' '}
              {connected ? 'Live' : 'Offline'}
            </span>
            <button
              onClick={() => setRtl((v) => !v)}
              className="rounded border border-navy-600 px-2 py-1 text-xs hover:bg-navy-700"
              aria-pressed={rtl}
              title="Switch layout direction (Urdu-ready)"
            >
              {rtl ? 'LTR' : 'RTL'}
            </button>
            <div className="hidden text-end leading-tight sm:block">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-xs text-slate-300">{user.role.replaceAll('_', ' ')}</div>
            </div>
            <button
              onClick={() => void logout().then(() => router.replace('/login'))}
              aria-label="Sign out"
              className="rounded p-1.5 hover:bg-navy-700"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 p-4 pb-24 lg:p-6 lg:pb-6">
          {children}
        </main>

        {/* phone bottom bar for the field-critical screens */}
        <nav
          aria-label="Quick"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-white lg:hidden"
        >
          {[
            { href: '/overview', icon: Gauge, label: 'Home' },
            { href: '/review', icon: ClipboardCheck, label: 'Review' },
            { href: '/risk-map', icon: MapIcon, label: 'Map' },
            { href: '/work-orders', icon: ClipboardList, label: 'Work' },
          ].map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
                path.startsWith(n.href) ? 'text-accent' : 'text-ink-soft',
              )}
            >
              <n.icon className="h-5 w-5" aria-hidden />
              {n.label}
            </Link>
          ))}
        </nav>

        {toast && (
          <div
            role="alert"
            className="fixed bottom-20 end-4 z-50 max-w-sm rounded-xl border border-accent bg-white p-3 shadow-lg lg:bottom-6"
          >
            <div className="flex items-start gap-2">
              <Bell className="mt-0.5 h-4 w-4 text-accent" aria-hidden />
              <div className="text-sm">
                <p className="font-semibold">
                  {toast.type === 'detection.severe'
                    ? 'Severe defect detected'
                    : toast.type === 'crossing.warning'
                      ? 'Crossing warning triggered'
                      : 'Device offline'}
                </p>
                <p className="text-xs text-ink-soft">
                  {toast.data.name ?? toast.data.defectClass ?? ''}
                </p>
              </div>
              <button onClick={dismiss} aria-label="Dismiss" className="ms-2">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { Badge };
