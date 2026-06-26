'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { activeMembership, clearSession, getSession, isAdminRole, type Session } from '@/lib/auth';
import { ThemeToggle } from '@/components/ui';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { NotificationBell } from '@/components/NotificationBell';
import { CommandPalette } from '@/components/CommandPalette';
import { LiveIndicator } from '@/components/LiveIndicator';
import { t } from '@/lib/i18n';
import { APP_MONOGRAM, APP_NAME } from '@/lib/brand';
import { Menu, ChevronsUpDown, Search, ChevronRight, User, LogOut } from 'lucide-react';

type IconKey =
  | 'dashboard' | 'sales' | 'members' | 'tree' | 'campaigns'
  | 'payouts' | 'checks' | 'periods' | 'audit' | 'settings' | 'platform';

const NAV: Array<{
  href: string;
  key: Parameters<typeof t>[0];
  ic: IconKey;
  adminOnly?: boolean;
  badge?: { count: number; tone: 'pending' | 'info' };
  section?: 'ops';
}> = [
  { href: '/admin', key: 'nav.dashboard', ic: 'dashboard' },
  { href: '/admin/sales', key: 'nav.sales', ic: 'sales', badge: { count: 4, tone: 'pending' } },
  { href: '/admin/members', key: 'nav.members', ic: 'members' },
  { href: '/admin/tree', key: 'nav.tree', ic: 'tree' },
  { href: '/admin/campaigns', key: 'nav.campaigns', ic: 'campaigns' },
  { href: '/admin/payouts', key: 'nav.payouts', ic: 'payouts', adminOnly: true, section: 'ops', badge: { count: 3, tone: 'info' } },
  { href: '/admin/checks', key: 'nav.checks', ic: 'checks', adminOnly: true, section: 'ops' },
  { href: '/admin/periods', key: 'nav.periods', ic: 'periods', adminOnly: true, section: 'ops' },
  { href: '/admin/audit', key: 'nav.audit', ic: 'audit', adminOnly: true, section: 'ops' },
  { href: '/admin/settings', key: 'nav.settings', ic: 'settings', adminOnly: true, section: 'ops' },
];

