'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { NetworkExplorer, type ApiNode } from '@/components/NetworkExplorer';
import { bps, money } from '@/lib/format';

interface Company {
  id: string; slug: string; name: string; currency: string; timezone: string; status: string;
  payoutMinCents: string; maturationRule: string; createdAt: string;
  kpis: { members: number; activeMembers: number; revenueThisMonthCents: string; salesThisMonth: number; outstandingPayableCents: string };
  plan: { name: string; poolRateBps: number; depth: number } | null;
}

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [nodes, setNodes] = useState<ApiNode[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api.get<Company>(`/platform/companies/${id}`).then(setCompany).catch((e) => setError(String((e as ApiError).message)));
    api.get<ApiNode[]>(`/platform/companies/${id}/network`).then(setNodes).catch(() => {});
  }, [id]);

  if (error) return <div className="error">{error}</div>;
  if (!company) return <Loading rows={4} />;

  const c = company.currency;
  return (
    <div>
      <div className="row fade-in" style={{ gap: 8, marginBottom: 6 }}>
        <Link href="/platform" className="faint" style={{ fontSize: 12, textDecoration: 'none' }}>← Companies</Link>
      </div>
      <div className="spread fade-in" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 13 }}>
          <span style={{ width: 46, height: 46, borderRadius: 13, display: 'grid', placeItems: 'center', background: 'var(--foil)', color: 'var(--on-gold)', fontWeight: 800, fontSize: 20, fontFamily: 'var(--font-display)' }}>
            {company.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="h1" style={{ margin: 0 }}>{company.name}</h1>
            <div className="faint" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{company.slug} · {company.timezone}</div>
          </div>
        </div>
        <span className={`badge ${company.status === 'active' ? 'active' : 'inactive'}`}>{company.status}</span>
      </div>

      <div className="stat-grid fade-in delay-1" style={{ margin: '18px 0' }}>
        <Kpi label="Members" value={`${company.kpis.activeMembers} / ${company.kpis.members}`} icon="⬡" hint="active / total" />
        <Kpi label="Revenue this month" value={money(company.kpis.revenueThisMonthCents, c)} icon="◆" hint={`${company.kpis.salesThisMonth} approved sales`} />
        <Kpi label="Outstanding payable" value={money(company.kpis.outstandingPayableCents, c)} icon="◷" hint="awaiting payout" />
        <Kpi label="Plan" value={company.plan ? bps(company.plan.poolRateBps) : '—'} icon="◇" hint={company.plan ? `${company.plan.name} · depth ${company.plan.depth}` : 'no plan'} />
      </div>

      <div className="card fade-in delay-2" style={{ marginBottom: 20 }}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 15 }}>Referral network</strong>
          <span className="faint" style={{ fontSize: 12 }}>Tree / list · drill into anyone</span>
        </div>
        {!nodes ? <Loading rows={4} /> : <NetworkExplorer nodes={nodes} title={company.name} />}
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, hint }: { label: string; value: string; icon: string; hint?: string }) {
  return (
    <div className="card stat">
      <div className="spread"><span className="k">{label}</span><span className="icon">{icon}</span></div>
      <div className="v">{value}</div>
      {hint && <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>{hint}</div>}
    </div>
  );
}
