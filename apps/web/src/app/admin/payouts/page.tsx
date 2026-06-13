'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { Confirm, Loading, Modal, MoneyCounter, Pagination, useToast } from '@/components/ui';
import { Drawer } from '@/components/Drawer';
import { PrintSheet, PrintHeader, PrintSignatures } from '@/components/PrintSheet';
import { activeMembership, getSession } from '@/lib/auth';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface PayableMember { membershipId: string; referralCode: string; fullName: string; netCents: string }
interface PayableList { payoutMinCents: string; currency: string; members: PayableMember[] }
interface PayoutItem { id: string; membershipId: string; referralCode: string; fullName: string; totalCents: string; method: string; status: string; period: string; paidAt: string | null; ref: string | null }
interface PayoutListResp { total: number; page: number; pageSize: number; items: PayoutItem[] }
interface RunResult { paidCount: number; skippedCount: number; paid: { totalCents: string }[] }
interface KycProfile {
  membershipId: string; fullName: string; referralCode: string; email: string;
  legalName: string; taxIdType: string; taxIdLast4: string; bankName: string | null;
  routingNumber: string; accountType: string; accountLast4: string; lastChangedAt: string;
}

const HISTORY_STATUS = ['', 'requested', 'processing', 'paid', 'failed'] as const;

