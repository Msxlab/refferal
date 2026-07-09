'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { activeMembership, clearSession, getSession, isAdminRole, isImpersonating, setSession, stopImpersonation, type Session } from '@/lib/auth';
import { api } from '@/lib/api';
import { ThemeToggle } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { CommandPalette } from '@/components/CommandPalette';
import { LiveIndicator } from '@/components/LiveIndicator';
import { t } from '@/lib/i18n';
import { APP_MONOGRAM, APP_NAME } from '@/lib/brand';

const NAV: Array<{ href: string; key: Parameters<typeof t>[0]; ic: string; adminOnly?: boolean }> = [
  { href: '/admin', key: 'nav.dashboard', ic: '◈' },
  { href: '/admin/sales', key: 'nav.sales', ic: '◇' },
  { href: '/admin/members', key: 'nav.members', ic: '⬡' },
  { href: '/admin/tree', key: 'nav.tree', ic: '⤳' },
  { href: '/admin/campaigns', key: 'nav.campaigns', ic: '⚑' },
  { href: '/admin/payouts', key: 'nav.payouts', ic: '◆', adminOnly: true },
  { href: '/admin/checks', key: 'nav.checks', ic: '🖶', adminOnly: true },
  { href: '/admin/periods', key: 'nav.periods', ic: '▥', adminOnly: true },
  { href: '/admin/audit', key: 'nav.audit', ic: '☰', adminOnly: true },
  { href: '/admin/settings', key: 'nav.settings', ic: '⚙', adminOnly: true },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSessionState] = useState<Session | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [viewingTenant, setViewingTenant] = useState<string | null>(null);

  // route degisince mobil drawer'i kapat
  useEffect(() => { setNavOpen(false); }, [pathname]);

  // impersonation band: sayfa yenilense de sessionStorage'dan okunur (item 4)
  useEffect(() => {
    if (isImpersonating()) setViewingTenant(window.sessionStorage.getItem('refearn.platform.viewingTenant'));
  }, []);

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
  const isPlatform = session.user.isPlatformAdmin === true;

  function logout() {
    clearSession();
    router.replace('/login');
  }

  /** Item 4: impersonation'dan cik — end'i best-effort bildir, platform oturumunu geri yukle, sirket sayfasina don. */
  async function exitImpersonation() {
    const returnPath = window.sessionStorage.getItem('refearn.platform.returnPath');
    const tenantId = returnPath?.split('/').pop();
    try {
      if (tenantId) await api.post(`/platform/companies/${tenantId}/impersonate/end`);
    } catch {
      // best-effort: audit kaydi basarisiz olsa da cikisi engelleme
    }
    const restored = stopImpersonation();
    if (restored) setSession(restored);
    window.sessionStorage.removeItem('refearn.platform.viewingTenant');
    window.sessionStorage.removeItem('refearn.platform.returnPath');
    router.push(returnPath ?? '/platform');
  }

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <div className="mobile-topbar no-print">
        <button className="hamburger" aria-label={t('nav.menu')} aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>☰</button>
        <div className="brand"><span className="dot">{APP_MONOGRAM}</span> {APP_NAME}</div>
        <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>
          <NotificationBell />
          <ThemeToggle />
        </div>
      </div>
      {navOpen && <div className="nav-backdrop no-print" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside className="side">
        <div className="brand"><span className="dot">{APP_MONOGRAM}</span> {APP_NAME}</div>
        <nav>
          {isPlatform && (
            <Link href="/platform" className={pathname.startsWith('/platform') ? 'active' : ''} onClick={() => setNavOpen(false)}>
              <span className="ic">◳</span>Platform
            </Link>
          )}
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
      <main className="main">
        {viewingTenant && (
          <div className="card" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, borderColor: 'var(--gold-500)' }}>
            <span>Viewing as <strong>{viewingTenant}</strong> — read-only</span>
            <span style={{ flex: 1 }} />
            <button className="btn ghost sm" onClick={exitImpersonation}>Exit</button>
          </div>
        )}
        {children}
      </main>
      <CommandPalette />
    </div>
  );
}