/** Inline ikon seti — SPEC'teki stroke-svg'lere yakin, currentColor ile temalanir. */
function NavIcon({ name }: { name: IconKey }) {
  const p = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'dashboard':
      return (<svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.6" /><rect x="3" y="14" width="7" height="7" rx="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.6" /></svg>);
    case 'sales':
      return (<svg {...p}><path d="M3 17l6-6 4 4 7-7" /><path d="M17 7h4v4" /></svg>);
    case 'members':
      return (<svg {...p}><path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" /><circle cx="9" cy="8" r="3.4" /><path d="M21 19v-1a4 4 0 0 0-3-3.85" /><path d="M16 4.15a4 4 0 0 1 0 7.7" /></svg>);
    case 'tree':
      return (<svg {...p}><circle cx="18" cy="5" r="2.4" /><circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="19" r="2.4" /><path d="M15.9 6.2 8.1 10.8M8.1 13.2l7.8 4.6" /></svg>);
    case 'campaigns':
      return (<svg {...p}><path d="M4 21V4" /><path d="M4 4h13l-2.4 4 2.4 4H4" /></svg>);
    case 'payouts':
      return (<svg {...p}><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 9.5h19" /></svg>);
    case 'checks':
      return (<svg {...p}><path d="M6 9V3h12v6M6 18H4v-5h16v5h-2M8 14h8v7H8z" /></svg>);
    case 'periods':
      return (<svg {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
    case 'audit':
      return (<svg {...p}><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>);
    case 'settings':
      return (<svg {...p}><path d="M4 7h9M19 7h1M4 17h1M11 17h9" /><circle cx="16" cy="7" r="2.2" /><circle cx="8" cy="17" r="2.2" /></svg>);
    case 'platform':
      return (<svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.6" /><rect x="3" y="14" width="7" height="7" rx="1.6" /></svg>);
    default:
      return null;
  }
}

/** Var olan global CommandPalette'i (Cmd/Ctrl+K dinleyicisi) sentetik tus olayiyla acar — wiring degismez. */
function openCommandPalette() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }));
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSessionState] = useState<Session | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  // route degisince mobil drawer'i kapat
  useEffect(() => { setNavOpen(false); }, [pathname]);

  useEffect(() => {
    const s = getSession();
    const active = s ? activeMembership(s) : null;
    if (!s || !isAdminRole(active?.role)) {
      router.replace('/login');
      return;
    }
    setSessionState(s);
  }, [router]);

  // sekmeler-arasi senkron: baska sekmede cikis yapilirsa (refearn.session silinir) burada da login'e don
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'refearn.session' && !e.newValue) router.replace('/login');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [router]);

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-live="polite">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary"
            aria-hidden="true"
          />
          {t('common.loading')}
        </div>
      </div>
    );
  }
  const active = activeMembership(session);
  const isStaff = active?.role === 'tenant_staff';
  const isPlatform = session.user.isPlatformAdmin === true;

  function logout() {
    clearSession();
    router.replace('/login');
  }

  const visibleNav = NAV.filter((n) => !(n.adminOnly && isStaff));
  const mainNav = visibleNav.filter((n) => n.section !== 'ops');
  const opsNav = visibleNav.filter((n) => n.section === 'ops');

  // breadcrumb basligi — aktif rota etiketinden tureyen
  const current = visibleNav.find((n) => (n.href === '/admin' ? pathname === '/admin' : pathname.startsWith(n.href)));
  const screenTitle = isPlatform && pathname.startsWith('/platform') ? 'Platform' : current ? t(current.key) : APP_NAME;

  const initial = (active?.tenantName?.[0] ?? APP_MONOGRAM).toUpperCase();
  const userInitial = (session.user.fullName?.[0] ?? 'U').toUpperCase();

  function NavLink({ n }: { n: (typeof NAV)[number] }) {
    const isActive = n.href === '/admin' ? pathname === '/admin' : pathname.startsWith(n.href);
    return (
      <Link
        href={n.href}
        onClick={() => setNavOpen(false)}
        aria-current={isActive ? 'page' : undefined}
        className={[
          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        ].join(' ')}
      >
        <span className={isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'} aria-hidden="true">
          <NavIcon name={n.ic} />
        </span>
        <span className="flex-1 truncate">{t(n.key)}</span>
        {n.badge && (
          <span
            className={[
              'ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums',
              n.badge.tone === 'pending'
                ? 'bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] text-[var(--amber)]'
                : 'bg-primary/15 text-primary',
            ].join(' ')}
          >
            {n.badge.count}
          </span>
        )}
      </Link>
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* ===== Mobile topbar ===== */}
      <div className="no-print fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('nav.menu')}
              aria-expanded={navOpen}
              onClick={() => setNavOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              <Menu className="size-[18px]" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('nav.menu')}</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-lg bg-primary font-display text-sm font-extrabold text-primary-foreground">{APP_MONOGRAM}</span>
          <span className="font-display text-[15px] font-extrabold tracking-tight">{APP_NAME}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <NotificationBell />
          <ThemeToggle />
        </div>
      </div>

      {/* ===== Mobile backdrop ===== */}
      {navOpen && (
        <div
          className="no-print fixed inset-0 z-40 bg-foreground/60 backdrop-blur-sm md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ===== Sidebar (236px) ===== */}
      <aside
        className={[
          'no-print fixed inset-y-0 left-0 z-50 flex w-[236px] flex-shrink-0 flex-col border-r border-border bg-card transition-transform duration-200',
          'md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-4 pb-4 pt-5">
          <span aria-hidden="true" className="grid h-[38px] w-[38px] place-items-center rounded-xl bg-primary font-display text-lg font-extrabold text-primary-foreground shadow-lg shadow-primary/30">
            {APP_MONOGRAM}
          </span>
          <div className="min-w-0">
            <div className="font-display text-[17px] font-extrabold tracking-tight text-foreground">{APP_NAME}</div>
            <div className="-mt-px truncate text-xs text-muted-foreground">Referral commission OS</div>
          </div>
        </div>

        {/* Company switcher pill */}
        <Link
          href="/account"
          aria-label="Switch workspace"
          className="mx-2 mb-2.5 mt-0.5 flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 transition-colors hover:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden="true" className="grid h-[22px] w-[22px] place-items-center rounded-md bg-primary/15 font-display text-xs font-extrabold text-primary">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">{active?.tenantName ?? APP_NAME}</div>
            <div className="text-xs text-muted-foreground">{active?.role ?? 'Workspace'}</div>
          </div>
          <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
        </Link>

        {/* Nav */}
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1">
          {isPlatform && (
            <Link
              href="/platform"
              onClick={() => setNavOpen(false)}
              aria-current={pathname.startsWith('/platform') ? 'page' : undefined}
              className={[
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                pathname.startsWith('/platform')
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              ].join(' ')}
            >
              <span aria-hidden="true" className={pathname.startsWith('/platform') ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}>
                <NavIcon name="platform" />
              </span>
              <span className="flex-1 truncate">Platform</span>
            </Link>
          )}

          {mainNav.map((n) => <NavLink key={n.href} n={n} />)}

          {opsNav.length > 0 && (
            <>
              <div className="mx-2 my-2 h-px bg-border" />
              <div className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
                Operations
              </div>
              {opsNav.map((n) => <NavLink key={n.href} n={n} />)}
            </>
          )}
        </nav>

        {/* User footer card */}
        <div className="mt-auto border-t border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">{userInitial}</AvatarFallback>
            </Avatar>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Account settings"
                  className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="truncate text-sm font-semibold text-foreground">{session.user.fullName}</div>
                  <div className="truncate text-xs text-muted-foreground">{session.user.email}</div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                <DropdownMenuLabel className="truncate">{session.user.fullName}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/account"><User className="mr-2 size-4" aria-hidden />Account settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/account"><ChevronsUpDown className="mr-2 size-4" aria-hidden />Switch workspace</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={logout} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 size-4" aria-hidden />
                  {t('nav.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="rounded-md bg-primary/15 px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
              {active?.role?.replace('tenant_', '') ?? 'staff'}
            </span>
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <LiveIndicator />
            <div className="flex items-center gap-1">
              <NotificationBell placement="up" />
              <ThemeToggle />
              <button
                type="button"
                onClick={logout}
                className="rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                {t('nav.logout')}
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ===== Main column ===== */}
      <main className="flex min-h-screen min-w-0 flex-1 flex-col pt-14 md:pt-0">
        {/* Topbar */}
        <header className="no-print sticky top-0 z-30 hidden h-[60px] flex-shrink-0 items-center gap-3.5 border-b border-border bg-card/95 px-6 backdrop-blur md:flex">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{APP_NAME}</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-semibold text-foreground">{screenTitle}</span>
          </nav>

          <div className="flex-1" />

          {/* ⌘K search trigger -> CommandPalette */}
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Search"
            className="flex h-[34px] items-center gap-2.5 rounded-lg border border-border bg-muted pl-3 pr-2.5 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <Search className="size-[15px]" aria-hidden />
            <span className="text-muted-foreground">Search…</span>
            <span aria-hidden="true" className="ml-1.5 rounded-md border border-input px-1.5 py-px text-xs font-semibold text-muted-foreground">⌘K</span>
          </button>

          {/* Notifications */}
          <NotificationBell />

          {/* Live + theme */}
          <LiveIndicator />
          <ThemeToggle />
        </header>

        {/* Content */}
        <div className="flex-1">{children}</div>
      </main>

      <CommandPalette />
    </div>
  );
}
