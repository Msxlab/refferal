'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getOverview, type OverviewResp } from '@/lib/hq';
import { Loading } from '@/components/ui';
import { money } from '@/lib/format';
import { ApiError } from '@/lib/api';

export default function HqOverviewPage() {
  const router = useRouter();
  const [data, setData] = useState<OverviewResp | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getOverview().then(setData).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <Loading rows={4} />;

  const t = data.totals;
  return (
    <div>
      <div className="eyebrow fade-in">Command center</div>
      <h1 className="h1 fade-in">Overview</h1>

      <div className="stat-grid fade-in delay-1" style={{ margin: '16px 0' }}>
        <Kpi label="Revenue · this month" value={money(t.grossRevenueCents)} icon="◆" />
        <Kpi label="Net profit" value={money(t.netCents)} icon="◇" />
        <Kpi label="Commission payable" value={money(t.payableCents)} icon="◷" />
        <Kpi label="Active members" value={String(t.activeMembers)} icon="⬡" />
      </div>

      <strong className="faint" style={{ fontSize: 13 }}>Companies · by earnings</strong>
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 8, marginBottom: 18 }}>
        {data.leaderboard.map((c) => (
          <button key={c.id} className="spread" onClick={() => router.push(`/hq/c/${c.id}`)}
            style={{ width: '100%', textAlign: 'left', padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>
            <span><strong>{c.name}</strong> <span className="faint" style={{ fontSize: 12 }}>{c.activeMembers}/{c.members} members · {c.status}</span></span>
            <span className="tnum" style={{ fontWeight: 650 }}>{money(c.revenueThisMonthCents, c.currency)}</span>
          </button>
        ))}
        {data.leaderboard.length === 0 && <div className="muted" style={{ padding: 16 }}>Create your first company.</div>}
      </div>

      <strong className="faint" style={{ fontSize: 13 }}>Needs your attention</strong>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 8 }}>
        <Attn label="Payout approvals" value={data.attention.payoutApprovals} />
        <Attn label="KYC / risk" value={data.attention.riskReviews} />
        <Attn label="Overdue invoices" value={data.attention.overdueInvoices} />
        <Attn label="Campaigns to finalize" value={data.attention.campaignsToFinalize} />
      </div>
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="card stat">
      <div className="spread"><span className="k">{label}</span><span className="icon">{icon}</span></div>
      <div className="v">{value}</div>
    </div>
  );
}
function Attn({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="faint" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
