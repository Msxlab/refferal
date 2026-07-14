'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Gift, Home, LogOut, Users, WalletCards, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { activeMembership, getSession, type Session } from '@/lib/auth';
import { normalizeRuntimeBrand, type RuntimeBrand } from '@/lib/brand';
import { Brand, ThemeToggle } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

const NAV: Array<{ href: string; key: Parameters<typeof t>[0]; Icon: LucideIcon }> = [
  { href: '/app', key: 'anav.home', Icon: Home },
  { href: '/app/wallet', key: 'anav.wallet', Icon: WalletCards },
  { href: '/app/team', key: 'anav.team', Icon: Users },
  { href: '/app/invite', key: 'anav.invite', Icon: Gift },
];

function isMemberNavItemActive(pathname: string, href: string) {
  if (href === '/app') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function MemberNavigationLinks({ pathname }: { pathname: string }) {
  return NAV.map(({ Icon, ...item }) => {
    const active = isMemberNavItemActive(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`member-nav-link${active ? ' active' : ''}`}
        aria-current={active ? 'page' : undefined}
      >
        <Icon aria-hidden="true" />
        <span>{t(item.key)}</span>
      </Link>
    );
  });
}

function userInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSessionState] = useState<Session | null>(null);
  const [brand, setBrand] = useState<RuntimeBrand | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s || !activeMembership(s)) {
      router.replace('/login');
      return;
    }
    setSessionState(s);
  }, [router]);

  useEffect(() => {
    if (!session) return;
    api.get<RuntimeBrand>('/app/brand').then((next) => setBrand(normalizeRuntimeBrand(next))).catch(() => undefined);
  }, [session]);

  if (!session) {
    return (
      <div className="member-auth-loading" role="status" aria-live="polite">
        <Brand size="lg" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }
  const active = activeMembership(session);

  async function logout() {
    try {
      await api.logout();
    } finally {
      router.replace('/login');
    }
  }

  const activeBrand = brand ?? normalizeRuntimeBrand({ name: active?.tenantName ?? undefined });
  const tenantName = active?.tenantName ?? activeBrand.name;
  const brandVars = {
    '--brand-accent': activeBrand.primaryColor,
  } as CSSProperties;

  return (
    <div className="member-shell" data-slot="member-shell" style={brandVars}>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <header className="member-topbar" data-slot="member-topbar">
        <div className="member-topbar-inner">
          <div className="member-brand-cluster">
            <Link href="/app" className="member-home-link" aria-label="Go to member overview">
              <Brand brand={activeBrand} />
            </Link>
            <span className="member-brand-context" title={activeBrand.tagline}>{activeBrand.tagline}</span>
          </div>

          <nav className="member-desktop-nav" data-slot="member-desktop-nav" aria-label="Member navigation">
            <MemberNavigationLinks pathname={pathname} />
          </nav>

          <div className="member-utilities" role="group" aria-label="Member utilities">
            <div className="member-account" title={`${session.user.fullName} · ${tenantName}`}>
              <span className="member-avatar" aria-hidden="true">{userInitials(session.user.fullName)}</span>
              <span className="member-account-copy">
                <strong>{session.user.fullName}</strong>
                <span>{tenantName}</span>
              </span>
            </div>
            <ThemeToggle />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="member-logout"
              aria-label={t('nav.logout')}
              title={t('nav.logout')}
              onClick={logout}
            >
              <LogOut />
              <span>{t('nav.logout')}</span>
            </Button>
            <NotificationBell />
          </div>
        </div>
      </header>

      <nav className="member-bottom-nav" data-slot="member-bottom-nav" aria-label="Member mobile navigation">
        <MemberNavigationLinks pathname={pathname} />
      </nav>

      <main id="main-content" className="member-main" data-slot="member-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
