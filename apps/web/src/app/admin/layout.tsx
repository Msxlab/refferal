'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Network,
  ReceiptText,
  Settings,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { activeMembership, getSession, isAdminRole, type Session } from '@/lib/auth';
import { api } from '@/lib/api';
import { Brand, ThemeToggle } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { t } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const NAV: Array<{ href: string; key: Parameters<typeof t>[0]; Icon: LucideIcon; adminOnly?: boolean }> = [
  { href: '/admin', key: 'nav.dashboard', Icon: LayoutDashboard },
  { href: '/admin/sales', key: 'nav.sales', Icon: ReceiptText },
  { href: '/admin/members', key: 'nav.members', Icon: Users },
  { href: '/admin/tree', key: 'nav.tree', Icon: Network },
  { href: '/admin/payouts', key: 'nav.payouts', Icon: WalletCards, adminOnly: true },
  { href: '/admin/audit', key: 'nav.audit', Icon: ClipboardList, adminOnly: true },
  { href: '/admin/settings', key: 'nav.settings', Icon: Settings, adminOnly: true },
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

  if (!session) return <div className="center muted" role="status" aria-live="polite">{t('common.loading')}</div>;
  const active = activeMembership(session);
  const isStaff = active?.role === 'tenant_staff';

  async function logout() {
    try {
      await api.logout();
    } finally {
      router.replace('/login');
    }
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="side">
        <Brand className="brand" />
        <nav aria-label="Administrator navigation">
          {NAV.filter((n) => !(n.adminOnly && isStaff)).map(({ Icon, ...n }) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
              <Icon className="ic size-4" aria-hidden="true" />{t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="foot">
          <div className="faint" style={{ fontSize: 11 }}>{active?.tenantName}</div>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '2px 0 4px' }}>{session.user.fullName}</div>
          <div className="row spread">
            <Badge variant="secondary">{active?.role}</Badge>
            <div className="row" style={{ gap: 6 }}>
              <NotificationBell placement="up" />
              <ThemeToggle />
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut />
                {t('nav.logout')}
              </Button>
            </div>
          </div>
        </div>
      </aside>
      <header className="admin-mobilebar">
        <div className="admin-mobilebar-head">
          <Brand className="brand" />
          <div className="row" style={{ gap: 6 }}>
            <NotificationBell />
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut />
              {t('nav.logout')}
            </Button>
          </div>
        </div>
        <nav aria-label="Administrator navigation">
          {NAV.filter((n) => !(n.adminOnly && isStaff)).map(({ Icon, ...n }) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
              <Icon className="ic size-4" aria-hidden="true" />{t(n.key)}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main-content" className="main" tabIndex={-1}>{children}</main>
    </div>
  );
}
