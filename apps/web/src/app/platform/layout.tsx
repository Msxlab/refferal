'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, LogOut, type LucideIcon } from 'lucide-react';
import { getSession, type Session } from '@/lib/auth';
import { api } from '@/lib/api';
import { Brand, ThemeToggle } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const NAV: Array<{ href: string; label: string; Icon: LucideIcon }> = [{ href: '/platform', label: 'Companies', Icon: Building2 }];

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s || !s.user.isPlatformAdmin) {
      router.replace('/login');
      return;
    }
    setSession(s);
  }, [router]);

  if (!session) return <div className="center muted" role="status" aria-live="polite">Loading…</div>;

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
        <div className="mb-2.5 ml-1 text-[10px] uppercase tracking-widest text-muted-foreground">Platform</div>
        <nav aria-label="Platform navigation">
          {NAV.map(({ Icon, ...n }) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
              <Icon className="ic size-4" aria-hidden="true" />{n.label}
            </Link>
          ))}
        </nav>
        <div className="foot">
          <div className="text-[11px] text-muted-foreground">Platform owner</div>
          <div className="my-1 text-sm font-semibold">{session.user.fullName}</div>
          <div className="row spread">
            <Badge variant="secondary">platform</Badge>
            <div className="row" style={{ gap: 6 }}>
              <ThemeToggle />
              <Button variant="ghost" size="sm" onClick={logout}><LogOut />Log out</Button>
            </div>
          </div>
        </div>
      </aside>
      <header className="admin-mobilebar">
        <div className="admin-mobilebar-head">
          <Brand className="brand" />
          <div className="row" style={{ gap: 6 }}>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}><LogOut />Log out</Button>
          </div>
        </div>
        <nav aria-label="Platform navigation">
          {NAV.map(({ Icon, ...n }) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
              <Icon className="ic size-4" aria-hidden="true" />{n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main-content" className="main" tabIndex={-1}>{children}</main>
    </div>
  );
}