export default function PayoutsPage() {
  const [payable, setPayable] = useState<PayableList | null>(null);
  const [requests, setRequests] = useState<PayoutItem[] | null>(null);
  const [kyc, setKyc] = useState<KycProfile[]>([]);
  const [history, setHistory] = useState<PayoutListResp | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmRun, setConfirmRun] = useState<'all' | 'selected' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decide, setDecide] = useState<{ p: PayoutItem; action: 'approve' | 'reject' } | null>(null);
  const [decideRef, setDecideRef] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  // history filtreleri
  const [hStatus, setHStatus] = useState('');
  const [hPeriod, setHPeriod] = useState('');
  const [hPage, setHPage] = useState(1);

  const historyQuery = useMemo(() => {
    const p = new URLSearchParams({ page: String(hPage), pageSize: '25' });
    if (hStatus) p.set('status', hStatus);
    if (hPeriod) p.set('period', hPeriod);
    return p.toString();
  }, [hStatus, hPeriod, hPage]);

  const loadCore = useCallback(async () => {
    try {
      const [p, r, k] = await Promise.all([
        api.get<PayableList>('/admin/payouts/payable'),
        api.get<PayoutListResp>('/admin/payouts?status=requested&pageSize=100'),
        api.get<KycProfile[]>('/admin/payout-profiles?status=pending_review'),
      ]);
      setPayable(p); setRequests(r.items); setKyc(k); setSelected(new Set());
    } catch (e) { setError(String((e as ApiError).message)); }
  }, []);

  async function decideKyc(membershipId: string, action: 'verify' | 'reject') {
    let reason: string | undefined;
    if (action === 'reject') {
      reason = window.prompt('Reason for rejection (optional):') ?? undefined;
    }
    try {
      await api.post(`/admin/payout-profiles/${membershipId}/decide`, { action, ...(reason ? { reason } : {}) });
      showToast(action === 'verify' ? 'Payout profile verified ✓' : 'Payout profile rejected');
      await loadCore();
    } catch (e) { setError(String((e as ApiError).message)); }
  }

  const loadHistory = useCallback(async () => {
    try { setHistory(await api.get<PayoutListResp>(`/admin/payouts?${historyQuery}`)); }
    catch (e) { setError(String((e as ApiError).message)); }
  }, [historyQuery]);

  useEffect(() => { void loadCore(); }, [loadCore]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function refreshAll() { await Promise.all([loadCore(), loadHistory()]); }

  async function run(which: 'all' | 'selected') {
    setBusy(true); setError('');
    try {
      const body = which === 'selected' ? { method: 'csv', membershipIds: [...selected] } : { method: 'csv' };
      const res = await api.post<RunResult>('/admin/payouts/run', body);
      showToast(`${res.paidCount} payouts processed, ${res.skippedCount} skipped`);
      setConfirmRun(null);
      await refreshAll();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function submitDecide() {
    if (!decide) return;
    setBusy(true);
    try {
      await api.post(`/admin/payouts/${decide.p.id}/decide`, { action: decide.action, ...(decideRef.trim() ? { ref: decideRef.trim() } : {}) });
      showToast(decide.action === 'approve' ? 'Request approved — marked paid ✓' : 'Request rejected, balance returned');
      setDecide(null); setDecideRef('');
      await refreshAll();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function downloadExport() {
    try { await downloadCsv('/admin/payouts/export.csv', 'payouts.csv'); }
    catch (e) { setError(String((e as ApiError).message)); }
  }

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    if (!payable) return;
    setSelected((prev) => prev.size === payable.members.length ? new Set() : new Set(payable.members.map((m) => m.membershipId)));
  }

  const c = payable?.currency ?? 'USD';
  const totalPayable = payable?.members.reduce((a, m) => a + Number(m.netCents), 0) ?? 0;
  const selTotal = payable?.members.filter((m) => selected.has(m.membershipId)).reduce((a, m) => a + Number(m.netCents), 0) ?? 0;

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.payouts')}</div>
      <h1 className="h1 fade-in">Payout Management</h1>
      <p className="sub fade-in">Approve member requests, pay members above the threshold, and download the bank CSV.</p>
      {error && <div className="error">{error}</div>}

      <div className="card hero fade-in delay-1" style={{ marginBottom: 16 }}>
        <div className="spread">
          <div>
            <div className="faint" style={{ fontSize: 12 }}>Total payable ({payable?.members.length ?? 0} members)</div>
            <div className="bignum gradient-text" style={{ marginTop: 6 }}><MoneyCounter cents={totalPayable} currency={c} /></div>
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Min threshold: {payable ? money(payable.payoutMinCents, c) : '—'}</div>
          </div>
          <div className="row no-print">
            <button className="btn success" onClick={() => setConfirmRun('all')} disabled={busy || !payable?.members.length}>{t('payouts.run')}</button>
            <button className="btn ghost" onClick={downloadExport}>⇩ {t('payouts.export')}</button>
          </div>
        </div>
      </div>

      {/* ---- talep kuyrugu ---- */}
      {requests && requests.length > 0 && (
        <div className="card fade-in delay-1" style={{ marginBottom: 16, borderColor: 'var(--amber)' }}>
          <div className="spread" style={{ marginBottom: 12 }}>
            <strong>Payout requests <span className="badge requested" style={{ marginLeft: 6 }}>{requests.length}</span></strong>
          </div>
          <table>
            <thead><tr><th>Member</th><th>Period</th><th style={{ textAlign: 'right' }}>Requested</th><th className="no-print" style={{ textAlign: 'right' }}>Decision</th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailId(r.id)}>
                  <td>{r.fullName}<div className="faint" style={{ fontSize: 12 }}>{r.referralCode}</div></td>
                  <td>{r.period}</td>
                  <td className="tnum" style={{ textAlign: 'right', fontWeight: 650 }}>{money(r.totalCents, c)}</td>
                  <td className="no-print" style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn success sm" onClick={() => { setDecideRef(''); setDecide({ p: r, action: 'approve' }); }}>Approve</button>
                      <button className="btn danger sm" onClick={() => { setDecideRef(''); setDecide({ p: r, action: 'reject' }); }}>Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- KYC inceleme kuyrugu ---- */}
      {kyc.length > 0 && (
        <div className="card fade-in delay-1" style={{ marginBottom: 16, borderColor: 'var(--sky)' }}>
          <div className="spread" style={{ marginBottom: 12 }}>
            <strong>Payout profiles to review <span className="badge payable" style={{ marginLeft: 6 }}>{kyc.length}</span></strong>
          </div>
          <table>
            <thead><tr><th>Member</th><th>Legal name</th><th>Tax ID</th><th>Bank</th><th className="no-print" style={{ textAlign: 'right' }}>Decision</th></tr></thead>
            <tbody>
              {kyc.map((k) => (
                <tr key={k.membershipId}>
                  <td>{k.fullName}<div className="faint" style={{ fontSize: 12 }}>{k.referralCode}</div></td>
                  <td>{k.legalName}</td>
                  <td className="tnum">{k.taxIdType.toUpperCase()} ••••{k.taxIdLast4}</td>
                  <td className="faint" style={{ fontSize: 12 }}>{k.bankName ? `${k.bankName} · ` : ''}{k.accountType} ••••{k.accountLast4} · {k.routingNumber}</td>
                  <td className="no-print" style={{ textAlign: 'right' }}>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn success sm" onClick={() => decideKyc(k.membershipId, 'verify')}>Verify</button>
                      <button className="btn danger sm" onClick={() => decideKyc(k.membershipId, 'reject')}>Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- odenebilir uyeler (secimli odeme) ---- */}
      <div className="card fade-in delay-2" style={{ marginBottom: 16 }}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong>{t('payouts.payable')}</strong>
          {selected.size > 0 && <button className="btn sm no-print" disabled={busy} onClick={() => setConfirmRun('selected')}>Pay selected ({selected.size}) · {money(selTotal, c)}</button>}
        </div>
        {!payable ? <Loading rows={2} /> : (
          <table>
            <thead><tr>
              <th className="no-print" style={{ width: 30 }}><input type="checkbox" checked={selected.size > 0 && selected.size === payable.members.length} onChange={toggleAll} aria-label="Select all" /></th>
              <th>Member</th><th>Code</th><th style={{ textAlign: 'right' }}>Net payable</th>
            </tr></thead>
            <tbody>
              {payable.members.map((m) => (
                <tr key={m.membershipId} style={{ background: selected.has(m.membershipId) ? 'var(--panel-2)' : undefined }}>
                  <td className="no-print"><input type="checkbox" checked={selected.has(m.membershipId)} onChange={() => toggle(m.membershipId)} aria-label={`Select ${m.fullName}`} /></td>
                  <td>{m.fullName}</td>
                  <td className="faint">{m.referralCode}</td>
                  <td className="tnum" style={{ textAlign: 'right', fontWeight: 650 }}>{money(m.netCents, c)}</td>
                </tr>
              ))}
              {payable.members.length === 0 && <tr><td colSpan={4} className="muted">No members above the threshold.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- gecmis (filtreli + sayfali) ---- */}
      <div className="card fade-in delay-3">
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong>{t('payouts.history')}{history ? ` · ${history.total}` : ''}</strong>
          <div className="row no-print" style={{ gap: 8 }}>
            <input type="month" value={hPeriod} onChange={(e) => { setHPeriod(e.target.value); setHPage(1); }} aria-label="Period" style={{ width: 'auto' }} />
            <select value={hStatus} onChange={(e) => { setHStatus(e.target.value); setHPage(1); }} style={{ width: 'auto' }} aria-label="Status">
              {HISTORY_STATUS.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
            </select>
          </div>
        </div>
        {!history ? <Loading rows={2} /> : (
          <table>
            <thead><tr><th>Member</th><th>Amount</th><th>Method</th><th>Status</th><th>Period</th><th>Date</th></tr></thead>
            <tbody>
              {history.items.map((p) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setDetailId(p.id)}>
                  <td>{p.fullName}<div className="faint" style={{ fontSize: 12 }}>{p.referralCode}</div></td>
                  <td className="tnum">{money(p.totalCents, c)}</td>
                  <td className="faint">{p.method}</td>
                  <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                  <td>{p.period}</td>
                  <td className="muted">{dateShort(p.paidAt)}</td>
                </tr>
              ))}
              {history.items.length === 0 && <tr><td colSpan={6} className="muted">No payouts match these filters.</td></tr>}
            </tbody>
          </table>
        )}
        {history && <Pagination page={history.page} pageSize={history.pageSize} total={history.total} onPage={setHPage} />}
      </div>

      {confirmRun && (
        <Confirm
          title={confirmRun === 'all' ? 'Run payouts' : `Pay ${selected.size} selected`}
          message={confirmRun === 'all'
            ? `A total of ${money(totalPayable, c)} will be paid to ${payable?.members.length ?? 0} members above the threshold. This marks the ledger as 'paid' and cannot be undone.`
            : `${money(selTotal, c)} will be paid to ${selected.size} selected members. This marks the ledger as 'paid' and cannot be undone.`}
          confirmLabel={t('payouts.run')}
          busy={busy}
          onConfirm={() => run(confirmRun)}
          onClose={() => setConfirmRun(null)}
        />
      )}

      {decide && (
        <Modal title={decide.action === 'approve' ? 'Approve request' : 'Reject request'} onClose={() => setDecide(null)}>
          <div style={{ width: 'min(440px, 88vw)' }}>
            <p className="muted" style={{ marginTop: 0 }}>
              {decide.action === 'approve'
                ? `Approve ${decide.p.fullName}'s request for ${money(decide.p.totalCents, c)}? Linked balance is marked paid.`
                : `Reject ${decide.p.fullName}'s request? Their payable balance is returned and the request is closed.`}
            </p>
            <div className="field">
              <label>{decide.action === 'approve' ? 'Bank / transfer reference (optional)' : 'Reason (optional)'}</label>
              <input value={decideRef} onChange={(e) => setDecideRef(e.target.value)} placeholder={decide.action === 'approve' ? 'e.g. ACH-20260613-001' : 'e.g. invalid bank details'} autoFocus />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setDecide(null)} disabled={busy}>Cancel</button>
              <button className={`btn ${decide.action === 'reject' ? 'danger' : 'success'}`} onClick={submitDecide} disabled={busy}>
                {busy ? '…' : decide.action === 'approve' ? 'Approve & mark paid' : 'Reject'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detailId && <PayoutDrawer id={detailId} currency={c} onClose={() => setDetailId(null)} onChanged={refreshAll} onToast={showToast} />}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* --------------------------------------------------- payout dekont cekmecesi */
interface PayoutLine { id: string; saleId: string; level: number; type: string; amountCents: string; createdAt: string }
interface PayoutDetail {
  id: string; membershipId: string;
  member: { fullName: string; referralCode: string; email: string };
  totalCents: string; method: string; status: string; period: string;
  paidAt: string | null; ref: string | null; createdAt: string;
  lines: PayoutLine[];
}

function PayoutDrawer({ id, currency, onClose, onChanged, onToast }: { id: string; currency: string; onClose: () => void; onChanged: () => void; onToast: (m: string) => void }) {
  const [d, setD] = useState<PayoutDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const tenantName = (() => { const s = getSession(); return (s ? activeMembership(s)?.tenantName : null) ?? 'Refearn'; })();

  const load = useCallback(() => {
    api.get<PayoutDetail>(`/admin/payouts/${id}`).then(setD).catch((e) => setErr(String((e as ApiError).message)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function retry() {
    setBusy(true);
    try { await api.post(`/admin/payouts/${id}/retry`); onToast('Retried — marked paid ✓'); setConfirmRetry(false); load(); onChanged(); }
    catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <Drawer
      title={d ? money(d.totalCents, currency) : 'Payout'}
      subtitle={d ? `${d.member.fullName} · ${d.period}` : undefined}
      onClose={onClose}
      width={520}
      footer={d && (
        <>
          <button className="btn ghost" onClick={() => setPrinting(true)}>🖶 Print slip</button>
          {d.status === 'failed' && <button className="btn" disabled={busy} onClick={() => setConfirmRetry(true)}>Retry</button>}
        </>
      )}
    >
      {err && <div className="error">{err}</div>}
      {!d ? <Loading rows={4} /> : (
        <div className="grid" style={{ gap: 16 }}>
          <div><span className={`badge ${d.status}`}>{d.status}</span></div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Member" value={`${d.member.fullName} · ${d.member.referralCode}`} />
            <Field label="Email" value={d.member.email} />
            <Field label="Method" value={d.method} />
            <Field label="Reference" value={d.ref ?? '—'} />
            <Field label="Period" value={d.period} />
            <Field label="Paid at" value={d.paidAt ? dateShort(d.paidAt) : '—'} />
          </div>
          <div>
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>Included commission lines ({d.lines.length})</strong>
            {d.lines.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>No linked ledger lines (balance was returned).</div> : (
              <table>
                <thead><tr><th>Lvl</th><th>Type</th><th>Date</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {d.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="tnum">{l.level}</td>
                      <td className="faint">{l.type}</td>
                      <td className="muted">{dateShort(l.createdAt)}</td>
                      <td className="tnum" style={{ textAlign: 'right', color: l.type === 'reversal' ? 'var(--rose)' : undefined }}>{money(l.amountCents, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {confirmRetry && d && (
        <Confirm title="Retry payout" message={`Re-run the failed payout of ${money(d.totalCents, currency)} to ${d.member.fullName}? Linked balance is marked paid.`} confirmLabel="Retry" busy={busy} onConfirm={retry} onClose={() => setConfirmRetry(false)} />
      )}

      {printing && d && (
        <PrintSheet onDone={() => setPrinting(false)}>
          <PrintHeader tenantName={tenantName} title="Payout Slip" subtitle={`Ref: ${d.ref ?? d.id}`} />
          <table style={{ marginBottom: 18 }}>
            <tbody>
              <tr><td style={{ fontWeight: 700, width: 160 }}>Member</td><td>{d.member.fullName} ({d.member.referralCode})</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Email</td><td>{d.member.email}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Period</td><td>{d.period}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Method</td><td>{d.method}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Status</td><td>{d.status}{d.paidAt ? ` · ${dateShort(d.paidAt)}` : ''}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Amount paid</td><td style={{ fontWeight: 800, fontSize: 16 }}>{money(d.totalCents, currency)}</td></tr>
            </tbody>
          </table>
          {d.lines.length > 0 && (
            <>
              <div style={{ fontWeight: 700, margin: '8px 0' }}>Included commission lines</div>
              <table>
                <thead><tr><th>Lvl</th><th>Type</th><th>Date</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {d.lines.map((l) => (
                    <tr key={l.id}><td>{l.level}</td><td>{l.type}</td><td>{dateShort(l.createdAt)}</td><td style={{ textAlign: 'right' }}>{money(l.amountCents, currency)}</td></tr>
                  ))}
                  <tr><td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 800 }}>{money(d.totalCents, currency)}</td></tr>
                </tbody>
              </table>
            </>
          )}
          <PrintSignatures left="Issued by" right="Received by" />
        </PrintSheet>
      )}
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 13.5, marginTop: 2, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}
