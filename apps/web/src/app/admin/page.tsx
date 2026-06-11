'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Donut, Loading, MoneyCounter, StatCard } from '@/components/ui';
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
    api.get<Dashboard>('/admin/dashboard').then(setData).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <Loading />;

  const c = data.currency;
  const revenue = Number(data.thisMonth.revenueCents);
  const commission = Number(data.thisMonth.commissionCents);
  const net = Math.max(0, revenue - commission);

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.dashboard')} · {data.month}</div>
      <h1 className="h1 fade-in">Genel bakis</h1>
      <p className="sub fade-in">Bu donemin ciro, komisyon ve uye ozeti.</p>

      <div className="grid fade-in delay-1" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
        <div className="card hero">
          <div className="faint" style={{ fontSize: 12 }}>{t('dash.revenue')}</div>
          <div className="bignum gradient-text" style={{ marginTop: 6 }}><MoneyCounter cents={revenue} currency={c} /></div>
          <div className="row" style={{ marginTop: 18, gap: 22 }}>
            <div>
              <div className="faint" style={{ fontSize: 11 }}>{t('dash.commission')}</div>
              <div className="tnum" style={{ fontWeight: 700 }}>{money(commission, c)}</div>
            </div>
            <div>
              <div className="faint" style={{ fontSize: 11 }}>{t('dash.effRate')}</div>
              <div className="tnum" style={{ fontWeight: 700 }}>{bps(data.thisMonth.effectiveRateBps)}</div>
            </div>
            <div>
              <div className="faint" style={{ fontSize: 11 }}>Onayli satis</div>
              <div className="tnum" style={{ fontWeight: 700 }}>{data.thisMonth.approvedSalesCount}</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ display: 'grid', placeItems: 'center' }}>
          <Donut
            segments={[
              { label: 'Net', value: net, color: 'var(--emerald)' },
              { label: 'Komisyon', value: commission, color: 'var(--primary)' },
            ]}
            center={
              <div>
                <div className="faint" style={{ fontSize: 11 }}>Komisyon payi</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{bps(data.thisMonth.effectiveRateBps)}</div>
              </div>
            }
          />
        </div>
      </div>

      <div className="stat-grid fade-in delay-2" style={{ marginTop: 16 }}>
        <StatCard label={t('dash.payable')} value={money(data.outstandingPayableCents, c)} icon="◆" grad="var(--grad-sky)" hint="Odenmeyi bekleyen toplam" />
        <StatCard label={t('dash.members')} value={`${data.members.active} / ${data.members.total}`} icon="⬡" grad="var(--grad-primary)" hint="Aktif / toplam" />
        <StatCard label={t('dash.pendingReq')} value={String(data.pendingPayoutRequests)} icon="◷" grad="var(--grad-amber)" hint="Uye odeme talepleri" />
      </div>
    </div>
  );
}
