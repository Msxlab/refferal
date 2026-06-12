'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Bars, Donut, Loading, MoneyCounter } from '@/components/ui';
import { money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface LevelRow {
  level: number;
  pendingCents: string;
  payableCents: string;
  paidCents: string;
}
interface Dashboard {
  month: string;
  currency: string;
  totals: { pendingCents: string; payableCents: string; paidCents: string };
  levels: LevelRow[];
}

export default function MemberDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Dashboard>('/app/dashboard').then(setData).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <Loading />;

  const c = data.currency;
  const pending = Number(data.totals.pendingCents);
  const payable = Number(data.totals.payableCents);
  const paid = Number(data.totals.paidCents);
  const total = pending + payable + paid;

  const segs = [
    { label: t('me.pending'), value: Math.max(0, pending), color: 'var(--amber)' },
    { label: t('me.payable'), value: Math.max(0, payable), color: 'var(--sky)' },
    { label: t('me.paid'), value: Math.max(0, paid), color: 'var(--emerald)' },
  ];

  const levelBars = data.levels.map((l) => ({
    label: `Seviye ${l.level}`,
    value: Number(l.payableCents) + Number(l.pendingCents) + Number(l.paidCents),
    color: 'var(--grad-primary)',
  }));

  return (
    <div>
      <div className="eyebrow fade-in">{t('anav.home')} · {data.month}</div>
      <h1 className="h1 fade-in">{t('me.title')}</h1>
      <p className="sub fade-in">{t('me.sub')}</p>

      {/* hero + donut */}
      <div className="grid fade-in delay-1" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', alignItems: 'stretch' }}>
        <div className="card hero">
          <div className="faint" style={{ fontSize: 12 }}>{t('me.monthTotal')}</div>
          <div className="bignum gradient-text" style={{ marginTop: 6 }}>
            <MoneyCounter cents={total} currency={c} />
          </div>
          <div className="row" style={{ marginTop: 20, gap: 18 }}>
            <Chip color="var(--amber)" label={t('me.pending')} value={money(pending, c)} />
            <Chip color="var(--sky)" label={t('me.payable')} value={money(payable, c)} />
            <Chip color="var(--emerald)" label={t('me.paid')} value={money(paid, c)} />
          </div>
        </div>

        <div className="card" style={{ display: 'grid', placeItems: 'center' }}>
          <Donut
            segments={segs}
            center={
              <div>
                <div className="faint" style={{ fontSize: 11 }}>{t('me.balance')}</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{money(payable, c)}</div>
                <div className="faint" style={{ fontSize: 10 }}>{t('me.payable')}</div>
              </div>
            }
          />
        </div>
      </div>

      {/* seviye dokumu */}
      <div className="card fade-in delay-2" style={{ marginTop: 16 }}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <strong>{t('me.levelBreakdown')}</strong>
          <span className="faint" style={{ fontSize: 12 }}>{t('me.levelHint')}</span>
        </div>
        {levelBars.length > 0 ? (
          <Bars data={levelBars} format={(v) => money(v, c)} />
        ) : (
          <div className="muted">{t('me.noData')}</div>
        )}
      </div>

      <div className="faint fade-in" style={{ fontSize: 11, marginTop: 16, lineHeight: 1.5 }}>{t('me.incomeNote')}</div>
    </div>
  );
}

function Chip({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div>
      <div className="row" style={{ gap: 7 }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
        <span className="faint" style={{ fontSize: 11 }}>{label}</span>
      </div>
      <div className="tnum" style={{ fontWeight: 700, marginTop: 3 }}>{value}</div>
    </div>
  );
}
