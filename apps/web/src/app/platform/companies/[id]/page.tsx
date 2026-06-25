'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, switchTenant } from '@/lib/api';
import { applyTenantSwitch, getSession, membershipForTenant } from '@/lib/auth';
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
  const router = useRouter();
  const [company, setCompany] = useState<Company | null>(null);
  const [nodes, setNodes] = useState<ApiNode[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);
  const [enterMsg, setEnterMsg] = useState('');

  async function load() {
    if (!id) return;
    try {
      setCompany(await api.get<Company>(`/platform/companies/${id}`));
      setNodes(await api.get<ApiNode[]>(`/platform/companies/${id}/network`));
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  /** Platform → bu sirketin yonetim isyerine gir: uyeligi aktif yap (token'i tenant'a scope et) ve /admin'e gec. */
  async function enterWorkspace() {
    if (!company) return;
    const session = getSession();
    if (!session) { router.replace('/login'); return; }
    const membership = membershipForTenant(session, company.id);
    if (!membership) {
      setEnterMsg('You have no membership in this company yet, so its workspace can’t be opened.');
      return;
    }
    setEntering(true); setEnterMsg('');
    try {
      const res = await switchTenant(membership.id);
      applyTenantSwitch(res.accessToken, res.activeMembershipId);
      router.push('/admin');
    } catch (e) {
      setEntering(false);
      setEnterMsg(String((e as ApiError).message));
    }
  }

  async function toggleStatus() {
    if (!company) return;
    setBusy(true); setError('');
    try {
      const action = company.status === 'active' ? 'suspend' : 'reactivate';
      await api.post(`/platform/companies/${company.id}/${action}`, { reason: `platform ${action}` });
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

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
        <div className="row" style={{ gap: 8 }}>
          <span className={`badge ${company.status === 'active' ? 'active' : 'inactive'}`}>{company.status}</span>
          <button className="btn sm" onClick={enterWorkspace} disabled={entering}>
            {entering ? 'Opening…' : 'Enter workspace →'}
          </button>
          <button className={`btn sm ghost ${company.status === 'active' ? 'danger' : ''}`} onClick={toggleStatus} disabled={busy}>
            {company.status === 'active' ? 'Suspend' : 'Reactivate'}
          </button>
        </div>
      </div>
      {enterMsg && <div className="error" style={{ marginTop: 10 }}>{enterMsg}</div>}

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
