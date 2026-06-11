'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
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
  if (!data) return <div className="muted">{t('common.loading')}</div>;

  const c = data.currency;
  const cards = [
    { k: t('me.pending'), v: money(data.totals.pendingCents, c), cls: 'pending' },
    { k: t('me.payable'), v: money(data.totals.payableCents, c), cls: 'payable' },
    { k: t('me.paid'), v: money(data.totals.paidCents, c), cls: 'paid' },
  ];

  return (
    <div>
      <h1 className="h1">{t('anav.home')} <span className="muted" style={{ fontSize: 14 }}>· {data.month}</span></h1>

      <div className="stat-grid" style={{ marginBottom: 18 }}>
        {cards.map((c2) => (
          <div className="card" key={c2.k}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">{c2.k}</span>
              <span className={`badge ${c2.cls}`}>{c2.cls}</span>
            </div>
            <div className="bignum" style={{ marginTop: 8 }}>{c2.v}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <strong style={{ display: 'block', marginBottom: 10 }}>{t('me.levelBreakdown')}</strong>
        <table>
          <thead>
            <tr>
              <th>{t('me.level')}</th>
              <th>{t('me.pending')}</th>
              <th>{t('me.payable')}</th>
              <th>{t('me.paid')}</th>
            </tr>
          </thead>
          <tbody>
            {data.levels.map((l) => (
              <tr key={l.level}>
                <td>L{l.level}</td>
                <td>{money(l.pendingCents, c)}</td>
                <td>{money(l.payableCents, c)}</td>
                <td>{money(l.paidCents, c)}</td>
              </tr>
            ))}
            {data.levels.length === 0 && (
              <tr><td colSpan={4} className="muted">{t('me.noData')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 14 }}>{t('me.incomeNote')}</div>
    </div>
  );
}
