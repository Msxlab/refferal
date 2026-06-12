'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { activeMembership, clearSession, getSession, type Session } from '@/lib/auth';
import { Brand, ThemeToggle } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { t } from '@/lib/i18n';

const NAV: Array<{ href: string; key: Parameters<typeof t>[0]; ic: string }> = [
  { href: '/app', key: 'anav.home', ic: '◈' },
  { href: '/app/wallet', key: 'anav.wallet', ic: '◇' },
  { href: '/app/team', key: 'anav.team', ic: '⬡' },
  { href: '/app/invite', key: 'anav.invite', ic: '✦' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSessionState] = useState<Session | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s || !activeMembership(s)) {
      router.replace('/login');
      return;
    }
    setSessionState(s);
  }, [router]);

  if (!session) return <div className="center muted">{t('common.loading')}</div>;
  const active = activeMembership(session);

  function logout() {
    clearSession();
    router.replace('/login');
  }

  return (
    <div>
      <header className="topbar">
        <div className="inner">
          <Brand />
          <nav>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
                <span style={{ opacity: 0.85, marginRight: 6 }}>{n.ic}</span>{t(n.key)}
              </Link>
            ))}
          </nav>
          <span className="faint" style={{ fontSize: 12 }}>{active?.tenantName}</span>
          <NotificationBell />
          <ThemeToggle />
          <button className="btn ghost sm" onClick={logout}>{t('nav.logout')}</button>
        </div>
      </header>
      <main className="appmain">{children}</main>
    </div>
  );
}
