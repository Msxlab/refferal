'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getCsv } from '@/lib/api';
import { Confirm, Loading, MoneyCounter, useToast } from '@/components/ui';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface PayableMember { membershipId: string; referralCode: string; fullName: string; netCents: string }
interface PayableList { payoutMinCents: string; currency: string; members: PayableMember[] }
interface PayoutItem { id: string; referralCode: string; fullName: string; totalCents: string; method: string; status: string; period: string; paidAt: string | null }
interface RunResult { paidCount: number; skippedCount: number; paid: { totalCents: string }[] }

export default function PayoutsPage() {
  const [payable, setPayable] = useState<PayableList | null>(null);
  const [history, setHistory] = useState<PayoutItem[] | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([api.get<PayableList>('/admin/payouts/payable'), api.get<{ items: PayoutItem[] }>('/admin/payouts?pageSize=50')]);
      setPayable(p); setHistory(h.items);
    } catch (e) { setError(String((e as ApiError).message)); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function runAll() {
    setBusy(true); setError('');
    try {
      const res = await api.post<RunResult>('/admin/payouts/run', { method: 'csv' });
      showToast(`${res.paidCount} payouts processed, ${res.skippedCount} skipped`);
      setConfirmRun(false);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function downloadCsv() {
    try {
      const csv = await getCsv('/admin/payouts/export.csv');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = 'payouts.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(String((e as ApiError).message)); }
  }

  const c = payable?.currency ?? 'USD';
  const totalPayable = payable?.members.reduce((a, m) => a + Number(m.netCents), 0) ?? 0;

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.payouts')}</div>
      <h1 className="h1 fade-in">Payout Management</h1>
      <p className="sub fade-in">Pay members above the threshold with one click and download the bank CSV.</p>
      {error && <div className="error">{error}</div>}

      <div className="card hero fade-in delay-1" style={{ marginBottom: 16 }}>
        <div className="spread">
          <div>
            <div className="faint" style={{ fontSize: 12 }}>Total payable ({payable?.members.length ?? 0} members)</div>
            <div className="bignum gradient-text" style={{ marginTop: 6 }}><MoneyCounter cents={totalPayable} currency={c} /></div>
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Min threshold: {payable ? money(payable.payoutMinCents, c) : '—'}</div>
          </div>
          <div className="row">
            <button className="btn success" onClick={() => setConfirmRun(true)} disabled={busy || !payable?.members.length}>{t('payouts.run')}</button>
            <button className="btn ghost" onClick={downloadCsv}>⇩ {t('payouts.export')}</button>
          </div>
        </div>
      </div>

      <div className="card fade-in delay-2" style={{ marginBottom: 16 }}>
        <strong style={{ display: 'block', marginBottom: 12 }}>{t('payouts.payable')}</strong>
        {!payable ? <Loading rows={2} /> : (
          <table>
            <thead><tr><th>Member</th><th>Code</th><th style={{ textAlign: 'right' }}>Net payable</th></tr></thead>
            <tbody>
              {payable.members.map((m) => (
                <tr key={m.membershipId}>
                  <td>{m.fullName}</td>
                  <td className="faint">{m.referralCode}</td>
                  <td className="tnum" style={{ textAlign: 'right', fontWeight: 650 }}>{money(m.netCents, c)}</td>
                </tr>
              ))}
              {payable.members.length === 0 && <tr><td colSpan={3} className="muted">No members above the threshold.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      <div className="card fade-in delay-3">
        <strong style={{ display: 'block', marginBottom: 12 }}>{t('payouts.history')}</strong>
        {!history ? <Loading rows={2} /> : (
          <table>
            <thead><tr><th>Member</th><th>Amount</th><th>Method</th><th>Status</th><th>Period</th><th>Date</th></tr></thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id}>
                  <td>{p.fullName}<div className="faint" style={{ fontSize: 12 }}>{p.referralCode}</div></td>
                  <td className="tnum">{money(p.totalCents, c)}</td>
                  <td className="faint">{p.method}</td>
                  <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                  <td>{p.period}</td>
                  <td className="muted">{dateShort(p.paidAt)}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={6} className="muted">No payouts yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {confirmRun && (
        <Confirm
          title="Run payouts"
          message={`A total of ${money(totalPayable, c)} will be paid to ${payable?.members.length ?? 0} members above the threshold. This action marks the ledger as 'paid' and cannot be undone.`}
          confirmLabel={t('payouts.run')}
          busy={busy}
          onConfirm={runAll}
          onClose={() => setConfirmRun(false)}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
