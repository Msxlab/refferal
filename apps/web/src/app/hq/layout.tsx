'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { clearSession, getSession, type Session } from '@/lib/auth';
import { ThemeToggle } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HqCompanySwitcher } from '@/components/HqCompanySwitcher';
import { APP_MONOGRAM, APP_NAME } from '@/lib/brand';

const NAV = [
  { href: '/hq', label: 'Overview', ic: '◈' },
  { href: '/hq/companies', label: 'Companies', ic: '◳' },
];

export default function HqLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  // route degisince mobil drawer'i kapat
  useEffect(() => { setNavOpen(false); }, [pathname]);

  useEffect(() => {
    const s = getSession();
    if (!s || !s.user.isPlatformAdmin) {
      router.replace('/login');
      return;
    }
    setSession(s);
  }, [router]);

  if (!session) return <div className="center muted">Loading…</div>;

  function logout() {
    clearSession();
    router.replace('/login');
  }

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <div className="mobile-topbar no-print">
        <button className="hamburger" aria-label="Menu" aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>☰</button>
        <div className="brand"><span className="dot">{APP_MONOGRAM}</span> {APP_NAME}</div>
        <div className="row" style={{ gap: 6, marginLeft: 'auto' }}><HqCompanySwitcher /><ThemeToggle /></div>
      </div>
      {navOpen && <div className="nav-backdrop no-print" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside className="side">
        <div className="brand"><span className="dot">{APP_MONOGRAM}</span> {APP_NAME}</div>
        <div className="faint" style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', margin: '0 0 10px 4px' }}>HQ</div>
        <div style={{ margin: '0 0 10px' }}><HqCompanySwitcher /></div>
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''} onClick={() => setNavOpen(false)}>
              <span className="ic">{n.ic}</span>{n.label}
            </Link>
          ))}
        </nav>
        <div className="foot">
          <div className="faint" style={{ fontSize: 11 }}>Platform owner</div>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '2px 0 4px' }}>{session.user.fullName}</div>
          <div className="row spread">
            <Badge variant="success" className="text-[10px]">platform</Badge>
            <div className="row" style={{ gap: 6 }}>
              <ThemeToggle />
              <Button variant="ghost" size="sm" onClick={logout}>Log out</Button>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
