'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2,
  CalendarClock,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Megaphone,
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
import {
  activeMembership,
  clearSession,
  getSession,
  isAdminRole,
  subscribeToSessionStorageChanges,
  type Session,
} from '@/lib/auth';
import { Brand, ThemeToggle } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { NotificationBell } from '@/components/NotificationBell';
import { CommandPalette } from '@/components/CommandPalette';
import { LiveIndicator } from '@/components/LiveIndicator';
import { t } from '@/lib/i18n';

type NavigationGroup = 'operations' | 'governance';

interface NavigationItem {
  href: string;
  key: Parameters<typeof t>[0];
  Icon: LucideIcon;
  group: NavigationGroup;
  adminOnly?: boolean;
}

const NAV: NavigationItem[] = [
  { href: '/admin', key: 'nav.dashboard', Icon: LayoutDashboard, group: 'operations' },
  { href: '/admin/sales', key: 'nav.sales', Icon: ReceiptText, group: 'operations' },
  { href: '/admin/members', key: 'nav.members', Icon: Users, group: 'operations' },
  { href: '/admin/tree', key: 'nav.tree', Icon: Network, group: 'operations' },
  { href: '/admin/campaigns', key: 'nav.campaigns', Icon: Megaphone, group: 'operations' },
  { href: '/admin/payouts', key: 'nav.payouts', Icon: WalletCards, group: 'governance', adminOnly: true },
  { href: '/admin/checks', key: 'nav.checks', Icon: ShieldCheck, group: 'governance', adminOnly: true },
  { href: '/admin/periods', key: 'nav.periods', Icon: CalendarClock, group: 'governance', adminOnly: true },
  { href: '/admin/audit', key: 'nav.audit', Icon: ClipboardList, group: 'governance', adminOnly: true },
  { href: '/admin/settings', key: 'nav.settings', Icon: Settings, group: 'governance', adminOnly: true },
];

const NAVIGATION_GROUPS: Array<{ id: NavigationGroup; label: string }> = [
  { id: 'operations', label: 'Network operations' },
  { id: 'governance', label: 'Controls & records' },
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
  isPlatform,
  onNavigate,
}: {
  pathname: string;
  isStaff: boolean;
  isPlatform: boolean;
  onNavigate?: () => void;
}) {
  const visibleItems = NAV.filter((item) => !(item.adminOnly && isStaff));

  return (
    <nav className="admin-nav" aria-label="Administrator navigation">
      {isPlatform && (
        <div className="admin-nav-section">
          <div className="admin-nav-section-label">Platform</div>
          <Link href="/platform" className="admin-nav-link" onClick={onNavigate}>
            <span className="admin-nav-icon" aria-hidden="true"><Building2 /></span>
            <span>Platform overview</span>
          </Link>
        </div>
      )}

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
                    <span className="admin-nav-icon" aria-hidden="true"><Icon /></span>
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
      <Link href="/account" className="admin-identity-link" title="Account settings">
        <strong>{userName}</strong>
        <span title={tenantName}>{tenantName}</span>
      </Link>
      <Badge variant="secondary">{roleLabel(role)}</Badge>
    </div>
  );
}

function AdminRail({
  pathname,
  isStaff,
  isPlatform,
  tenantName,
  userName,
  role,
  logout,
}: {
  pathname: string;
  isStaff: boolean;
  isPlatform: boolean;
  tenantName: string;
  userName: string;
  role?: string;
  logout: () => Promise<void>;
}) {
  return (
    <aside className="admin-rail" data-slot="admin-rail">
      <div className="admin-rail-brand">
        <AdminHomeLink />
        <span><ShieldCheck aria-hidden="true" /> Network ledger</span>
      </div>
      <AdminNavigation pathname={pathname} isStaff={isStaff} isPlatform={isPlatform} />
      <div className="admin-rail-foot">
        <AdminIdentity tenantName={tenantName} userName={userName} role={role} />
        <Button type="button" variant="ghost" className="admin-logout" onClick={logout}>
          <LogOut aria-hidden="true" />
          {t('nav.logout')}
        </Button>
      </div>
    </aside>
  );
}

