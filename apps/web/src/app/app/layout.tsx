'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Eye,
  Home,
  LogOut,
  Menu,
  Network,
  ReceiptText,
  UserPlus,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  activeMembership,
  clearSession,
  getSession,
  isImpersonating,
  stopImpersonation,
  subscribeToSessionStorageChanges,
  type Session,
} from '@/lib/auth';
import { api } from '@/lib/api';
import { Brand, ThemeToggle } from '@/components/ui';
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
import { t } from '@/lib/i18n';

interface NavigationItem {
  href: string;
  key: Parameters<typeof t>[0];
  Icon: LucideIcon;
}

const NAV: NavigationItem[] = [
  { href: '/app', key: 'anav.home', Icon: Home },
  { href: '/app/wallet', key: 'anav.wallet', Icon: WalletCards },
  { href: '/app/sales', key: 'anav.sales', Icon: ReceiptText },
  { href: '/app/team', key: 'anav.team', Icon: Network },
  { href: '/app/invite', key: 'anav.invite', Icon: UserPlus },
];

function isMemberNavItemActive(pathname: string, href: string) {
  if (href === '/app') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function userInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
}

function MemberHomeLink() {
  return (
    <Link href="/app" className="member-home-link" aria-label="Go to member overview">
      <Brand />
    </Link>
  );
}

function MemberNavigation({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="member-navigation" data-slot="member-navigation" aria-label="Member navigation">
      {NAV.map(({ Icon, ...item }) => {
        const active = isMemberNavItemActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`member-nav-link${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
          >
            <span className="member-nav-icon" aria-hidden="true"><Icon /></span>
            <span>{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function MemberIdentity({
  tenantName,
  userName,
  onNavigate,
}: {
  tenantName: string;
  userName: string;
  onNavigate?: () => void;
}) {
  return (
    <Link href="/account" className="member-identity member-identity-link"
      title="Account settings"
      onClick={onNavigate}
    >
      <span className="member-avatar" aria-hidden="true">{userInitials(userName)}</span>
      <span className="member-identity-copy">
        <strong title={userName}>{userName || 'Member'}</strong>
        <span title={tenantName}>{tenantName}</span>
      </span>
    </Link>
  );
}

function MemberDesktopNavigation({
  pathname,
  tenantName,
  userName,
  logout,
}: {
  pathname: string;
  tenantName: string;
  userName: string;
  logout: () => Promise<void>;
}) {
  return (
    <div className="member-desktop-navigation">
      <div className="member-desktop-navigation-inner">
        <MemberNavigation pathname={pathname} />
        <div className="member-desktop-account">
          <MemberIdentity tenantName={tenantName} userName={userName} />
          <Button type="button" variant="ghost" className="member-logout" onClick={logout}>
            <LogOut aria-hidden="true" />
            {t('nav.logout')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MemberMobileNavigation({
  mobileNavOpen,
  setMobileNavOpen,
  pathname,
  tenantName,
  userName,
  logout,
  returnFocusRef,
}: {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  pathname: string;
  tenantName: string;
  userName: string;
  logout: () => Promise<void>;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <SheetContent
        id="member-mobile-navigation"
        side="left"
        className="member-mobile-sheet"
        hideClose
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <SheetHeader className="member-mobile-sheet-head">
          <div className="member-mobile-title">
            <span className="member-mobile-kicker">Member workspace</span>
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription className="sr-only">Move through your referral workspace.</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Close navigation">
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
        </SheetHeader>
        <div className="member-mobile-sheet-body">
          <MemberNavigation pathname={pathname} onNavigate={closeMobileNav} />
        </div>
        <div className="member-mobile-sheet-foot">
          <MemberIdentity tenantName={tenantName} userName={userName} onNavigate={closeMobileNav} />
          <Button type="button" variant="outline" className="member-mobile-logout" onClick={logout}>
            <LogOut aria-hidden="true" />
            {t('nav.logout')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSessionState] = useState<Session | null>(null);
  const [imp, setImp] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const s = getSession();
    if (!s || !activeMembership(s)) {
      router.replace('/login');
      return;
    }
    setSessionState(s);
    setImp(isImpersonating());
  }, [router]);

  // Ayni owner/workspace refresh'ini state'e tasi; owner veya guard degisiminde shell'i kapat.
  useEffect(() => {
    return subscribeToSessionStorageChanges(
      (change) => {
        if (change.action === 'defer-to-caller') return;
        if (change.action === 'reload' || !change.session) {
          setSessionState(null);
          setImp(false);
          window.location.reload();
          return;
        }
        setSessionState(change.session);
        setImp(isImpersonating());
      },
      (next) => Boolean(activeMembership(next)),
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
      <div className="member-auth-loading" role="status" aria-live="polite">
        <Brand size="lg" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  const active = activeMembership(session);
  const tenantName = active?.tenantName ?? 'Workspace';
  const currentItem = NAV.find((item) => isMemberNavItemActive(pathname, item.href)) ?? NAV[0];

  async function logout() {
    await clearSession();
    router.replace('/login');
  }

  async function exitImpersonation() {
    const mid = getSession()?.activeMembershipId;
    const admin = await stopImpersonation();
    if (!admin) {
      router.replace('/login');
      return;
    }
    if (mid) {
      try {
        await api.post(`/admin/members/${mid}/impersonate/end`);
      } catch {
        /* yok say */
      }
    }
    window.location.href = '/admin';
  }

  return (
    <div className="member-shell" data-slot="member-shell">
      <a className="skip-link" href="#member-main">Skip to main content</a>

      {imp && (
        <div className="member-impersonation no-print" role="status">
          <span className="member-impersonation-copy">
            <Eye aria-hidden="true" />
            Viewing as <strong>{session.user.fullName}</strong> — read only
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={exitImpersonation}>
            Exit impersonation
          </Button>
        </div>
      )}

      <div className="member-workspace">
        <header className="member-commandbar" data-slot="member-commandbar">
          <div className="member-commandbar-inner">
            <div className="member-leading">
              <Button
                ref={mobileTriggerRef}
                type="button"
                variant="ghost"
                size="icon"
                className="member-mobile-trigger"
                aria-label="Open navigation"
                aria-expanded={mobileNavOpen}
                aria-controls="member-mobile-navigation"
                aria-haspopup="dialog"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu aria-hidden="true" />
              </Button>
              <MemberHomeLink />
            </div>

            <div className="member-commandbar-context">
              <span>Your network</span>
              <strong>{t(currentItem.key)}</strong>
            </div>

            <span className="member-tenant-chip">
              <span className="member-tenant-dot" aria-hidden="true" />
              <span className="member-tenant-name" title={tenantName}>{tenantName}</span>
            </span>

            <div className="member-global-actions" role="group" aria-label="Workspace utilities">
              <NotificationBell />
              <ThemeToggle />
            </div>
          </div>
        </header>

        <MemberDesktopNavigation
          pathname={pathname}
          tenantName={tenantName}
          userName={session.user.fullName}
          logout={logout}
        />

        <main id="member-main" className="member-main appmain" data-slot="member-main" tabIndex={-1}>
          {children}
        </main>
      </div>

      <MemberMobileNavigation
        mobileNavOpen={mobileNavOpen}
        setMobileNavOpen={setMobileNavOpen}
        pathname={pathname}
        tenantName={tenantName}
        userName={session.user.fullName}
        logout={logout}
        returnFocusRef={mobileTriggerRef}
      />
    </div>
  );
}
