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

  if (!session) return <div className="center muted" role="status" aria-live="polite">{t('common.loading')}</div>;
  const active = activeMembership(session);

  async function logout() {
    try {
      await api.logout();
    } finally {
      router.replace('/login');
    }
  }

  const activeBrand = brand ?? normalizeRuntimeBrand({ name: active?.tenantName ?? undefined });
  const brandVars = {
    '--brand-accent': activeBrand.primaryColor,
  } as CSSProperties;

  return (
    <div style={brandVars}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="topbar">
        <div className="inner">
          <Brand className="brand" brand={activeBrand} />
          <nav aria-label="Member navigation">
            {NAV.map(({ Icon, ...n }) => (
              <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
                <Icon className="mr-1.5 inline size-4 opacity-85" aria-hidden="true" />{t(n.key)}
              </Link>
            ))}
          </nav>
          <span className="min-w-0 max-w-48 truncate text-xs text-muted-foreground" title={activeBrand.tagline}>{activeBrand.tagline}</span>
          <NotificationBell />
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut />
            {t('nav.logout')}
          </Button>
        </div>
      </header>
      <main id="main-content" className="appmain" tabIndex={-1}>{children}</main>
    </div>
  );
}
