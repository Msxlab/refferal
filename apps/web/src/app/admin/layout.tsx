'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { activeMembership, clearSession, getSession, isAdminRole, type Session } from '@/lib/auth';
import { t } from '@/lib/i18n';

const NAV: Array<{ href: string; key: Parameters<typeof t>[0] }> = [
  { href: '/admin', key: 'nav.dashboard' },
  { href: '/admin/sales', key: 'nav.sales' },
  { href: '/admin/members', key: 'nav.members' },
  { href: '/admin/payouts', key: 'nav.payouts' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSessionState] = useState<Session | null>(null);

  useEffect(() => {
    const s = getSession();
    const active = s ? activeMembership(s) : null;
    if (!s || !isAdminRole(active?.role)) {
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
    <div className="shell">
      <aside className="side">
        <div className="brand">Refearn</div>
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <div style={{ marginTop: 24, padding: '0 10px' }}>
          <div className="muted" style={{ fontSize: 12 }}>{active?.tenantName}</div>
          <div style={{ fontSize: 13, margin: '2px 0 10px' }}>{session.user.fullName}</div>
          <button className="btn ghost sm" onClick={logout}>{t('nav.logout')}</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
