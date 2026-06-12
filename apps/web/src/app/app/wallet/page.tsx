'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, MoneyCounter, useToast } from '@/components/ui';
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
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [w, h] = await Promise.all([api.get<Wallet>('/app/wallet'), api.get<PayoutReq[]>('/app/payout-requests')]);
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
      showToast('Your payout request has been received ✓');
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  if (error && !wallet) return <div className="error">{error}</div>;
  if (!wallet) return <Loading />;
  const b = wallet.balance;

  return (
    <div>
      <div className="eyebrow fade-in">{t('anav.wallet')}</div>
      <h1 className="h1 fade-in">Your Wallet</h1>
      <p className="sub fade-in">Track your payable balance and request a payout.</p>

      <div className="card hero fade-in delay-1">
        <div className="spread">
          <div>
            <div className="faint" style={{ fontSize: 12 }}>{t('me.payable')} balance</div>
            <div className="bignum gradient-text" style={{ marginTop: 6 }}>
              <MoneyCounter cents={b.payableCents} />
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
              {t('me.pending')}: <b className="tnum">{money(b.pendingCents)}</b> · {t('me.paid')}:{' '}
              <b className="tnum">{money(b.paidCents)}</b>
            </div>
          </div>
          <button className="btn success" onClick={requestPayout} disabled={busy}>{t('me.requestPayout')}</button>
        </div>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <div className="card fade-in delay-2" style={{ marginTop: 16 }}>
        <strong style={{ display: 'block', marginBottom: 12 }}>{t('me.ledger')}</strong>
        <table>
          <thead><tr><th>Date</th><th>Level</th><th>Type</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {wallet.ledger.items.map((e) => (
              <tr key={e.id}>
                <td className="muted">{dateShort(e.createdAt)}</td>
                <td>L{e.level}</td>
                <td className="faint">{e.type}</td>
                <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                <td className="tnum" style={{ textAlign: 'right', fontWeight: 650, color: Number(e.amountCents) < 0 ? 'var(--rose)' : undefined }}>{money(e.amountCents)}</td>
              </tr>
            ))}
            {wallet.ledger.items.length === 0 && <tr><td colSpan={5} className="muted">{t('me.noData')}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card fade-in delay-3" style={{ marginTop: 16 }}>
        <strong style={{ display: 'block', marginBottom: 12 }}>{t('me.payoutHistory')}</strong>
        <table>
          <thead><tr><th>Period</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            {history.map((p) => (
              <tr key={p.id}>
                <td>{p.period}</td>
                <td className="tnum">{money(p.totalCents)}</td>
                <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                <td className="muted">{dateShort(p.paidAt)}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={4} className="muted">{t('me.noData')}</td></tr>}
          </tbody>
        </table>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
