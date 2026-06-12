'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, useToast } from '@/components/ui';
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
interface SalesList { total: number; items: SaleItem[] }
type Pending = { id: string; action: 'approve' | 'void' };

const STATUSES = ['', 'draft', 'approved', 'void'] as const;

export default function SalesPage() {
  const [list, setList] = useState<SalesList | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState('referral_code,amount_cents,sale_date,customer_ref\n');

  const load = useCallback(async () => {
    try {
      const q = status ? `&status=${status}` : '';
      setList(await api.get<SalesList>(`/admin/sales?pageSize=50${q}`));
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function createSale(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/admin/sales', { sellerReferralCode: code.trim(), amountCents: Number(amount) });
      setCode(''); setAmount('');
      showToast('Satis olusturuldu (taslak)');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function act(p: Pending) {
    setBusy(true);
    try {
      await api.post(`/admin/sales/${p.id}/${p.action}`);
      showToast(p.action === 'approve' ? 'Onaylandi, komisyonlar dagitildi ✓' : 'Iptal edildi');
      setConfirm(null);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function deliver(id: string) {
    try { await api.post(`/admin/sales/${id}/deliver`, {}); showToast('Teslim isaretlendi'); await load(); }
    catch (e) { setError(String((e as ApiError).message)); }
  }

  async function runImport() {
    setBusy(true); setError('');
    try {
      const res = await api.post<{ created: number; errors: { line: number; reason: string }[] }>('/admin/sales/import', { csv });
      showToast(`${res.created} satis olusturuldu, ${res.errors.length} hata`);
      setShowImport(false);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">{t('nav.sales')}</div>
          <h1 className="h1 fade-in">Satis yonetimi</h1>
        </div>
        <button className="btn ghost fade-in" onClick={() => setShowImport(true)}>⇪ {t('sales.import')}</button>
      </div>

      <form className="card fade-in delay-1" onSubmit={createSale} style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label>{t('sales.seller')}</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ORN: ALICE1" required />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label>{t('sales.amount')}</label>
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000000" required />
          </div>
          <button className="btn" disabled={busy}>+ {t('sales.new')}</button>
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>Tutar cent cinsindendir (orn. $100.000 = 10000000).</div>
      </form>

      {error && <div className="error">{error}</div>}

      <div className="card fade-in delay-2">
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong>Satislar</strong>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'Tum durumlar'}</option>)}
          </select>
        </div>
        {!list ? <Loading rows={3} /> : (
          <table>
            <thead><tr><th>Satici</th><th>Tutar</th><th>{t('sales.status')}</th><th>Tarih</th><th style={{ textAlign: 'right' }}>{t('common.actions')}</th></tr></thead>
            <tbody>
              {list.items.map((s) => (
                <tr key={s.id}>
                  <td>{s.sellerName}<div className="faint" style={{ fontSize: 12 }}>{s.sellerReferralCode}</div></td>
                  <td className="tnum" style={{ fontWeight: 650 }}>{money(s.amountCents, s.currency)}</td>
                  <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                  <td className="muted">{dateShort(s.saleDate)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {s.status === 'draft' && <button className="btn sm" onClick={() => setConfirm({ id: s.id, action: 'approve' })}>{t('sales.approve')}</button>}
                      {s.status === 'approved' && !s.deliveredAt && <button className="btn sm ghost" onClick={() => deliver(s.id)}>{t('sales.deliver')}</button>}
                      {s.status !== 'void' && <button className="btn sm danger" onClick={() => setConfirm({ id: s.id, action: 'void' })}>{t('sales.void')}</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {list.items.length === 0 && <tr><td colSpan={5} className="muted">Henuz satis yok.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {confirm && (
        <Confirm
          title={confirm.action === 'approve' ? 'Satisi onayla' : 'Satisi iptal et'}
          message={confirm.action === 'approve'
            ? 'Onaylaninca komisyonlar agaca dagitilir. Bu islem geri alinamaz.'
            : 'Iptal edilince ters kayitlar olusur ve bakiyeler dusurulur.'}
          confirmLabel={confirm.action === 'approve' ? t('sales.approve') : t('sales.void')}
          danger={confirm.action === 'void'}
          busy={busy}
          onConfirm={() => act(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}

      {showImport && (
        <div className="modal-backdrop" onClick={() => setShowImport(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 720, fontSize: 16, marginBottom: 6 }}>{t('sales.import')}</div>
            <p className="faint" style={{ marginTop: 0, fontSize: 12 }}>Baslik: referral_code,amount_cents,sale_date,customer_ref</p>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setShowImport(false)} disabled={busy}>{t('common.cancel')}</button>
              <button className="btn" onClick={runImport} disabled={busy}>{t('sales.import')}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
