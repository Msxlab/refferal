'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  ReceiptText,
  Settings,
  ShieldCheck,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';
import { activeMembership, getSession, isAdminRole, type Session } from '@/lib/auth';
import { api } from '@/lib/api';
import { Brand, ThemeToggle } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { useOverlayFocus } from '@/components/useOverlayFocus';
import { t } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type NavigationGroup = 'workspace' | 'governance';

interface NavigationItem {
  href: string;
  key: Parameters<typeof t>[0];
  Icon: LucideIcon;
  group: NavigationGroup;
  adminOnly?: boolean;
}

const NAV: NavigationItem[] = [
  { href: '/admin', key: 'nav.dashboard', Icon: LayoutDashboard, group: 'workspace' },
  { href: '/admin/sales', key: 'nav.sales', Icon: ReceiptText, group: 'workspace' },
  { href: '/admin/members', key: 'nav.members', Icon: Users, group: 'workspace' },
  { href: '/admin/tree', key: 'nav.tree', Icon: Network, group: 'workspace' },
  { href: '/admin/payouts', key: 'nav.payouts', Icon: WalletCards, group: 'governance', adminOnly: true },
  { href: '/admin/audit', key: 'nav.audit', Icon: ClipboardList, group: 'governance', adminOnly: true },
  { href: '/admin/settings', key: 'nav.settings', Icon: Settings, group: 'governance', adminOnly: true },
];

const NAVIGATION_GROUPS: Array<{ id: NavigationGroup; label: string }> = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'governance', label: 'Governance' },
];

function isNavItemActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function roleLabel(role: string | undefined) {
  if (role === 'tenant_owner') return 'Owner';
  if (role === 'tenant_admin') return 'Administrator';
  if (role === 'tenant_staff') return 'Staff';
  return 'Team member';
}

function userInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
}

function AdminHomeLink() {
  return (
    <Link href="/admin" className="admin-home-link" aria-label="Go to admin overview">
      <Brand />
    </Link>
  );
}

function AdminNavigation({
  pathname,
  isStaff,
  onNavigate,
}: {
  pathname: string;
  isStaff: boolean;
  onNavigate?: () => void;
}) {
  const visibleItems = NAV.filter((item) => !(item.adminOnly && isStaff));

  return (
    <nav className="admin-nav" aria-label="Administrator navigation">
      {NAVIGATION_GROUPS.map((group) => {
        const items = visibleItems.filter((item) => item.group === group.id);
        if (items.length === 0) return null;

        return (
          <div className="admin-nav-section" key={group.id}>
            <div className="admin-nav-section-label">{group.label}</div>
            <div className="admin-nav-items">
              {items.map(({ Icon, ...item }) => {
                const active = isNavItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`admin-nav-link${active ? ' active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={onNavigate}
                  >
                    <span className="admin-nav-icon" aria-hidden="true">
                      <Icon className="size-4" />
                    </span>
                    <span>{t(item.key)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function AdminIdentity({ tenantName, userName, role }: { tenantName: string; userName: string; role?: string }) {
  return (
    <div className="admin-identity">
      <span className="admin-avatar" aria-hidden="true">{userInitials(userName)}</span>
      <span className="admin-identity-copy">
        <strong>{userName}</strong>
        <span title={tenantName}>{tenantName}</span>
      </span>
      <Badge variant="secondary">{roleLabel(role)}</Badge>
    </div>
  );
}

function MobileNavigationDialog({
  pathname,
  isStaff,
  tenantName,
  userName,
  role,
  closeMobileNav,
  logout,
}: {
  pathname: string;
  isStaff: boolean;
  tenantName: string;
  userName: string;
  role?: string;
  closeMobileNav: () => void;
  logout: () => Promise<void>;
}) {
  const mobileNavRef = useRef<HTMLElement>(null);
  const onKeyDown = useOverlayFocus(mobileNavRef, closeMobileNav);

  return (
    <div
      className="admin-mobile-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeMobileNav();
      }}
    >
      <aside
        ref={mobileNavRef}
        id="admin-mobile-navigation"
        data-slot="admin-mobile-nav"
        className="admin-mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-mobile-navigation-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="admin-mobile-drawer-head">
          <div>
            <span className="admin-mobile-drawer-kicker">Network ledger</span>
            <h2 id="admin-mobile-navigation-title">Navigation</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close navigation"
            data-initial-focus
            onClick={closeMobileNav}
          >
            <X />
          </Button>
        </div>

        <div className="admin-mobile-drawer-body">
          <AdminNavigation pathname={pathname} isStaff={isStaff} onNavigate={closeMobileNav} />
        </div>

        <div className="admin-mobile-drawer-foot">
          <AdminIdentity tenantName={tenantName} userName={userName} role={role} />
          <Button type="button" variant="outline" onClick={logout}>
            <LogOut />
            {t('nav.logout')}
          </Button>
        </div>
      </aside>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSessionState] = useState<Session | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const s = getSession();
    const active = s ? activeMembership(s) : null;
    if (!s || !isAdminRole(active?.role)) {
      router.replace('/login');
      return;
    }
    setSessionState(s);
  }, [router]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const desktopMedia = window.matchMedia('(min-width: 901px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileNavOpen(false);
    };
    desktopMedia.addEventListener('change', closeOnDesktop);
    return () => desktopMedia.removeEventListener('change', closeOnDesktop);
  }, []);

  if (!session) {
    return (
      <div className="admin-auth-loading" role="status" aria-live="polite">
        <Brand size="lg" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  const active = activeMembership(session);
  const isStaff = active?.role === 'tenant_staff';
  const tenantName = active?.tenantName ?? 'Workspace';
  const currentItem = NAV.find((item) => isNavItemActive(pathname, item.href)) ?? NAV[0];

  async function logout() {
    try {
      await api.logout();
    } finally {
      router.replace('/login');
    }
  }

  return (
    <div className="admin-shell" data-slot="admin-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <aside className="admin-rail" data-slot="admin-rail">
        <div className="admin-rail-brand">
          <AdminHomeLink />
          <span><ShieldCheck aria-hidden="true" /> Network ledger</span>
        </div>

        <AdminNavigation pathname={pathname} isStaff={isStaff} />

        <div className="admin-rail-foot">
          <AdminIdentity
            tenantName={tenantName}
            userName={session.user.fullName}
            role={active?.role}
          />
          <Button type="button" variant="ghost" className="admin-logout" onClick={logout}>
            <LogOut />
            {t('nav.logout')}
          </Button>
        </div>
      </aside>

      <div className="admin-workspace">
        <header className="admin-mobilebar">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="admin-mobile-trigger"
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
            aria-controls="admin-mobile-navigation"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu />
          </Button>
          <AdminHomeLink />
        </header>

        <header className="admin-commandbar" data-slot="admin-commandbar">
          <div className="admin-commandbar-context">
            <span>Operations workspace</span>
            <strong>{t(currentItem.key)}</strong>
          </div>
          <span className="admin-tenant-chip" title={tenantName}>
            <span aria-hidden="true" />
            {tenantName}
          </span>
        </header>

        <div className="admin-global-actions" role="group" aria-label="Workspace utilities">
          <ThemeToggle />
          <NotificationBell />
        </div>

        <main id="main-content" className="admin-main" data-slot="admin-main" tabIndex={-1}>{children}</main>
      </div>

      {mobileNavOpen && (
        <MobileNavigationDialog
          pathname={pathname}
          isStaff={isStaff}
          tenantName={tenantName}
          userName={session.user.fullName}
          role={active?.role}
          closeMobileNav={() => setMobileNavOpen(false)}
          logout={logout}
        />
      )}
    </div>
  );
}
