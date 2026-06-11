'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { bps, money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Dashboard {
  month: string;
  currency: string;
  members: { total: number; active: number };
  thisMonth: { approvedSalesCount: number; revenueCents: string; commissionCents: string; effectiveRateBps: number };
  outstandingPayableCents: string;
  pendingPayoutRequests: number;
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Dashboard>('/admin/dashboard').then(setData).catch((e) => setError(String(e.message)));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="muted">{t('common.loading')}</div>;

  const c = data.currency;
  const stats = [
    { k: t('dash.revenue'), v: money(data.thisMonth.revenueCents, c) },
    { k: t('dash.commission'), v: money(data.thisMonth.commissionCents, c) },
    { k: t('dash.effRate'), v: bps(data.thisMonth.effectiveRateBps) },
    { k: t('dash.payable'), v: money(data.outstandingPayableCents, c) },
    { k: t('dash.members'), v: `${data.members.active} / ${data.members.total}` },
    { k: t('dash.pendingReq'), v: String(data.pendingPayoutRequests) },
  ];

  return (
    <div>
      <h1 className="h1">{t('nav.dashboard')} <span className="muted" style={{ fontSize: 14 }}>· {data.month}</span></h1>
      <div className="stat-grid">
        {stats.map((s) => (
          <div className="card stat" key={s.k}>
            <div className="k">{s.k}</div>
            <div className="v">{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
