'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { activeMembership, clearSession, getSession, isImpersonating, stopImpersonation, subscribeToSessionStorageChanges, type Session } from '@/lib/auth';
import { api } from '@/lib/api';
import { Brand, ThemeToggle } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { NotificationBell } from '@/components/NotificationBell';
import { t } from '@/lib/i18n';

const NAV: Array<{ href: string; key: Parameters<typeof t>[0]; ic: string }> = [
  { href: '/app', key: 'anav.home', ic: '◈' },
  { href: '/app/wallet', key: 'anav.wallet', ic: '◇' },
  { href: '/app/sales', key: 'anav.sales', ic: '◆' },
  { href: '/app/team', key: 'anav.team', ic: '⬡' },
  { href: '/app/invite', key: 'anav.invite', ic: '✦' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSessionState] = useState<Session | null>(null);
  const [imp, setImp] = useState(false);

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
        if (change.reload || !change.session) {
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

  if (!session) return <div className="center muted">{t('common.loading')}</div>;
  const active = activeMembership(session);

  async function logout() {
    await clearSession();
    router.replace('/login');
  }

  async function exitImpersonation() {
    const mid = getSession()?.activeMembershipId;
    const admin = await stopImpersonation();
    if (!admin) { router.replace('/login'); return; }
    if (mid) { try { await api.post(`/admin/members/${mid}/impersonate/end`); } catch { /* yok say */ } }
    window.location.href = '/admin';
  }

  return (
    <div>
      {imp && (
        <div className="no-print" style={{ background: 'var(--amber)', color: '#1a1404', padding: '8px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 13, fontWeight: 600 }}>
          <span>👁 Viewing as <b>{session.user.fullName}</b> — read only</span>
          <Button size="sm" style={{ background: '#1a1404', color: 'var(--amber)' }} onClick={exitImpersonation}>Exit impersonation</Button>
        </div>
      )}
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
          <Button asChild variant="ghost" size="sm">
            <Link href="/account" title="Account settings">Account</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={logout}>{t('nav.logout')}</Button>
        </div>
      </header>
      <main className="appmain">{children}</main>
    </div>
  );
}
