'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { activeMembership, clearSession, getSession, isAdminRole, type Session } from '@/lib/auth';
import { ThemeToggle } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { CommandPalette } from '@/components/CommandPalette';
import { LiveIndicator } from '@/components/LiveIndicator';
import { t } from '@/lib/i18n';

const NAV: Array<{ href: string; key: Parameters<typeof t>[0]; ic: string; adminOnly?: boolean }> = [
  { href: '/admin', key: 'nav.dashboard', ic: '◈' },
  { href: '/admin/sales', key: 'nav.sales', ic: '◇' },
  { href: '/admin/members', key: 'nav.members', ic: '⬡' },
  { href: '/admin/tree', key: 'nav.tree', ic: '⤳' },
  { href: '/admin/campaigns', key: 'nav.campaigns', ic: '⚑' },
  { href: '/admin/payouts', key: 'nav.payouts', ic: '◆', adminOnly: true },
  { href: '/admin/periods', key: 'nav.periods', ic: '▥', adminOnly: true },
  { href: '/admin/audit', key: 'nav.audit', ic: '☰', adminOnly: true },
  { href: '/admin/settings', key: 'nav.settings', ic: '⚙', adminOnly: true },
];

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

  if (!session) return <div className="center muted">{t('common.loading')}</div>;
  const active = activeMembership(session);
  const isStaff = active?.role === 'tenant_staff';

  function logout() {
    clearSession();
    router.replace('/login');
  }

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <div className="mobile-topbar no-print">
        <button className="hamburger" aria-label={t('nav.menu')} aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>☰</button>
        <div className="brand"><span className="dot">R</span> Refearn</div>
        <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>
          <NotificationBell />
          <ThemeToggle />
        </div>
      </div>
      {navOpen && <div className="nav-backdrop no-print" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside className="side">
        <div className="brand"><span className="dot">R</span> Refearn</div>
        <nav>
          {NAV.filter((n) => !(n.adminOnly && isStaff)).map((n) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''} onClick={() => setNavOpen(false)}>
              <span className="ic">{n.ic}</span>{t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="foot">
          <div className="faint" style={{ fontSize: 11 }}>{active?.tenantName}</div>
          <Link href="/account" title="Account settings" style={{ fontSize: 13, fontWeight: 600, margin: '2px 0 4px', display: 'inline-block', color: 'var(--text)' }}>{session.user.fullName} <span className="faint" style={{ fontWeight: 400 }}>⚙</span></Link>
          <div className="row spread">
            <span className="badge active" style={{ fontSize: 10 }}>{active?.role}</span>
            <div className="row" style={{ gap: 6 }}>
              <LiveIndicator />
              <NotificationBell placement="up" />
              <ThemeToggle />
              <button className="btn ghost sm" onClick={logout}>{t('nav.logout')}</button>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
      <CommandPalette />
    </div>
  );
}
