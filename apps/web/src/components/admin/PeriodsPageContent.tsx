'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, Modal, StatCard, useToast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

export function PeriodsPageContent({ tenantName }: { tenantName: string }) {
  void tenantName;
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
      setRows(r.rows); setError(''); // basarida onceki hatayi temizle (kurtarma)
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
      showToast(res.warning ? `Locked — warning: ${res.warning}` : `${lockTarget} locked`);
      setLockTarget(null); setNote('');
      await load();
    } catch (e) { showToast(`Lock failed: ${(e as ApiError).message}`); } finally { setBusy(false); }
  }

  async function doUnlock() {
    if (!unlockTarget) return;
    setBusy(true);
    try {
      await api.post(`/admin/periods/${unlockTarget}/unlock`, {});
      showToast(`${unlockTarget} unlocked`);
      setUnlockTarget(null);
      await load();
    } catch (e) { showToast(`Unlock failed: ${(e as ApiError).message}`); } finally { setBusy(false); }
  }

  // Full-page error only on the initial load failure (with a retry); otherwise an inline banner.
  if (error && !rows) return <div className="error" style={{ margin: 24 }}>{error} <Button variant="ghost" size="sm" onClick={() => void load()} style={{ marginLeft: 8 }}>Retry</Button></div>;
  if (!rows) return <Loading />;

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">Accounting</div>
          <h1 className="h1 fade-in">Period close</h1>
          <p className="sub fade-in">Locking a month closes the books — no new commission, reversals or payouts can touch that period. Unlocking is recorded in the audit log.</p>
        </div>
        <Button variant="ghost" className="no-print" onClick={() => window.print()}>🖶 Print</Button>
      </div>

      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

      <div className="stat-grid" style={{ marginTop: 16 }}>
        <StatCard label="Locked periods" value={String(stats.lockedCount)} icon="▥" />
        <StatCard label="Payable in open periods" value={money(stats.openPayable.toString())} icon="◆" />
        <StatCard label="Pending in open periods" value={money(stats.openPending.toString())} icon="◷" />
      </div>

      {rows.length === 0 ? (
        <Card style={{ marginTop: 16 }}><span className="muted">No period data yet — periods appear here as approved sales come in.</span></Card>
      ) : (
        <Card style={{ marginTop: 16, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Pending</th>
                <th style={{ textAlign: 'right' }}>Payable</th>
                <th style={{ textAlign: 'right' }}>Paid</th>
                <th>Status</th>
                <th className="no-print">Action</th>
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
                      ? <Badge variant="success" title={r.lockedBy ? `Locked by: ${r.lockedBy}` : undefined}>🔒 Locked</Badge>
                      : <Badge variant="secondary">Open</Badge>}
                  </td>
                  <td className="no-print">
                    {r.locked
                      ? <Button variant="ghost" size="sm" onClick={() => setUnlockTarget(r.period)}>Unlock</Button>
                      : <Button size="sm" onClick={() => { setLockTarget(r.period); setNote(''); }}>Lock</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {lockTarget && (
        <Modal title={`Lock period ${lockTarget}`} onClose={() => setLockTarget(null)}>
          <p className="muted" style={{ marginTop: 0 }}>This month will be closed. After closing, no commission / reversal / payout can be written to this period.</p>
          <div className="field">
            <Label htmlFor="lock-note" className="mb-1.5 block">Note (optional)</Label>
            <Textarea id="lock-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="e.g. June close — bank reconciliation done" />
          </div>
          <div className="row spread" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={() => setLockTarget(null)} disabled={busy}>Cancel</Button>
            <Button onClick={doLock} disabled={busy}>{busy ? 'Locking…' : '🔒 Lock'}</Button>
          </div>
        </Modal>
      )}

      {unlockTarget && (
        <Confirm
          title={`Unlock period ${unlockTarget}`}
          message="You are reopening a closed book. This is recorded in the audit log and re-opens the period for writes."
          confirmLabel="Unlock"
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
