'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { Confirm, Loading, Modal, MoneyCounter, Pagination, useToast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Drawer } from '@/components/Drawer';
import { PrintSheet, PrintHeader, PrintSignatures } from '@/components/PrintSheet';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface PayableMember { membershipId: string; referralCode: string; fullName: string; netCents: string; soldThisMonthCents: string }
interface PayableList { payoutMinCents: string; currency: string; members: PayableMember[] }
type PayoutAction = 'approve-request' | 'reject-request' | 'dispatch-batch' | 'settle-batch' | 'fail-batch';
type PayoutScope =
  | { mode: 'selected'; membershipIds: string[] }
  | { mode: 'all_eligible'; filters: { period?: string; method: 'manual' | 'csv' } };
interface PayoutPresentation {
  actionCandidates?: { authority: 'active-tenant' | 'unavailable'; mutations: PayoutAction[] };
}
interface PayoutItem {
  id: string; batchId: string | null; batchStatus?: 'processing' | 'dispatched' | 'settled' | 'failed' | null; membershipId: string; referralCode: string; fullName: string;
  totalCents: string; method: string; status: string; period: string; paidAt: string | null;
  ref: string | null; clearedAt?: string | null; bankRef?: string | null; presentation?: PayoutPresentation;
}
interface PayoutListResp { total: number; page: number; pageSize: number; items: PayoutItem[] }
interface PayoutBatchPreview {
  previewToken: string; expiresAt: string; eligibleCount: number; excludedCount: number;
  totals: Array<{ currency: string; amountCents: string }>; normalizedScope: PayoutScope;
}
interface PayoutBatchStart {
  id: string | null; status: 'processing' | null; processingCount: number; skippedCount: number;
}
interface ReadinessTarget { membershipId: string; fullName: string }
type ReadinessKey = 'address' | 'kyc' | 'fraud' | 'sanctions' | 'payment_method';
interface ReadinessControl {
  key: ReadinessKey; status: 'pending' | 'ready' | 'blocked'; reasonCode: string;
  reviewedAt: string | null; expiresAt: string | null; version: number;
}
interface PayoutDestination {
  id: string; maskedLabel: string; last4: string | null; country: string; currency: string;
  verifiedAt: string | null; version: number;
}
interface PayoutReadiness {
  membershipId: string; controls: ReadinessControl[]; activeDestination: PayoutDestination | null;
}
interface KycProfile {
  membershipId: string; fullName: string; referralCode: string; email: string;
  legalName: string; taxIdType: string; taxIdLast4: string; bankName: string | null;
  routingNumber: string; accountType: string; accountLast4: string; lastChangedAt: string; sanctionsHit: boolean;
}
interface FraudFlag {
  membershipId: string; fullName: string; referralCode: string; email: string;
  score: number; reasons: string[]; status: string; note: string | null; blocked: boolean;
}

export interface PayoutCapabilities {
  payoutsView: boolean;
  payoutsProcess: boolean;
  payoutsExport: boolean;
  complianceView: boolean;
  complianceReview: boolean;
  reportsView: boolean;
  reportsExport: boolean;
}

const HISTORY_STATUS = ['', 'requested', 'processing', 'paid', 'failed'] as const;

// payout/odeme durumu → Badge variant (globals.css .badge.{status} paletiyle birebir)
type BadgeVariant = 'default' | 'secondary' | 'success' | 'destructive' | 'pending' | 'payable';
const payoutStatusVariant = (s: string): BadgeVariant =>
  s === 'paid' || s === 'approved' || s === 'active' || s === 'used' ? 'success'
  : s === 'failed' || s === 'void' || s === 'revoked' ? 'destructive'
  : s === 'payable' ? 'payable'
  : 'pending'; // requested, processing, pending → amber

