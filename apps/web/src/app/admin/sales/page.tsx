'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface SaleItem {
  id: string;
  amountCents: string;
  currency: string;
  status: 'draft' | 'approved' | 'void';
  saleDate: string;
  deliveredAt: string | null;
  sellerReferralCode: string;
  sellerName: string;
}
interface SalesList {
  total: number;
  page: number;
  pageSize: number;
  items: SaleItem[];
}

export default function SalesPage() {
  const [list, setList] = useState<SalesList | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // yeni satis formu
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api.get<SalesList>('/admin/sales?pageSize=50'));
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  async function createSale(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/admin/sales', { sellerReferralCode: code.trim(), amountCents: Number(amount) });
      setCode('');
      setAmount('');
      flash('Satis olusturuldu (taslak)');
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: 'approve' | 'void' | 'deliver') {
    try {
      await api.post(`/admin/sales/${id}/${action}`, action === 'deliver' ? {} : undefined);
      flash(action === 'approve' ? 'Onaylandi, komisyonlar dagitildi' : action === 'void' ? 'Iptal edildi' : 'Teslim isaretlendi');
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  return (
    <div>
      <h1 className="h1">{t('nav.sales')}</h1>

      <form className="card" onSubmit={createSale} style={{ marginBottom: 18 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label>{t('sales.seller')}</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ORN: ALICE1" required />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label>{t('sales.amount')}</label>
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000000" required />
          </div>
          <button className="btn" disabled={busy}>{t('sales.new')}</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Tutar cent cinsindendir (orn. $100.000 = 10000000).
        </div>
      </form>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Satici</th>
              <th>Tutar</th>
              <th>{t('sales.status')}</th>
              <th>Tarih</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list?.items.map((s) => (
              <tr key={s.id}>
                <td>{s.sellerName}<div className="muted" style={{ fontSize: 12 }}>{s.sellerReferralCode}</div></td>
                <td>{money(s.amountCents, s.currency)}</td>
                <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                <td>{dateShort(s.saleDate)}</td>
                <td>
                  <div className="row">
                    {s.status === 'draft' && (
                      <button className="btn sm" onClick={() => act(s.id, 'approve')}>{t('sales.approve')}</button>
                    )}
                    {s.status === 'approved' && !s.deliveredAt && (
                      <button className="btn sm ghost" onClick={() => act(s.id, 'deliver')}>{t('sales.deliver')}</button>
                    )}
                    {s.status !== 'void' && (
                      <button className="btn sm danger" onClick={() => act(s.id, 'void')}>{t('sales.void')}</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {list && list.items.length === 0 && (
              <tr><td colSpan={5} className="muted">Henuz satis yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
