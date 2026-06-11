'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { activeMembership, clearSession, getSession, isAdminRole, type Session } from '@/lib/auth';
import { t } from '@/lib/i18n';

const NAV: Array<{ href: string; key: Parameters<typeof t>[0]; ic: string; adminOnly?: boolean }> = [
  { href: '/admin', key: 'nav.dashboard', ic: '◈' },
  { href: '/admin/sales', key: 'nav.sales', ic: '◇' },
  { href: '/admin/members', key: 'nav.members', ic: '⬡' },
  { href: '/admin/tree', key: 'nav.tree', ic: '⤳' },
  { href: '/admin/payouts', key: 'nav.payouts', ic: '◆', adminOnly: true },
  { href: '/admin/audit', key: 'nav.audit', ic: '☰', adminOnly: true },
  { href: '/admin/settings', key: 'nav.settings', ic: '⚙', adminOnly: true },
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
  const isStaff = active?.role === 'tenant_staff';

  function logout() {
    clearSession();
    router.replace('/login');
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="dot" /> Refearn</div>
        <nav>
          {NAV.filter((n) => !(n.adminOnly && isStaff)).map((n) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
              <span className="ic">{n.ic}</span>{t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="foot">
          <div className="faint" style={{ fontSize: 11 }}>{active?.tenantName}</div>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '2px 0 4px' }}>{session.user.fullName}</div>
          <div className="row spread">
            <span className="badge active" style={{ fontSize: 10 }}>{active?.role}</span>
            <button className="btn ghost sm" onClick={logout}>{t('nav.logout')}</button>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