export function PayoutsPageContent({ tenantName, capabilities }: { tenantName: string; capabilities: PayoutCapabilities }) {
  const [payable, setPayable] = useState<PayableList | null>(null);
  const [requests, setRequests] = useState<PayoutItem[] | null>(null);
  const [kyc, setKyc] = useState<KycProfile[]>([]);
  const [fraud, setFraud] = useState<FraudFlag[]>([]);
  const [clawbacks, setClawbacks] = useState<{ totalOwedCents: string; members: { membershipId: string; name: string; referralCode: string; owedCents: string }[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [history, setHistory] = useState<PayoutListResp | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  // in-flight guard keyed by batch id / membershipId - double-click double-action onler
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchPreview, setBatchPreview] = useState<PayoutBatchPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decide, setDecide] = useState<{ p: PayoutItem; action: 'approve' | 'reject' } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [detailPayout, setDetailPayout] = useState<PayoutItem | null>(null);
  const [readinessTarget, setReadinessTarget] = useState<ReadinessTarget | null>(null);
  // generic reason modal (replaces window.prompt for fraud/KYC)
  const [reasonModal, setReasonModal] = useState<{ title: string; label: string; run: (text: string) => Promise<void> } | null>(null);
  const [reasonText, setReasonText] = useState('');
  // banka mutabakati
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileText, setReconcileText] = useState('');
  const [reconcileResult, setReconcileResult] = useState<{ clearedCount: number; unmatched: { amountCents: number; ref?: string }[]; remainingUncleared: number } | null>(null);
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
    if (!capabilities.payoutsView) {
      setPayable(null); setRequests(null); setClawbacks(null); setSelected(new Set());
      return;
    }
    try {
      const [p, r] = await Promise.all([
        api.get<PayableList>('/admin/payouts/payable'),
        api.get<PayoutListResp>('/admin/payouts?status=requested&pageSize=100'),
      ]);
      setPayable(p); setRequests(r.items); setSelected(new Set());
      if (capabilities.reportsView) {
        api.get<{ totalOwedCents: string; members: { membershipId: string; name: string; referralCode: string; owedCents: string }[] }>('/admin/clawbacks').then(setClawbacks).catch(() => {});
      } else {
        setClawbacks(null);
      }
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [capabilities.payoutsView, capabilities.reportsView]);

  const loadCompliance = useCallback(async () => {
    if (!capabilities.complianceView) {
      setKyc([]); setFraud([]);
      return;
    }
    try {
      const [k, f] = await Promise.all([
        api.get<KycProfile[]>('/admin/payout-profiles?status=pending_review'),
        api.get<FraudFlag[]>('/admin/fraud?status=open'),
      ]);
      setKyc(k); setFraud(f);
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [capabilities.complianceView]);

  // dolar tutarini float'siz cent'e cevir: $ / bosluk / binlik ayraci temizle,
  // ondaliktan once/sonrayi ayir, 2 haneye kadar kesirden tam sayi cent kur.
  // Bozuk girdi NaN doner ve asagidaki >0 filtresinde elenir. (1.005 -> 100, float yok)
  function dollarsToCents(amt: string): number {
    const s = amt.replace(/[$\s,]/g, '');
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return NaN; // gecersiz tutar
    const dot = s.indexOf('.');
    const whole = dot === -1 ? s : s.slice(0, dot);
    const frac = dot === -1 ? '' : s.slice(dot + 1);
    return parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  }

  async function runReconcile() {
    if (!capabilities.payoutsProcess) { setError('Payout processing permission is required.'); return; }
    // "tutar[,referans]" satirlari — tutar dolar; cent'e cevir
    const rows = reconcileText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const [amt, ...rest] = line.split(',');
      return { amountCents: dollarsToCents(amt), ref: rest.join(',').trim() || undefined };
    }).filter((r) => Number.isFinite(r.amountCents) && r.amountCents > 0);
    if (rows.length === 0) { setError('No valid rows (format: amount or amount,reference)'); return; }
    setBusy(true);
    try {
      const res = await api.post<{ clearedCount: number; unmatched: { amountCents: number; ref?: string }[]; remainingUncleared: number }>('/admin/payouts/reconcile', { rows });
      setReconcileResult(res);
      showToast(`${res.clearedCount} payouts cleared ✓`);
      await refreshAll();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function runFraudScan() {
    if (!capabilities.complianceReview) { setError('Compliance review permission is required.'); return; }
    setScanning(true);
    try { const r = await api.post<{ flagged: number; blocked: number }>('/admin/fraud/scan'); showToast(`Scan done — ${r.flagged} flagged, ${r.blocked} blocked`); await loadCompliance(); }
    catch (e) { setError(String((e as ApiError).message)); } finally { setScanning(false); }
  }
  async function decideFraud(membershipId: string, action: 'clear' | 'confirm') {
    if (!capabilities.complianceReview) { setError('Compliance review permission is required.'); return; }
    if (action === 'confirm') {
      setReasonText('');
      setReasonModal({ title: 'Confirm fraud', label: 'Note (optional)', run: async (note) => {
        await api.post(`/admin/fraud/${membershipId}/decide`, { action, ...(note.trim() ? { note: note.trim() } : {}) }); showToast('Confirmed'); await loadCompliance();
      } });
      return;
    }
    if (busyId) return;
    setBusyId(membershipId);
    try { await api.post(`/admin/fraud/${membershipId}/decide`, { action }); showToast('Cleared ✓'); await loadCompliance(); }
    catch (e) { setError(String((e as ApiError).message)); } finally { setBusyId(null); }
  }

  async function decideKyc(membershipId: string, action: 'verify' | 'reject') {
    if (!capabilities.complianceReview) { setError('Compliance review permission is required.'); return; }
    if (action === 'reject') {
      setReasonText('');
      setReasonModal({ title: 'Reject payout profile', label: 'Reason (optional)', run: async (reason) => {
        await api.post(`/admin/payout-profiles/${membershipId}/decide`, { action, ...(reason.trim() ? { reason: reason.trim() } : {}) }); showToast('Payout profile rejected'); await loadCompliance();
      } });
      return;
    }
    if (busyId) return;
    setBusyId(membershipId);
    try {
      await api.post(`/admin/payout-profiles/${membershipId}/decide`, { action });
      showToast(action === 'verify' ? 'Payout profile verified ✓' : 'Payout profile rejected');
      await loadCompliance();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusyId(null); }
  }

  const loadHistory = useCallback(async () => {
    if (!capabilities.payoutsView) { setHistory(null); return; }
    try { setHistory(await api.get<PayoutListResp>(`/admin/payouts?${historyQuery}`)); }
    catch (e) { setError(String((e as ApiError).message)); }
  }, [capabilities.payoutsView, historyQuery]);

  useEffect(() => { void loadCore(); }, [loadCore]);
  useEffect(() => { void loadCompliance(); }, [loadCompliance]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function refreshAll() { await Promise.all([loadCore(), loadCompliance(), loadHistory()]); }

  function canPayoutAction(payout: PayoutItem, action: PayoutAction): boolean {
    return capabilities.payoutsProcess
      && payout.presentation?.actionCandidates?.authority === 'active-tenant'
      && payout.presentation.actionCandidates.mutations.includes(action);
  }

  async function previewBatch(which: 'all' | 'selected') {
    if (!capabilities.payoutsProcess) { setError('Payout processing permission is required.'); return; }
    setBusy(true); setError('');
    try {
      const scope: PayoutScope = which === 'selected'
        ? { mode: 'selected', membershipIds: [...selected] }
        : { mode: 'all_eligible', filters: { method: 'csv' } };
      const preview = await api.post<PayoutBatchPreview>('/admin/payouts/batches/preview', { scope });
      setBatchPreview(preview);
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function startReviewedBatch() {
    if (!capabilities.payoutsProcess) { setError('Payout processing permission is required.'); return; }
    if (!batchPreview) return;
    setBusy(true); setError('');
    try {
      const result = await api.post<PayoutBatchStart>('/admin/payouts/batches', {
        scope: batchPreview.normalizedScope,
        previewToken: batchPreview.previewToken,
      });
      setBatchPreview(null);
      showToast(result.processingCount > 0
        ? `Processing batch created for ${result.processingCount} payout${result.processingCount === 1 ? '' : 's'}.`
        : `No payouts entered processing (${result.skippedCount} excluded).`);
      await refreshAll();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function submitDecide() {
    if (!capabilities.payoutsProcess) { setError('Payout processing permission is required.'); return; }
    if (!decide) return;
    if (!canPayoutAction(decide.p, decide.action === 'approve' ? 'approve-request' : 'reject-request')) {
      setError('This payout is no longer available for that action. Refresh the list and review its current status.');
      return;
    }
    const reason = decisionReason.trim();
    if (decide.action === 'reject' && !reason) {
      setError('A rejection reason is required.');
      return;
    }
    setBusy(true);
    try {
      if (decide.action === 'approve') {
        const scope: PayoutScope = { mode: 'selected', membershipIds: [decide.p.membershipId] };
        const preview = await api.post<PayoutBatchPreview>('/admin/payouts/batches/preview', { scope });
        setBatchPreview(preview);
        setDecide(null); setDecisionReason('');
        showToast('Review is ready. Confirm the reviewed batch before any balance is reserved.');
        return;
      } else {
        await api.post(`/admin/payouts/${decide.p.id}/reject`, { reason });
        showToast('Request rejected; no payment was created.');
      }
      setDecide(null); setDecisionReason('');
      await refreshAll();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function downloadExport() {
    if (!capabilities.payoutsExport) { setError('Payout export permission is required.'); return; }
    try { await downloadCsv('/admin/payouts/export.csv', 'payouts.csv'); }
    catch (e) { setError(String((e as ApiError).message)); }
  }

  async function downloadAch() {
    if (!capabilities.payoutsExport) { setError('Payout export permission is required.'); return; }
    try { await downloadCsv('/admin/payouts/ach.txt', 'payouts-ach.txt'); }
    catch (e) { setError(String((e as ApiError).message)); }
  }

  async function downloadTaxForm() {
    if (!capabilities.reportsExport) { setError('Report export permission is required.'); return; }
    const year = new Date().getFullYear();
    try { await downloadCsv(`/admin/tax/1099.csv?year=${year}`, `1099-nec-${year}.csv`); }
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
  const hasMoreActions = capabilities.payoutsProcess
    || capabilities.payoutsExport
    || capabilities.reportsExport
    || (capabilities.complianceView && capabilities.complianceReview);

  if (!capabilities.payoutsView) {
    return (
      <div>
        <div className="eyebrow fade-in">{t('nav.payouts')}</div>
        <h1 className="h1 fade-in">Payout Management</h1>
        <div className="card muted fade-in delay-1" role="status">Payout viewing permission is required.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.payouts')}</div>
      <h1 className="h1 fade-in">Payout Management</h1>
      <p className="sub fade-in">Review payout readiness, reserve approved payouts, record the payment hand-off, then settle only after transfer evidence is recorded.</p>
      {error && <div className="error">{error}</div>}

      <div className="card hero fade-in delay-1" style={{ marginBottom: 16 }}>
        <div className="spread">
          <div>
            <div className="faint" style={{ fontSize: 12 }}>Total payable ({payable?.members.length ?? 0} members)</div>
            <div className="bignum gradient-text" style={{ marginTop: 6 }}><MoneyCounter cents={totalPayable} currency={c} /></div>
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Min threshold: {payable ? money(payable.payoutMinCents, c) : '—'}</div>
          </div>
          <div className="row no-print">
            {capabilities.payoutsProcess ? (
              requests?.length ? (
                <Button asChild>
                  <a href="#payout-requests">Review {requests.length} payout request{requests.length === 1 ? '' : 's'}</a>
                </Button>
              ) : (
                <Button variant="success" onClick={() => { void previewBatch('all'); }} disabled={busy || !payable?.members.length}>Review payout batch</Button>
              )
            ) : null}
            {hasMoreActions ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" aria-label="More payout actions">More actions <span aria-hidden="true">▾</span></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {capabilities.payoutsProcess && requests?.length ? (
                    <>
                      <DropdownMenuItem onSelect={() => { void previewBatch('all'); }} disabled={busy || !payable?.members.length}>Review payout batch</DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  {capabilities.payoutsExport ? (
                    <>
                      <DropdownMenuItem onSelect={() => { void downloadExport(); }}>⇩ {t('payouts.export')}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => { void downloadAch(); }} title="Self-hosted bank file (NACHA) — upload to your bank">⇩ ACH file</DropdownMenuItem>
                    </>
                  ) : null}
                  {capabilities.complianceView && capabilities.complianceReview ? (
                    <DropdownMenuItem onSelect={() => { void runFraudScan(); }} disabled={scanning}>{scanning ? 'Scanning…' : '⚠ Fraud scan'}</DropdownMenuItem>
                  ) : null}
                  {capabilities.reportsExport ? (
                    <DropdownMenuItem onSelect={() => { void downloadTaxForm(); }}>⇩ 1099-NEC</DropdownMenuItem>
                  ) : null}
                  {capabilities.payoutsProcess ? (
                    <DropdownMenuItem onSelect={() => { setReconcileOpen(true); setReconcileText(''); setReconcileResult(null); }} title="Match the bank statement against paid payouts">⇄ Reconcile</DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---- talep kuyrugu ---- */}
      {requests && requests.length > 0 && (
        <div id="payout-requests" className="card fade-in delay-1 scroll-mt-24" style={{ marginBottom: 16, borderColor: 'var(--amber)' }}>
          <div className="spread" style={{ marginBottom: 12 }}>
            <strong>Payout requests <Badge variant="pending" className="ml-1.5">{requests.length}</Badge></strong>
          </div>
          <table>
            <thead><tr><th>Member</th><th>Period</th><th style={{ textAlign: 'right' }}>Requested</th>{capabilities.complianceView ? <th className="no-print" style={{ textAlign: 'right' }}>Readiness</th> : null}{capabilities.payoutsProcess ? <th className="no-print" style={{ textAlign: 'right' }}>Decision</th> : null}</tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailPayout(r)}>
                  <td>{r.fullName}<div className="faint" style={{ fontSize: 12 }}>{r.referralCode}</div></td>
                  <td>{r.period}</td>
                  <td className="tnum" style={{ textAlign: 'right', fontWeight: 650 }}>{money(r.totalCents, c)}</td>
                  {capabilities.complianceView ? (
                    <td className="no-print" style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => setReadinessTarget({ membershipId: r.membershipId, fullName: r.fullName })}>Review</Button>
                    </td>
                  ) : null}
                  {capabilities.payoutsProcess ? (
                    <td className="no-print" style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {canPayoutAction(r, 'approve-request') && <Button variant="success" size="sm" onClick={() => { setDecisionReason(''); setDecide({ p: r, action: 'approve' }); }}>Start processing</Button>}
                        {canPayoutAction(r, 'reject-request') && <Button variant="destructive" size="sm" onClick={() => { setDecisionReason(''); setDecide({ p: r, action: 'reject' }); }}>Reject</Button>}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- clawback / negatif bakiye ---- */}
      {capabilities.reportsView && clawbacks && clawbacks.members.length > 0 && (
        <div className="card fade-in delay-1" style={{ marginBottom: 16, borderColor: 'var(--rose)' }}>
          <div className="spread" style={{ marginBottom: 12 }}>
            <strong>Clawbacks — negative balances <Badge variant="destructive" className="ml-1.5">{clawbacks.members.length}</Badge></strong>
            <span className="faint" style={{ fontSize: 12 }}>Total owed: {money(clawbacks.totalOwedCents, c)}</span>
          </div>
          <div className="faint" style={{ fontSize: 12, marginBottom: 8 }}>Auto-offset from future earnings. These members owe a balance after a post-payout reversal.</div>
          <table>
            <thead><tr><th>Member</th><th style={{ textAlign: 'right' }}>Owed</th></tr></thead>
            <tbody>
              {clawbacks.members.map((m) => (
                <tr key={m.membershipId}><td>{m.name}<div className="faint" style={{ fontSize: 12 }}>{m.referralCode}</div></td><td className="tnum" style={{ textAlign: 'right', color: 'var(--rose)' }}>{money(m.owedCents, c)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- fraud inceleme kuyrugu ---- */}
      {capabilities.complianceView && fraud.length > 0 && (
        <div className="card fade-in delay-1" style={{ marginBottom: 16, borderColor: 'var(--rose)' }}>
          <div className="spread" style={{ marginBottom: 12 }}>
            <strong>Fraud review <Badge variant="destructive" className="ml-1.5">{fraud.length}</Badge></strong>
          </div>
          <table>
            <thead><tr><th>Member</th><th>Score</th><th>Signals</th>{capabilities.complianceReview ? <th className="no-print" style={{ textAlign: 'right' }}>Decision</th> : null}</tr></thead>
            <tbody>
              {fraud.map((f) => (
                <tr key={f.membershipId}>
                  <td>{f.fullName}<div className="faint" style={{ fontSize: 12 }}>{f.referralCode}</div></td>
                  <td><Badge variant={f.blocked ? 'destructive' : 'pending'}>{f.score}{f.blocked ? ' · blocked' : ''}</Badge></td>
                  <td className="faint" style={{ fontSize: 12 }}>{f.reasons.join(', ')}</td>
                  {capabilities.complianceReview ? (
                    <td className="no-print" style={{ textAlign: 'right' }}>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <Button variant="success" size="sm" disabled={busyId === f.membershipId} onClick={() => decideFraud(f.membershipId, 'clear')}>Clear</Button>
                        <Button variant="destructive" size="sm" disabled={busyId === f.membershipId} onClick={() => decideFraud(f.membershipId, 'confirm')}>Confirm</Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- KYC inceleme kuyrugu ---- */}
      {capabilities.complianceView && kyc.length > 0 && (
        <div className="card fade-in delay-1" style={{ marginBottom: 16, borderColor: 'var(--sky)' }}>
          <div className="spread" style={{ marginBottom: 12 }}>
            <strong>Payout profiles to review <Badge variant="payable" className="ml-1.5">{kyc.length}</Badge></strong>
          </div>
          <table>
            <thead><tr><th>Member</th><th>Legal name</th><th>Tax ID</th><th>Bank</th>{capabilities.complianceReview ? <th className="no-print" style={{ textAlign: 'right' }}>Decision</th> : null}</tr></thead>
            <tbody>
              {kyc.map((k) => (
                <tr key={k.membershipId}>
                  <td>{k.fullName}<div className="faint" style={{ fontSize: 12 }}>{k.referralCode}</div></td>
                  <td>{k.legalName}{k.sanctionsHit && <Badge variant="destructive" className="ml-1.5">⚠ sanctions</Badge>}</td>
                  <td className="tnum">{k.taxIdType.toUpperCase()} ••••{k.taxIdLast4}</td>
                  <td className="faint" style={{ fontSize: 12 }}>{k.bankName ? `${k.bankName} · ` : ''}{k.accountType} ••••{k.accountLast4} · {k.routingNumber}</td>
                  {capabilities.complianceReview ? (
                    <td className="no-print" style={{ textAlign: 'right' }}>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <Button variant="success" size="sm" disabled={busyId === k.membershipId} onClick={() => decideKyc(k.membershipId, 'verify')}>Verify</Button>
                        <Button variant="destructive" size="sm" disabled={busyId === k.membershipId} onClick={() => decideKyc(k.membershipId, 'reject')}>Reject</Button>
                      </div>
                    </td>
                  ) : null}
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
          {capabilities.payoutsProcess && selected.size > 0 && <Button size="sm" className="no-print" disabled={busy} onClick={() => { void previewBatch('selected'); }}>Review selected ({selected.size}) · {money(selTotal, c)}</Button>}
        </div>
        {!payable ? <Loading rows={2} /> : (
          <table>
            <thead><tr>
              {capabilities.payoutsProcess ? <th className="no-print" style={{ width: 30 }}><input type="checkbox" checked={selected.size > 0 && selected.size === payable.members.length} onChange={toggleAll} aria-label="Select all" /></th> : null}
              <th>Member</th><th>Code</th><th style={{ textAlign: 'right' }}>Sold (mo)</th><th style={{ textAlign: 'right' }}>Net payable</th><th style={{ textAlign: 'right' }}>Eff. %</th>{capabilities.complianceView ? <th className="no-print" style={{ textAlign: 'right' }}>Readiness</th> : null}
            </tr></thead>
            <tbody>
              {payable.members.map((m) => (
                <tr key={m.membershipId} style={{ background: selected.has(m.membershipId) ? 'var(--panel-2)' : undefined }}>
                  {capabilities.payoutsProcess ? <td className="no-print"><input type="checkbox" checked={selected.has(m.membershipId)} onChange={() => toggle(m.membershipId)} aria-label={`Select ${m.fullName}`} /></td> : null}
                  <td>{m.fullName}</td>
                  <td className="faint">{m.referralCode}</td>
                  <td className="tnum" style={{ textAlign: 'right', color: 'var(--muted)' }}>{Number(m.soldThisMonthCents) > 0 ? money(m.soldThisMonthCents, c) : '—'}</td>
                  <td className="tnum" style={{ textAlign: 'right', fontWeight: 650, color: 'var(--gold-500)' }}>{money(m.netCents, c)}</td>
                  <td className="tnum faint" style={{ textAlign: 'right' }}>{Number(m.soldThisMonthCents) > 0 ? `%${((Number(m.netCents) / Number(m.soldThisMonthCents)) * 100).toFixed(1)}` : '—'}</td>
                  {capabilities.complianceView ? <td className="no-print" style={{ textAlign: 'right' }}><Button variant="ghost" size="sm" onClick={() => setReadinessTarget({ membershipId: m.membershipId, fullName: m.fullName })}>Review</Button></td> : null}
                </tr>
              ))}
              {payable.members.length === 0 && <tr><td colSpan={(capabilities.payoutsProcess ? 6 : 5) + (capabilities.complianceView ? 1 : 0)} className="muted">No members above the threshold.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- gecmis (filtreli + sayfali) ---- */}
      <div className="card fade-in delay-3">
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong>{t('payouts.history')}{history ? ` · ${history.total}` : ''}</strong>
          <div className="row no-print" style={{ gap: 8 }}>
            <Input type="month" name="history-period" className="h-9 w-auto" value={hPeriod} onChange={(e) => { setHPeriod(e.target.value); setHPage(1); }} aria-label="Period" />
            <select name="history-status" value={hStatus} onChange={(e) => { setHStatus(e.target.value); setHPage(1); }} style={{ width: 'auto' }} aria-label="Status">
              {HISTORY_STATUS.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
            </select>
          </div>
        </div>
        {!history ? <Loading rows={2} /> : (
          <table>
            <thead><tr><th>Member</th><th>Amount</th><th>Method</th><th>Status</th><th>Period</th><th>Date</th></tr></thead>
            <tbody>
              {history.items.map((p) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setDetailPayout(p)}>
                  <td>{p.fullName}<div className="faint" style={{ fontSize: 12 }}>{p.referralCode}</div></td>
                  <td className="tnum">{money(p.totalCents, c)}</td>
                  <td className="faint">{p.method}</td>
                  <td><Badge variant={payoutStatusVariant(p.status)}>{p.status}</Badge>{p.clearedAt ? <Badge variant="success" className="ml-1.5 text-[10px]" title={p.bankRef ? `Bank ref: ${p.bankRef}` : 'Bank reconciled'}>✓ cleared</Badge> : null}</td>
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

      {capabilities.payoutsProcess && batchPreview && (
        <Confirm
          title="Start reviewed payout batch"
          message={`Review found ${batchPreview.eligibleCount} eligible payout${batchPreview.eligibleCount === 1 ? '' : 's'} (${batchPreview.totals.map((total) => money(total.amountCents, total.currency)).join(', ') || 'no payable total'}) and ${batchPreview.excludedCount} excluded. Starting this batch reserves eligible ledger entries in processing; money is marked paid only after settlement reference and evidence are recorded.`}
          confirmLabel="Start processing"
          busy={busy}
          onConfirm={startReviewedBatch}
          onClose={() => setBatchPreview(null)}
        />
      )}

      {capabilities.payoutsProcess && decide && (
        <Modal title={decide.action === 'approve' ? 'Review request' : 'Reject request'} onClose={() => setDecide(null)}>
          <div style={{ width: 'min(440px, 88vw)' }}>
            <p className="muted" style={{ marginTop: 0 }}>
              {decide.action === 'approve'
                ? `Review ${decide.p.fullName}'s request for ${money(decide.p.totalCents, c)}. A signed batch review must be confirmed before any balance is reserved.`
                : `Reject ${decide.p.fullName}'s request? No transfer is created and the request is closed.`}
            </p>
            {decide.action === 'reject' && <div className="field">
              <Label htmlFor="decision-reason" className="mb-1.5 block">Reason</Label>
              <Input id="decision-reason" value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} placeholder="e.g. invalid bank details" autoFocus />
            </div>}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <Button variant="ghost" onClick={() => setDecide(null)} disabled={busy}>Cancel</Button>
              <Button variant={decide.action === 'reject' ? 'destructive' : 'success'} onClick={submitDecide} disabled={busy}>
                {busy ? '…' : decide.action === 'approve' ? 'Review batch' : 'Reject'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {detailPayout && <PayoutDrawer payout={detailPayout} currency={c} tenantName={tenantName} canProcess={capabilities.payoutsProcess} onClose={() => setDetailPayout(null)} onChanged={refreshAll} onToast={showToast} />}

      {readinessTarget && <PayoutReadinessModal target={readinessTarget} currency={c} canReview={capabilities.complianceReview} onClose={() => setReadinessTarget(null)} onChanged={refreshAll} onToast={showToast} />}

      {capabilities.complianceReview && reasonModal && (
        <Modal title={reasonModal.title} onClose={() => setReasonModal(null)}>
          <div style={{ width: 'min(420px, 100%)' }}>
            <div className="field">
              <Label htmlFor="reason-text" className="mb-1.5 block">{reasonModal.label}</Label>
              <Textarea id="reason-text" value={reasonText} onChange={(e) => setReasonText(e.target.value)} rows={2} autoFocus />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <Button variant="ghost" onClick={() => setReasonModal(null)} disabled={busy}>Cancel</Button>
              <Button disabled={busy} onClick={async () => { setBusy(true); try { await reasonModal.run(reasonText); setReasonModal(null); } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); } }}>Confirm</Button>
            </div>
          </div>
        </Modal>
      )}

      {capabilities.payoutsProcess && reconcileOpen && (
        <Modal title="Bank reconciliation" onClose={() => setReconcileOpen(false)}>
          <div style={{ width: 'min(520px, 100%)' }}>
            <p className="muted" style={{ marginTop: 0 }}>
              After the bank processes the ACH file and sends the money, paste the returned statement here.
              Each line is <strong>amount</strong> (e.g. <code>1500.00</code>) or <strong>amount,reference</strong> (e.g. <code>1500.00,ACH-001</code>).
              We match by amount against paid payouts and mark them <em>cleared</em>.
            </p>
            <div className="field">
              <Label htmlFor="reconcile-lines" className="mb-1.5 block">Statement lines</Label>
              <Textarea id="reconcile-lines" value={reconcileText} onChange={(e) => setReconcileText(e.target.value)} rows={6} placeholder={'1500.00,ACH-20260613-001\n2250.50\n980.00,WIRE-77'} style={{ fontFamily: 'var(--mono, monospace)' }} />
            </div>
            {reconcileResult && (
              <div className="card" style={{ background: 'var(--panel-2)', marginBottom: 12 }}>
                <div className="row spread"><span>✓ Cleared</span><strong>{reconcileResult.clearedCount}</strong></div>
                <div className="row spread"><span>Unmatched lines</span><strong>{reconcileResult.unmatched.length}</strong></div>
                <div className="row spread"><span className="muted">Still uncleared payouts</span><span className="muted">{reconcileResult.remainingUncleared}</span></div>
                {reconcileResult.unmatched.length > 0 && (
                  <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                    Unmatched: {reconcileResult.unmatched.map((u) => money(String(u.amountCents), c)).join(', ')}
                  </div>
                )}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <Button variant="ghost" onClick={() => setReconcileOpen(false)} disabled={busy}>Close</Button>
              <Button onClick={runReconcile} disabled={busy || !reconcileText.trim()}>{busy ? 'Matching…' : '⇄ Match'}</Button>
            </div>
          </div>
        </Modal>
      )}

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

function PayoutDrawer({ payout, currency, tenantName, canProcess, onClose, onChanged, onToast }: { payout: PayoutItem; currency: string; tenantName: string; canProcess: boolean; onClose: () => void; onChanged: () => Promise<void>; onToast: (m: string) => void }) {
  const [d, setD] = useState<PayoutDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [batchAction, setBatchAction] = useState<'dispatch' | 'settle' | 'fail' | null>(null);
  const [dispatchReference, setDispatchReference] = useState('');
  const [dispatchEvidence, setDispatchEvidence] = useState('');
  const [settlementReference, setSettlementReference] = useState('');
  const [settlementEvidence, setSettlementEvidence] = useState('');
  const [failureReason, setFailureReason] = useState('');

  const load = useCallback(() => {
    api.get<PayoutDetail>(`/admin/payouts/${payout.id}`).then(setD).catch((e) => setErr(String((e as ApiError).message)));
  }, [payout.id]);
  useEffect(() => { load(); }, [load]);

  const canBatchAction = (action: 'dispatch-batch' | 'settle-batch' | 'fail-batch') =>
    canProcess
    && payout.batchId !== null
    && payout.presentation?.actionCandidates?.authority === 'active-tenant'
    && payout.presentation.actionCandidates.mutations.includes(action);

  async function submitBatchAction() {
    if (!canProcess) { setErr('Payout processing permission is required.'); return; }
    if (!batchAction || !payout.batchId) { setErr('This payout is not attached to an actionable batch.'); return; }
    const dispatchRef = dispatchReference.trim();
    const dispatchProof = dispatchEvidence.trim();
    const reference = settlementReference.trim();
    const evidence = settlementEvidence.trim();
    const reason = failureReason.trim();
    if (batchAction === 'dispatch' && (!dispatchRef || !dispatchProof)) {
      setErr('Dispatch reference and evidence are required.');
      return;
    }
    if (batchAction === 'settle' && (!reference || !evidence)) {
      setErr('Settlement reference and evidence are required.');
      return;
    }
    if (batchAction === 'fail' && !reason) {
      setErr('A release reason is required.');
      return;
    }
    setBusy(true); setErr('');
    try {
      if (batchAction === 'dispatch') {
        await api.post(`/admin/payouts/batches/${payout.batchId}/dispatch`, {
          dispatchReference: dispatchRef,
          dispatchEvidence: dispatchProof,
        });
        onToast('Payment hand-off recorded. This batch can no longer be released.');
      } else if (batchAction === 'settle') {
        await api.post(`/admin/payouts/batches/${payout.batchId}/settle`, {
          settlementReference: reference,
          settlementEvidence: evidence,
        });
        onToast('Batch settled; linked payouts are now marked paid.');
      } else {
        await api.post(`/admin/payouts/batches/${payout.batchId}/fail`, { reason });
        onToast('Batch released; balances are available for a new review.');
      }
      setBatchAction(null); setDispatchReference(''); setDispatchEvidence(''); setSettlementReference(''); setSettlementEvidence(''); setFailureReason('');
      await Promise.all([load(), onChanged()]);
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <Drawer
      title={d ? money(d.totalCents, currency) : 'Payout'}
      subtitle={d ? `${d.member.fullName} · ${d.period}` : undefined}
      onClose={onClose}
      width={520}
      footer={d && (
        <>
          <Button variant="ghost" onClick={() => setPrinting(true)}>🖶 Print slip</Button>
          {canBatchAction('dispatch-batch') && <Button disabled={busy} onClick={() => setBatchAction('dispatch')}>Mark dispatched</Button>}
          {canBatchAction('settle-batch') && <Button variant="success" disabled={busy} onClick={() => setBatchAction('settle')}>Settle batch</Button>}
          {canBatchAction('fail-batch') && <Button variant="destructive" disabled={busy} onClick={() => setBatchAction('fail')}>Release batch</Button>}
        </>
      )}
    >
      {err && <div className="error">{err}</div>}
      {!d ? <Loading rows={4} /> : (
        <div className="grid" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 8 }}><Badge variant={payoutStatusVariant(d.status)}>{d.status}</Badge>{payout.batchStatus === 'dispatched' && <Badge variant="payable">dispatched · awaiting settlement</Badge>}</div>
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

      {batchAction && d && (
        <div className="card" style={{ marginTop: 16, background: 'var(--panel-2)' }}>
          <strong style={{ display: 'block', marginBottom: 6 }}>
            {batchAction === 'dispatch' ? 'Record payment dispatch' : batchAction === 'settle' ? 'Settle dispatched batch' : 'Release processing batch'}
          </strong>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            {batchAction === 'dispatch'
              ? 'Confirm the payment instruction was handed to the bank or provider. Compliance is checked now; after this checkpoint the reserved balance cannot be released automatically.'
              : batchAction === 'settle'
              ? 'Record the bank or provider settlement reference and durable confirmation. This is the only action that marks linked payouts paid.'
              : 'Release the reserved balance without representing a transfer. The member can be included in a new reviewed batch.'}
          </p>
          {batchAction === 'dispatch' ? (
            <>
              <div className="field">
                <Label htmlFor="dispatch-reference" className="mb-1.5 block">Dispatch reference</Label>
                <Input id="dispatch-reference" value={dispatchReference} onChange={(event) => setDispatchReference(event.target.value)} placeholder="Bank upload, payment run, or provider hand-off ID" autoFocus />
              </div>
              <div className="field">
                <Label htmlFor="dispatch-evidence" className="mb-1.5 block">Dispatch evidence</Label>
                <Textarea id="dispatch-evidence" value={dispatchEvidence} onChange={(event) => setDispatchEvidence(event.target.value)} rows={3} placeholder="Upload receipt, provider confirmation, or controlled run note" />
              </div>
            </>
          ) : batchAction === 'settle' ? (
            <>
              <div className="field">
                <Label htmlFor="settlement-reference" className="mb-1.5 block">Settlement reference</Label>
                <Input id="settlement-reference" value={settlementReference} onChange={(event) => setSettlementReference(event.target.value)} placeholder="Bank trace or provider transfer ID" autoFocus />
              </div>
              <div className="field">
                <Label htmlFor="settlement-evidence" className="mb-1.5 block">Settlement evidence</Label>
                <Textarea id="settlement-evidence" value={settlementEvidence} onChange={(event) => setSettlementEvidence(event.target.value)} rows={3} placeholder="Statement location, reconciliation note, or provider confirmation" />
              </div>
            </>
          ) : (
            <div className="field">
              <Label htmlFor="batch-release-reason" className="mb-1.5 block">Release reason</Label>
              <Textarea id="batch-release-reason" value={failureReason} onChange={(event) => setFailureReason(event.target.value)} rows={3} placeholder="Why no transfer was completed" autoFocus />
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <Button variant="ghost" onClick={() => setBatchAction(null)} disabled={busy}>Cancel</Button>
            <Button variant={batchAction === 'fail' ? 'destructive' : batchAction === 'settle' ? 'success' : 'default'} onClick={submitBatchAction} disabled={busy}>
              {busy ? 'Saving…' : batchAction === 'dispatch' ? 'Mark dispatched' : batchAction === 'settle' ? 'Settle batch' : 'Release batch'}
            </Button>
          </div>
        </div>
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

const READINESS_LABELS: Record<ReadinessKey, string> = {
  address: 'Address',
  kyc: 'KYC',
  fraud: 'Fraud review',
  sanctions: 'Sanctions screening',
  payment_method: 'Payment method',
};

function PayoutReadinessModal({ target, currency, canReview, onClose, onChanged, onToast }: {
  target: ReadinessTarget; currency: string; canReview: boolean; onClose: () => void; onChanged: () => Promise<void>; onToast: (message: string) => void;
}) {
  const [readiness, setReadiness] = useState<PayoutReadiness | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [providerReference, setProviderReference] = useState('');
  const [destinationLast4, setDestinationLast4] = useState('');
  const [destinationCountry, setDestinationCountry] = useState('US');
  const [destinationCurrency, setDestinationCurrency] = useState(currency);
  const [destinationVerifiedAt, setDestinationVerifiedAt] = useState(() => new Date().toISOString().slice(0, 16));

  const load = useCallback(async () => {
    try {
      setErr('');
      const next = await api.get<PayoutReadiness>(`/admin/payouts/members/${target.membershipId}/readiness`);
      setReadiness(next);
      setDestinationLast4(next.activeDestination?.last4 ?? '');
      setDestinationCountry(next.activeDestination?.country ?? 'US');
      setDestinationCurrency(next.activeDestination?.currency ?? currency);
      setDestinationVerifiedAt((next.activeDestination?.verifiedAt ?? new Date().toISOString()).slice(0, 16));
    } catch (error) { setErr(String((error as ApiError).message)); }
  }, [currency, target.membershipId]);

  useEffect(() => { void load(); }, [load]);

  async function decideControl(control: ReadinessControl, status: 'ready' | 'blocked') {
    if (!canReview) { setErr('Compliance review permission is required.'); return; }
    setBusy(true); setErr('');
    try {
      await api.put(`/admin/payouts/members/${target.membershipId}/readiness/${control.key}`, {
        status,
        reasonCode: status === 'ready' ? 'manual_review' : 'manual_hold',
        expiresAt: null,
        expectedVersion: control.version,
      });
      onToast(`${READINESS_LABELS[control.key]} marked ${status}.`);
      await Promise.all([load(), onChanged()]);
    } catch (error) { setErr(String((error as ApiError).message)); } finally { setBusy(false); }
  }

  async function replaceDestination() {
    if (!canReview) { setErr('Compliance review permission is required.'); return; }
    if (!readiness) return;
    const reference = providerReference.trim();
    const last4 = destinationLast4.trim();
    const country = destinationCountry.trim().toUpperCase();
    const nextCurrency = destinationCurrency.trim().toUpperCase();
    const verifiedAt = new Date(destinationVerifiedAt);
    if (!reference) { setErr('Provider reference is required.'); return; }
    if (last4 && !/^\d{4}$/.test(last4)) { setErr('Last four must contain exactly four digits.'); return; }
    if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{3}$/.test(nextCurrency)) { setErr('Use ISO country (for example US) and currency (for example USD) codes.'); return; }
    if (Number.isNaN(verifiedAt.getTime())) { setErr('Enter a valid verification time.'); return; }
    setBusy(true); setErr('');
    try {
      await api.put(`/admin/payouts/members/${target.membershipId}/destination`, {
        providerReference: reference,
        last4: last4 || null,
        country,
        currency: nextCurrency,
        verifiedAt: verifiedAt.toISOString(),
        expectedVersion: readiness.activeDestination?.version ?? 0,
      });
      setProviderReference('');
      onToast('Payout destination updated and versioned.');
      await Promise.all([load(), onChanged()]);
    } catch (error) { setErr(String((error as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Payout readiness — ${target.fullName}`} onClose={onClose}>
      <div style={{ width: 'min(720px, 92vw)' }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Review controls and the masked destination before starting a payout batch. The member cannot approve their own compliance record.
        </p>
        {err && <div className="error">{err}</div>}
        {!readiness ? <Loading rows={4} /> : (
          <div className="grid" style={{ gap: 16 }}>
            <div>
              <strong style={{ display: 'block', marginBottom: 8 }}>Readiness controls</strong>
              <table>
                <thead><tr><th>Control</th><th>Status</th><th>Reason</th><th>Reviewed</th>{canReview ? <th className="no-print" style={{ textAlign: 'right' }}>Action</th> : null}</tr></thead>
                <tbody>
                  {readiness.controls.map((control) => (
                    <tr key={control.key}>
                      <td>{READINESS_LABELS[control.key]}</td>
                      <td><Badge variant={control.status === 'ready' ? 'success' : control.status === 'blocked' ? 'destructive' : 'pending'}>{control.status}</Badge></td>
                      <td className="faint">{control.reasonCode}</td>
                      <td className="faint">{control.reviewedAt ? dateShort(control.reviewedAt) : 'Not reviewed'}</td>
                      {canReview ? <td className="no-print" style={{ textAlign: 'right' }}><div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="success" size="sm" disabled={busy} onClick={() => { void decideControl(control, 'ready'); }}>Ready</Button><Button variant="destructive" size="sm" disabled={busy} onClick={() => { void decideControl(control, 'blocked'); }}>Block</Button></div></td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card" style={{ background: 'var(--panel-2)' }}>
              <div className="spread" style={{ marginBottom: 8 }}>
                <strong>Payment destination</strong>
                {readiness.activeDestination?.verifiedAt ? <Badge variant="success">Verified</Badge> : <Badge variant="pending">Missing</Badge>}
              </div>
              {readiness.activeDestination?.verifiedAt ? <div className="faint" style={{ fontSize: 13, marginBottom: 12 }}>{readiness.activeDestination.maskedLabel} · {readiness.activeDestination.country} · verified {dateShort(readiness.activeDestination.verifiedAt)}</div> : <div className="faint" style={{ fontSize: 13, marginBottom: 12 }}>No verified payout destination is on file.</div>}
              {canReview ? (
                <div className="grid" style={{ gap: 10 }}>
                  <div className="field"><Label htmlFor="destination-provider-reference" className="mb-1.5 block">Provider reference</Label><Input id="destination-provider-reference" value={providerReference} onChange={(event) => setProviderReference(event.target.value)} placeholder="Provider or bank destination ID" /></div>
                  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <div className="field"><Label htmlFor="destination-last4" className="mb-1.5 block">Last four</Label><Input id="destination-last4" value={destinationLast4} onChange={(event) => setDestinationLast4(event.target.value)} inputMode="numeric" maxLength={4} placeholder="1234" /></div>
                    <div className="field"><Label htmlFor="destination-country" className="mb-1.5 block">Country</Label><Input id="destination-country" value={destinationCountry} onChange={(event) => setDestinationCountry(event.target.value)} maxLength={2} placeholder="US" /></div>
                    <div className="field"><Label htmlFor="destination-currency" className="mb-1.5 block">Currency</Label><Input id="destination-currency" value={destinationCurrency} onChange={(event) => setDestinationCurrency(event.target.value)} maxLength={3} placeholder="USD" /></div>
                  </div>
                  <div className="field"><Label htmlFor="destination-verified-at" className="mb-1.5 block">Verified at (local time)</Label><Input id="destination-verified-at" type="datetime-local" value={destinationVerifiedAt} onChange={(event) => setDestinationVerifiedAt(event.target.value)} /></div>
                  <div className="row" style={{ justifyContent: 'flex-end' }}><Button disabled={busy || !providerReference.trim()} onClick={() => { void replaceDestination(); }}>Save destination</Button></div>
                </div>
              ) : <div className="faint" style={{ fontSize: 13 }}>A compliance reviewer must update the payout destination.</div>}
            </div>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button></div>
      </div>
    </Modal>
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
