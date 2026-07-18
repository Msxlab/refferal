'use client';
import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { actAsCompany } from '@/lib/hq';
import { api, setActiveCompanyToken } from '@/lib/api';
import { HqCompanySwitcher } from '@/components/HqCompanySwitcher';
import { Loading } from '@/components/ui';

const MODULES = [
  ['', 'Overview'], ['sales', 'Sales'], ['members', 'Members'], ['tree', 'Network'],
  ['campaigns', 'Campaigns'], ['payouts', 'Payouts'], ['checks', 'Checks'],
  ['periods', 'Close'], ['audit', 'Audit'], ['settings', 'Settings'],
] as const;

export default function HqCompanyLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const [readyId, setReadyId] = useState<string | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    const s = getSession();
    if (!s?.user.isPlatformAdmin) { router.replace('/login'); return; }
    let alive = true;
    (async () => {
      try {
        const [company, tok] = await Promise.all([
          api.get<{ name: string }>(`/platform/companies/${id}`),
          actAsCompany(id),
        ]);
        if (!alive) return;
        setName(company.name);
        setActiveCompanyToken(tok.accessToken);
        setReadyId(id);            // mark THIS id ready (not a bare boolean)
      } catch { if (alive) router.replace('/hq'); }
    })();
    return () => { alive = false; setActiveCompanyToken(null); };
  }, [id, router]);

  const ready = readyId === id;    // derived: immediately false when id changes
  if (!ready) return <div className="center"><Loading rows={3} /></div>;

  return (
    <div key={id}>
      <div className="spread" style={{ marginBottom: 12 }}>
        <Link href="/hq" className="faint" style={{ textDecoration: 'none' }}>← Overview</Link>
        <HqCompanySwitcher currentId={id} />
      </div>
      <div className="eyebrow">{name}</div>
      <div className="seg-tabs" role="tablist" style={{ marginBottom: 14 }}>
        {MODULES.map(([seg, label]) => {
          const href = `/hq/c/${id}${seg ? `/${seg}` : ''}`;
          const on = pathname === href;
          return <Link key={seg} href={href} className={`seg-tab ${on ? 'on' : ''}`} style={{ textDecoration: 'none' }}>{label}</Link>;
        })}
      </div>
      {children}
    </div>
  );
}
