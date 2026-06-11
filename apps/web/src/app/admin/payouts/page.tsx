'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getCsv } from '@/lib/api';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface PayableMember {
  membershipId: string;
  referralCode: string;
  fullName: string;
  netCents: string;
}
interface PayableList {
  payoutMinCents: string;
  currency: string;
  members: PayableMember[];
}
interface PayoutItem {
  id: string;
  referralCode: string;
  fullName: string;
  totalCents: string;
  method: string;
  status: string;
  period: string;
  paidAt: string | null;
}
interface PayoutsList {
  items: PayoutItem[];
}

export default function PayoutsPage() {
  const [payable, setPayable] = useState<PayableList | null>(null);
  const [history, setHistory] = useState<PayoutsList | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([
        api.get<PayableList>('/admin/payouts/payable'),
        api.get<PayoutsList>('/admin/payouts?pageSize=50'),
      ]);
      setPayable(p);
      setHistory(h);
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function runAll() {
    if (!payable?.members.length) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ paidCount: number; skippedCount: number }>('/admin/payouts/run', { method: 'csv' });
      flash(`${res.paidCount} odeme yapildi, ${res.skippedCount} atlandi`);
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv() {
    try {
      const csv = await getCsv('/admin/payouts/export.csv');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'payouts.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  const c = payable?.currency ?? 'USD';

  return (
    <div>
      <h1 className="h1">{t('nav.payouts')}</h1>
      {error && <div className="error">{error}</div>}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <strong>{t('payouts.payable')}</strong>
            <span className="muted" style={{ marginLeft: 8 }}>
              min {payable ? money(payable.payoutMinCents, c) : '—'}
            </span>
          </div>
          <div className="row">
            <button className="btn" onClick={runAll} disabled={busy || !payable?.members.length}>
              {t('payouts.run')}
            </button>
            <button className="btn ghost" onClick={downloadCsv}>{t('payouts.export')}</button>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>Uye</th><th>Kod</th><th>Net odenebilir</th></tr>
          </thead>
          <tbody>
            {payable?.members.map((m) => (
              <tr key={m.membershipId}>
                <td>{m.fullName}</td>
                <td className="muted">{m.referralCode}</td>
                <td>{money(m.netCents, c)}</td>
              </tr>
            ))}
            {payable && payable.members.length === 0 && (
              <tr><td colSpan={3} className="muted">Esigi gecen uye yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <strong style={{ display: 'block', marginBottom: 12 }}>{t('payouts.history')}</strong>
        <table>
          <thead>
            <tr><th>Uye</th><th>Tutar</th><th>Yontem</th><th>Durum</th><th>Donem</th><th>Tarih</th></tr>
          </thead>
          <tbody>
            {history?.items.map((p) => (
              <tr key={p.id}>
                <td>{p.fullName}<div className="muted" style={{ fontSize: 12 }}>{p.referralCode}</div></td>
                <td>{money(p.totalCents, c)}</td>
                <td className="muted">{p.method}</td>
                <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                <td>{p.period}</td>
                <td>{dateShort(p.paidAt)}</td>
              </tr>
            ))}
            {history && history.items.length === 0 && (
              <tr><td colSpan={6} className="muted">Henuz odeme yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