function AdminMobileNavigation({
  mobileNavOpen,
  setMobileNavOpen,
  pathname,
  isStaff,
  isPlatform,
  tenantName,
  userName,
  role,
  logout,
  returnFocusRef,
}: {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  pathname: string;
  isStaff: boolean;
  isPlatform: boolean;
  tenantName: string;
  userName: string;
  role?: string;
  logout: () => Promise<void>;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <SheetContent
        id="admin-mobile-navigation"
        side="left"
        className="admin-mobile-sheet"
        hideClose
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <SheetHeader className="admin-mobile-sheet-head">
          <div>
            <span className="admin-mobile-kicker">Network ledger</span>
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription className="sr-only">Move through the administrator workspace.</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Close navigation">
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
        </SheetHeader>
        <div className="admin-mobile-sheet-body">
          <AdminNavigation
            pathname={pathname}
            isStaff={isStaff}
            isPlatform={isPlatform}
            onNavigate={closeMobileNav}
          />
        </div>
        <div className="admin-mobile-sheet-foot">
          <AdminIdentity tenantName={tenantName} userName={userName} role={role} />
          <Button type="button" variant="outline" onClick={logout}>
            <LogOut aria-hidden="true" />
            {t('nav.logout')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSessionState] = useState<Session | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);

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
    return subscribeToSessionStorageChanges(
      (change) => {
        if (change.action === 'defer-to-caller') return;
        if (change.action === 'reload' || !change.session) {
          setSessionState(null);
          window.location.reload();
          return;
        }
        setSessionState(change.session);
      },
      (next) => isAdminRole(activeMembership(next)?.role),
    );
  }, []);

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
  const isPlatform = session.user.isPlatformAdmin === true;
  const tenantName = active?.tenantName ?? 'Workspace';
  const currentItem = NAV.find((item) => isNavItemActive(pathname, item.href)) ?? NAV[0];

  async function logout() {
    await clearSession();
    router.replace('/login');
  }

  return (
    <div className="admin-shell" data-slot="admin-shell">
      <a className="skip-link" href="#admin-main">Skip to main content</a>
      <AdminRail
        pathname={pathname}
        isStaff={isStaff}
        isPlatform={isPlatform}
        tenantName={tenantName}
        userName={session.user.fullName}
        role={active?.role}
        logout={logout}
      />

      <div className="admin-workspace">
        <header className="admin-commandbar" data-slot="admin-commandbar">
          <div className="admin-mobile-leading">
            <Button
              ref={mobileTriggerRef}
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              aria-expanded={mobileNavOpen}
              aria-controls="admin-mobile-navigation"
              aria-haspopup="dialog"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu aria-hidden="true" />
            </Button>
            <AdminHomeLink />
          </div>
          <div className="admin-commandbar-context">
            <span>Operations workspace</span>
            <strong>{t(currentItem.key)}</strong>
          </div>
          <span className="admin-tenant-chip" title={tenantName}>
            <span aria-hidden="true" />
            {tenantName}
          </span>
          <div className="admin-global-actions" role="group" aria-label="Workspace utilities">
            <LiveIndicator />
            <NotificationBell />
            <ThemeToggle />
          </div>
        </header>

        <main id="admin-main" className="admin-main" data-slot="admin-main" tabIndex={-1}>{children}</main>
      </div>

      <AdminMobileNavigation
        mobileNavOpen={mobileNavOpen}
        setMobileNavOpen={setMobileNavOpen}
        pathname={pathname}
        isStaff={isStaff}
        isPlatform={isPlatform}
        tenantName={tenantName}
        userName={session.user.fullName}
        role={active?.role}
        logout={logout}
        returnFocusRef={mobileTriggerRef}
      />
      <CommandPalette />
    </div>
  );
}
