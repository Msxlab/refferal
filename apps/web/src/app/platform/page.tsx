'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Loading, StatCard } from '@/components/ui';
import { money } from '@/lib/format';
import { APP_NAME } from '@/lib/brand';

interface Overview {
  kpis: {
    companies: number;
    active: number;
    suspended: number;
    members: number;
    platformRevenueThisMonthCents: string;
    ar: { openCents: string; overdueCents: string; paidCents: string };
  };
  needsAttention: Array<{ tenantId: string; tenantName: string; kind: string; severity: 'high' | 'warn'; detail: string; ctaHref: string }>;
}
interface Mrr { mrrCents: string; activeCount: number }

/** Platform komuta merkezi: KPI ozeti + MRR + "ilgi bekleyenler" kuyrugu (item 1, 11). */
export default function PlatformOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [mrr, setMrr] = useState<Mrr | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Overview>('/platform/overview').then(setData).catch((e) => setError(String((e as ApiError).message)));
    api.get<Mrr>('/platform/mrr').then(setMrr).catch(() => {});
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <Loading rows={4} />;

  const { kpis, needsAttention } = data;

  if (kpis.companies === 0) {
    return (
      <div>
        <div className="eyebrow fade-in">Platform</div>
        <h1 className="h1 fade-in">Overview</h1>
        <div className="card fade-in delay-1" style={{ marginTop: 18, textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>◈</div>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>No companies yet</div>
          <p className="muted" style={{ marginBottom: 18 }}>Create your first company to start onboarding members on {APP_NAME}.</p>
          <Link href="/platform/companies" className="btn">＋ Create your first company</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="eyebrow fade-in">Platform</div>
      <h1 className="h1 fade-in">Overview</h1>
      <p className="sub fade-in" style={{ marginBottom: 16 }}>A single command center across every company on {APP_NAME}.</p>

      <div className="stat-grid fade-in delay-1" style={{ marginBottom: 18 }}>
        <StatCard label="Companies" value={String(kpis.companies)} icon="◳" />
        <StatCard label="Active / Suspended" value={`${kpis.active} / ${kpis.suspended}`} icon="◈" />
        <StatCard label="Members (all)" value={kpis.members.toLocaleString('en-US')} icon="⬡" />
        <StatCard label="Platform revenue (mo)" value={money(kpis.platformRevenueThisMonthCents, 'USD')} icon="◆" />
        <StatCard label="MRR" value={mrr ? money(mrr.mrrCents, 'USD') : '—'} icon="↻" hint={mrr ? `${mrr.activeCount} active billing config${mrr.activeCount === 1 ? '' : 's'}` : undefined} />
        <StatCard label="AR outstanding" value={money(kpis.ar.openCents, 'USD')} icon="✎" />
        <StatCard label="AR overdue" value={money(kpis.ar.overdueCents, 'USD')} icon="!" />
        <StatCard label="AR collected" value={money(kpis.ar.paidCents, 'USD')} icon="✓" />
      </div>

      <div className="card fade-in delay-2">
        <div className="spread" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Needs attention</div>
          <span className="faint" style={{ fontSize: 12 }}>{needsAttention.length} item{needsAttention.length === 1 ? '' : 's'}</span>
        </div>
        {needsAttention.length === 0 ? (
          <div className="muted" style={{ padding: '18px 0', textAlign: 'center' }}>All clear — nothing needs attention right now.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {needsAttention.map((row, i) => (
              <Link
                key={`${row.tenantId}:${row.kind}:${i}`}
                href={row.ctaHref}
                className="row spread hover"
                style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}
              >
                <div className="row" style={{ gap: 10 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: row.severity === 'high' ? 'var(--rose)' : 'var(--amber)',
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{row.tenantName}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{row.detail}</div>
                  </div>
                </div>
                <span className="faint" style={{ fontSize: 12 }}>View →</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
