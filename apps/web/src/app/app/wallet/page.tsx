'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface LedgerItem {
  id: string;
  level: number;
  amountCents: string;
  type: string;
  status: string;
  createdAt: string;
}
interface Wallet {
  balance: { pendingCents: string; payableCents: string; paidCents: string };
  ledger: { total: number; items: LedgerItem[] };
}
interface PayoutReq {
  id: string;
  totalCents: string;
  status: string;
  period: string;
  paidAt: string | null;
}

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [history, setHistory] = useState<PayoutReq[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [w, h] = await Promise.all([
        api.get<Wallet>('/app/wallet'),
        api.get<PayoutReq[]>('/app/payout-requests'),
      ]);
      setWallet(w);
      setHistory(h);
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestPayout() {
    setBusy(true);
    setError('');
    try {
      await api.post('/app/payout-requests');
      setToast(t('me.requestPayout') + ' ✓');
      setTimeout(() => setToast(''), 2500);
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  if (error && !wallet) return <div className="error">{error}</div>;
  if (!wallet) return <div className="muted">{t('common.loading')}</div>;

  const b = wallet.balance;
  return (
    <div>
      <h1 className="h1">{t('anav.wallet')}</h1>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <span className="muted">{t('me.payable')}</span>
            <div className="bignum">{money(b.payableCents)}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {t('me.pending')}: {money(b.pendingCents)} · {t('me.paid')}: {money(b.paidCents)}
            </div>
          </div>
          <button className="btn" onClick={requestPayout} disabled={busy}>{t('me.requestPayout')}</button>
        </div>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <strong style={{ display: 'block', marginBottom: 10 }}>{t('me.ledger')}</strong>
        <table>
          <thead>
            <tr><th>Tarih</th><th>{t('me.level')}</th><th>Tip</th><th>Durum</th><th>Tutar</th></tr>
          </thead>
          <tbody>
            {wallet.ledger.items.map((e) => (
              <tr key={e.id}>
                <td>{dateShort(e.createdAt)}</td>
                <td>L{e.level}</td>
                <td className="muted">{e.type}</td>
                <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                <td>{money(e.amountCents)}</td>
              </tr>
            ))}
            {wallet.ledger.items.length === 0 && (
              <tr><td colSpan={5} className="muted">{t('me.noData')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <strong style={{ display: 'block', marginBottom: 10 }}>{t('me.payoutHistory')}</strong>
        <table>
          <thead>
            <tr><th>Donem</th><th>Tutar</th><th>Durum</th><th>Tarih</th></tr>
          </thead>
          <tbody>
            {history.map((p) => (
              <tr key={p.id}>
                <td>{p.period}</td>
                <td>{money(p.totalCents)}</td>
                <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                <td>{dateShort(p.paidAt)}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={4} className="muted">{t('me.noData')}</td></tr>}
          </tbody>
        </table>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
