'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { activeMembership, clearSession, getSession, isImpersonating, setSession, stopImpersonation, type Session } from '@/lib/auth';
import { api } from '@/lib/api';
import { Brand, ThemeToggle } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { t } from '@/lib/i18n';
import { Network, Wallet, Banknote, Users, Sparkles, Eye, LogOut, User } from 'lucide-react';

const NAV: Array<{ href: string; key: Parameters<typeof t>[0]; ic: React.ReactNode }> = [
  { href: '/app', key: 'anav.home', ic: <Network className="size-4" aria-hidden /> },
  { href: '/app/wallet', key: 'anav.wallet', ic: <Wallet className="size-4" aria-hidden /> },
  { href: '/app/sales', key: 'anav.sales', ic: <Banknote className="size-4" aria-hidden /> },
  { href: '/app/team', key: 'anav.team', ic: <Users className="size-4" aria-hidden /> },
  { href: '/app/invite', key: 'anav.invite', ic: <Sparkles className="size-4" aria-hidden /> },
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

  function logout() {
    clearSession();
    router.replace('/login');
  }

  async function exitImpersonation() {
    const mid = getSession()?.activeMembershipId;
    const admin = stopImpersonation();
    if (!admin) { router.replace('/login'); return; }
    setSession(admin);
    if (mid) { try { await api.post(`/admin/members/${mid}/impersonate/end`); } catch { /* yok say */ } }
    window.location.href = '/admin';
  }

  return (
    <div>
      {imp && (
        <div className="no-print" style={{ background: 'var(--amber)', color: 'color-mix(in srgb, var(--amber) 24%, black)', padding: '8px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 13, fontWeight: 600 }}>
          <span className="row" style={{ gap: 6, alignItems: 'center' }}><Eye className="size-4" aria-hidden />Viewing as <b>{session.user.fullName}</b> — read only</span>
          <button className="btn sm" style={{ background: 'color-mix(in srgb, var(--amber) 24%, black)', color: 'var(--amber)' }} onClick={exitImpersonation}>Exit impersonation</button>
        </div>
      )}
      <header className="topbar">
        <div className="inner">
          <Brand />
          <nav>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
                <span aria-hidden="true" style={{ opacity: 0.85, marginRight: 6, display: 'inline-flex', verticalAlign: 'middle' }}>{n.ic}</span>{t(n.key)}
              </Link>
            ))}
          </nav>
          <span className="faint" style={{ fontSize: 12 }}>{active?.tenantName}</span>
          <NotificationBell />
          <ThemeToggle />
          <Link href="/account" className="btn ghost sm" title="Account settings" aria-label="Account settings"><User className="size-4" aria-hidden />Account</Link>
          <button className="btn ghost sm" onClick={logout} aria-label={t('nav.logout')}><LogOut className="size-4" aria-hidden />{t('nav.logout')}</button>
        </div>
      </header>
      <main className="appmain">{children}</main>
    </div>
  );
}
