'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Loading, Modal, useToast } from '@/components/ui';
import { statusBadge } from '@/lib/format';
import { t } from '@/lib/i18n';

interface FraudFlag {
  membershipId: string; fullName: string; email: string; referralCode: string;
  score: number; reasons: string[]; status: string; note: string | null; blocked: boolean; createdAt: string;
}

const FILTERS = ['', 'open', 'confirmed', 'cleared'] as const;

export default function FraudPage() {
  const [rows, setRows] = useState<FraudFlag[] | null>(null);
  const [filter, setFilter] = useState<string>('open');
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decide, setDecide] = useState<{ f: FraudFlag; action: 'clear' | 'confirm' } | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const q = filter ? `?status=${filter}` : '';
      setRows(await api.get<FraudFlag[]>(`/admin/fraud${q}`));
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  async function scan() {
    setScanning(true); setError('');
    try {
      const r = await api.post<{ flagged: number; blocked: number }>('/admin/fraud/scan');
      showToast(`Scan done — ${r.flagged} flagged, ${r.blocked} blocked`);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setScanning(false); }
  }

  async function submitDecide() {
    if (!decide) return;
    setBusyId(decide.f.membershipId); setError('');
    try {
      await api.post(`/admin/fraud/${decide.f.membershipId}/decide`, {
        action: decide.action,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      showToast(decide.action === 'clear' ? 'Cleared ✓' : 'Confirmed');
      setDecide(null); setNote('');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.fraud')}</div>
      <h1 className="h1 fade-in">Fraud Triage</h1>
      <p className="sub fade-in">Review risk-flagged members. Cleared members can be paid; confirmed members stay held.</p>
      {error && <div className="error">{error}</div>}

      <div className="card fade-in delay-1" style={{ marginBottom: 16 }}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="faint" style={{ fontSize: 12 }}>Status</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Status filter">
              {FILTERS.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}
            </select>
          </div>
          <button className="btn ghost" onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : '⚠ Scan now'}</button>
        </div>

        {!rows ? <Loading rows={3} /> : rows.length === 0 ? (
          <div className="muted" style={{ textAlign: 'center', padding: '28px 0' }}>
            No members flagged.<br />
            <span className="faint" style={{ fontSize: 12.5 }}>Run a scan to re-evaluate risk signals.</span>
          </div>
        ) : (
          <table>
            <thead><tr><th>Member</th><th>Score</th><th>Signals</th><th>Status</th><th className="no-print" style={{ textAlign: 'right' }}>Decision</th></tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.membershipId}>
                  <td>
                    <Link href={`/admin/members#${f.membershipId}`} style={{ color: 'var(--text)', fontWeight: 600 }}>{f.fullName}</Link>
                    <div className="faint" style={{ fontSize: 12 }}>{f.referralCode} · {f.email}</div>
                  </td>
                  <td><span className={statusBadge(f.blocked ? 'failed' : 'pending')}>{f.score}{f.blocked ? ' · blocked' : ''}</span></td>
                  <td className="faint" style={{ fontSize: 12 }}>{f.reasons.join(', ')}</td>
                  <td><span className={statusBadge(f.status)}>{f.status}</span>{f.note ? <div className="faint" style={{ fontSize: 11 }}>“{f.note}”</div> : null}</td>
                  <td className="no-print" style={{ textAlign: 'right' }}>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn success sm" disabled={busyId === f.membershipId} onClick={() => { setNote(''); setDecide({ f, action: 'clear' }); }}>Clear</button>
                      <button className="btn danger sm" disabled={busyId === f.membershipId} onClick={() => { setNote(''); setDecide({ f, action: 'confirm' }); }}>Confirm</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {decide && (
        <Modal title={decide.action === 'clear' ? 'Clear flag' : 'Confirm fraud'} onClose={() => setDecide(null)}>
          <div style={{ width: 'min(440px, 92vw)' }}>
            <p className="muted" style={{ marginTop: 0 }}>
              {decide.action === 'clear'
                ? `Clear ${decide.f.fullName}? They become payable again.`
                : `Confirm ${decide.f.fullName} as fraud? Their payouts stay held.`}
            </p>
            <div className="field">
              <label>Note (optional)</label>
              <textarea aria-label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoFocus />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button className="btn ghost" onClick={() => setDecide(null)} disabled={busyId === decide.f.membershipId}>Cancel</button>
              <button className={`btn ${decide.action === 'confirm' ? 'danger' : 'success'}`} onClick={submitDecide} disabled={busyId === decide.f.membershipId}>
                {busyId === decide.f.membershipId ? '…' : decide.action === 'clear' ? 'Clear' : 'Confirm fraud'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
