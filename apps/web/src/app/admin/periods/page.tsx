'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, Modal, StatCard, useToast } from '@/components/ui';
import { useLiveRefresh } from '@/components/LiveIndicator';
import { money } from '@/lib/format';

interface PeriodRow {
  period: string;
  locked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  note: string | null;
  revenueCents: string;
  pendingCents: string;
  payableCents: string;
  paidCents: string;
}

export default function PeriodsPage() {
  const [rows, setRows] = useState<PeriodRow[] | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  const [lockTarget, setLockTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [unlockTarget, setUnlockTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ rows: PeriodRow[] }>('/admin/periods');
      setRows(r.rows);
    } catch (e) { setError(String((e as ApiError).message)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(() => void load());

  const stats = useMemo(() => {
    const list = rows ?? [];
    const lockedCount = list.filter((r) => r.locked).length;
    const openPayable = list.filter((r) => !r.locked).reduce((a, r) => a + BigInt(r.payableCents), 0n);
    const openPending = list.filter((r) => !r.locked).reduce((a, r) => a + BigInt(r.pendingCents), 0n);
    return { lockedCount, openPayable, openPending };
  }, [rows]);

  async function doLock() {
    if (!lockTarget) return;
    setBusy(true);
    try {
      const res = await api.post<{ warning?: string }>(`/admin/periods/${lockTarget}/lock`, { note: note || undefined });
      showToast(res.warning ? `Kilitlendi — uyarı: ${res.warning}` : `${lockTarget} kilitlendi`);
      setLockTarget(null); setNote('');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function doUnlock() {
    if (!unlockTarget) return;
    setBusy(true);
    try {
      await api.post(`/admin/periods/${unlockTarget}/unlock`, {});
      showToast(`${unlockTarget} kilidi açıldı`);
      setUnlockTarget(null);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error) return <div className="error">{error}</div>;
  if (!rows) return <Loading />;

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">Muhasebe</div>
          <h1 className="h1 fade-in">Dönem kapanışı</h1>
          <p className="sub fade-in">Bir ayı kilitleyince o döneme yeni komisyon yazılamaz, ters kayıt atılamaz ve ödeme yapılamaz — defter kapanır. Kilidi açmak audit&apos;e işlenir.</p>
        </div>
        <button className="btn ghost no-print" onClick={() => window.print()}>🖶 Yazdır</button>
      </div>

      <div className="stat-grid" style={{ marginTop: 16 }}>
        <StatCard label="Kilitli dönem" value={String(stats.lockedCount)} icon="▥" />
        <StatCard label="Açık dönemlerde ödenebilir" value={money(stats.openPayable.toString())} icon="◆" />
        <StatCard label="Açık dönemlerde bekleyen" value={money(stats.openPending.toString())} icon="◷" />
      </div>

      {rows.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}><span className="muted">Henüz dönem verisi yok — onaylanmış satış geldikçe burada listelenir.</span></div>
      ) : (
        <div className="card" style={{ marginTop: 16, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Dönem</th>
                <th style={{ textAlign: 'right' }}>Ciro</th>
                <th style={{ textAlign: 'right' }}>Bekleyen</th>
                <th style={{ textAlign: 'right' }}>Ödenebilir</th>
                <th style={{ textAlign: 'right' }}>Ödenen</th>
                <th>Durum</th>
                <th className="no-print">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.period}>
                  <td><strong>{r.period}</strong>{r.note ? <div className="faint" style={{ fontSize: 11 }}>{r.note}</div> : null}</td>
                  <td style={{ textAlign: 'right' }}>{money(r.revenueCents)}</td>
                  <td style={{ textAlign: 'right' }}>{money(r.pendingCents)}</td>
                  <td style={{ textAlign: 'right' }}>{money(r.payableCents)}</td>
                  <td style={{ textAlign: 'right' }}>{money(r.paidCents)}</td>
                  <td>
                    {r.locked
                      ? <span className="badge paid" title={r.lockedBy ? `Kilitleyen: ${r.lockedBy}` : undefined}>🔒 Kilitli</span>
                      : <span className="badge draft">Açık</span>}
                  </td>
                  <td className="no-print">
                    {r.locked
                      ? <button className="btn ghost sm" onClick={() => setUnlockTarget(r.period)}>Kilidi aç</button>
                      : <button className="btn sm" onClick={() => { setLockTarget(r.period); setNote(''); }}>Kilitle</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lockTarget && (
        <Modal title={`${lockTarget} dönemini kilitle`} onClose={() => setLockTarget(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Bu ay kapatılacak. Kapandıktan sonra bu döneme komisyon/ters kayıt/ödeme yazılamaz.</p>
          <label className="field">
            <span>Not (opsiyonel)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="örn. Haziran kapanışı — banka mutabakatı tamam" />
          </label>
          <div className="row spread" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setLockTarget(null)} disabled={busy}>Vazgeç</button>
            <button className="btn" onClick={doLock} disabled={busy}>{busy ? 'Kilitleniyor…' : '🔒 Kilitle'}</button>
          </div>
        </Modal>
      )}

      {unlockTarget && (
        <Confirm
          title={`${unlockTarget} kilidini aç`}
          message="Kapanmış bir defteri yeniden açıyorsunuz. Bu işlem audit kaydına işlenir ve döneme tekrar yazım açılır."
          confirmLabel="Kilidi aç"
          danger
          busy={busy}
          onConfirm={doUnlock}
          onClose={() => setUnlockTarget(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
