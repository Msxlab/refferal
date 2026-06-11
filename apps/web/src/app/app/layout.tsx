'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { activeMembership, clearSession, getSession, type Session } from '@/lib/auth';
import { t } from '@/lib/i18n';

const NAV: Array<{ href: string; key: Parameters<typeof t>[0] }> = [
  { href: '/app', key: 'anav.home' },
  { href: '/app/wallet', key: 'anav.wallet' },
  { href: '/app/team', key: 'anav.team' },
  { href: '/app/invite', key: 'anav.invite' },
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
          <span className="brand">Refearn</span>
          <nav>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
                {t(n.key)}
              </Link>
            ))}
          </nav>
          <span className="muted" style={{ fontSize: 12 }}>{active?.tenantName}</span>
          <button className="btn ghost sm" onClick={logout}>{t('nav.logout')}</button>
        </div>
      </header>
      <main className="appmain">{children}</main>
    </div>
  );
}
