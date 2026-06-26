'use client';

import type { CSSProperties, ComponentProps } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { cn } from '@/lib/utils';
import { Confirm, Loading, Modal, MoneyCounter, Pagination, useToast } from '@/components/ui';
import { Drawer } from '@/components/Drawer';
import { PrintSheet, PrintHeader, PrintSignatures } from '@/components/PrintSheet';
import { activeMembership, getSession } from '@/lib/auth';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';

interface PayableMember { membershipId: string; referralCode: string; fullName: string; netCents: string; soldThisMonthCents: string }
interface PayableList { payoutMinCents: string; currency: string; members: PayableMember[] }
interface PayoutItem { id: string; membershipId: string; referralCode: string; fullName: string; totalCents: string; method: string; status: string; period: string; paidAt: string | null; ref: string | null; clearedAt?: string | null; bankRef?: string | null }
interface PayoutListResp { total: number; page: number; pageSize: number; items: PayoutItem[] }
interface RunResult { proposed?: boolean; paidCount?: number; skippedCount?: number; count?: number; estimateCents?: string }
interface Batch { id: string; period: string; method: string; count: number; estimateCents: string; createdAt: string }
interface KycProfile {
  membershipId: string; fullName: string; referralCode: string; email: string;
  legalName: string; taxIdType: string; taxIdLast4: string; bankName: string | null;
  routingNumber: string; accountType: string; accountLast4: string; lastChangedAt: string; sanctionsHit: boolean;
}
interface FraudFlag {
  membershipId: string; fullName: string; referralCode: string; email: string;
  score: number; reasons: string[]; status: string; note: string | null; blocked: boolean;
}

const HISTORY_STATUS = ['', 'requested', 'processing', 'paid', 'failed'] as const;

/* ---------------- inline presentational helpers (screen-scoped) ---------------- */

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const dim = size === 'md' ? 'h-8 w-8 text-xs' : 'h-6 w-6 text-[10px]';
  return (
    <span className={`grid shrink-0 place-items-center rounded-md border border-input bg-muted font-semibold text-muted-foreground ${dim}`}>
      {initialsOf(name)}
    </span>
  );
}

/* para-anlamli ton: var() + /15 alfa (light+dark dogru) */
type MoneyTone = 'emerald' | 'amber' | 'rose';
function toneStyle(tone: MoneyTone): CSSProperties {
  const v = `var(--${tone})`;
  return {
    color: v,
    backgroundColor: `color-mix(in srgb, ${v} 15%, transparent)`,
    borderColor: `color-mix(in srgb, ${v} 30%, transparent)`,
  };
}

/* dolu (solid) pozitif aksiyon butonu — var(--emerald) zemin + okunur metin (light+dark dogru) */
const successBtnStyle: CSSProperties = {
  backgroundColor: 'var(--emerald)',
  color: 'var(--primary-foreground)',
  borderColor: 'transparent',
};

/* payout durum -> ton/tailwind sinifi. amber=bekliyor, primary=yolda, emerald=tamam, rose=red */
const STATUS_TONE: Record<string, MoneyTone> = {
  // tamamlanan akislar
  paid: 'emerald',
  delivered: 'emerald',
  cashed: 'emerald',
  approved: 'emerald',
  // bekleyen / yolda
  requested: 'amber',
  // basarisiz / reddedilen
  failed: 'rose',
  rejected: 'rose',
};
// 'processing' / 'in-transit' / 'payable' -> primary (token) sinifiyla
const STATUS_PRIMARY = new Set(['processing', 'in-transit', 'in_transit', 'payable']);

function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status];
  const primary = STATUS_PRIMARY.has(status);
  return (
    <span
      style={tone ? toneStyle(tone) : undefined}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize tabular-nums ${
        tone ? '' : primary ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'
      }`}
    >
      {status.replace(/[-_]/g, ' ')}
    </span>
  );
}

/* tablo basligi — Sales ile ayni: muted, uppercase, tracking-wide, 11px */
function Th({ className, ...props }: ComponentProps<typeof TableHead>) {
  return <TableHead className={cn('text-[11px] font-semibold uppercase tracking-wide text-muted-foreground', className)} {...props} />;
}

/** Indigo segmented bar — ready-to-pay vs blocked (clawback) share of the total. */
function PayoutProgress({ ready, blocked, currency }: { ready: number; blocked: number; currency: string }) {
  const total = ready + blocked;
  const readyPct = total > 0 ? (ready / total) * 100 : 100;
  const blockedPct = total > 0 ? (blocked / total) * 100 : 0;
  return (
    <div className="mt-4">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="flex h-full w-full">
          <div className="h-full bg-primary transition-all" style={{ width: `${readyPct}%` }} />
          <div className="h-full bg-destructive/70 transition-all" style={{ width: `${blockedPct}%` }} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-primary" /> Ready
          <span className="font-semibold tabular-nums text-foreground">{money(String(Math.round(ready)), currency)}</span>
        </span>
        {blocked > 0 && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-destructive/70" /> Owed back
            <span className="font-semibold tabular-nums text-destructive">{money(String(Math.round(blocked)), currency)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export default function PayoutsPage() {
  const [payable, setPayable] = useState<PayableList | null>(null);
  const [requests, setRequests] = useState<PayoutItem[] | null>(null);
  const [kyc, setKyc] = useState<KycProfile[]>([]);
  const [fraud, setFraud] = useState<FraudFlag[]>([]);
  const [clawbacks, setClawbacks] = useState<{ totalOwedCents: string; members: { membershipId: string; name: string; referralCode: string; owedCents: string }[] } | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [scanning, setScanning] = useState(false);
  const [history, setHistory] = useState<PayoutListResp | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  // in-flight guard keyed by batch id / membershipId - double-click double-action onler
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState<'all' | 'selected' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decide, setDecide] = useState<{ p: PayoutItem; action: 'approve' | 'reject' } | null>(null);
  const [decideRef, setDecideRef] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
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
    try {
      const [p, r, k, f] = await Promise.all([
        api.get<PayableList>('/admin/payouts/payable'),
        api.get<PayoutListResp>('/admin/payouts?status=requested&pageSize=100'),
        api.get<KycProfile[]>('/admin/payout-profiles?status=pending_review'),
        api.get<FraudFlag[]>('/admin/fraud?status=open'),
      ]);
      setPayable(p); setRequests(r.items); setKyc(k); setFraud(f); setSelected(new Set());
      api.get<{ totalOwedCents: string; members: { membershipId: string; name: string; referralCode: string; owedCents: string }[] }>('/admin/clawbacks').then(setClawbacks).catch(() => {});
      api.get<Batch[]>('/admin/payouts/batches').then(setBatches).catch(() => {});
    } catch (e) { setError(String((e as ApiError).message)); }
  }, []);

  async function decideBatch(id: string, action: 'approve' | 'reject') {
    if (busyId) return;
    setBusyId(id);
    try {
      await api.post(`/admin/payouts/batches/${id}/${action}`);
      showToast(action === 'approve' ? 'Batch approved & paid ✓' : 'Batch rejected');
      await refreshAll();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusyId(null); }
  }

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
    setScanning(true);
    try { const r = await api.post<{ flagged: number; blocked: number }>('/admin/fraud/scan'); showToast(`Scan done — ${r.flagged} flagged, ${r.blocked} blocked`); await loadCore(); }
    catch (e) { setError(String((e as ApiError).message)); } finally { setScanning(false); }
  }
  async function decideFraud(membershipId: string, action: 'clear' | 'confirm') {
    if (action === 'confirm') {
      setReasonText('');
      setReasonModal({ title: 'Confirm fraud', label: 'Note (optional)', run: async (note) => {
        await api.post(`/admin/fraud/${membershipId}/decide`, { action, ...(note.trim() ? { note: note.trim() } : {}) }); showToast('Confirmed'); await loadCore();
      } });
      return;
    }
    if (busyId) return;
    setBusyId(membershipId);
    try { await api.post(`/admin/fraud/${membershipId}/decide`, { action }); showToast('Cleared ✓'); await loadCore(); }
    catch (e) { setError(String((e as ApiError).message)); } finally { setBusyId(null); }
  }

  async function decideKyc(membershipId: string, action: 'verify' | 'reject') {
    if (action === 'reject') {
      setReasonText('');
      setReasonModal({ title: 'Reject payout profile', label: 'Reason (optional)', run: async (reason) => {
        await api.post(`/admin/payout-profiles/${membershipId}/decide`, { action, ...(reason.trim() ? { reason: reason.trim() } : {}) }); showToast('Payout profile rejected'); await loadCore();
      } });
      return;
    }
    if (busyId) return;
    setBusyId(membershipId);
    try {
      await api.post(`/admin/payout-profiles/${membershipId}/decide`, { action });
      showToast(action === 'verify' ? 'Payout profile verified ✓' : 'Payout profile rejected');
      await loadCore();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusyId(null); }
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
      showToast(res.proposed
        ? `Proposed ${res.count} payout(s) — awaiting a second admin's approval`
        : `${res.paidCount} payouts processed, ${res.skippedCount} skipped`);
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
  const totalOwed = clawbacks ? Number(clawbacks.totalOwedCents) : 0;

  return (
    <div className="mx-auto max-w-[1160px]">
      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">{t('nav.payouts')}</div>
      <h1 className="mt-1.5 font-display text-3xl font-extrabold tracking-tight text-foreground">Payout Management</h1>
      <p className="mt-1 text-sm text-muted-foreground">Approve member requests, pay members above the threshold, and download the bank CSV.</p>

      {error && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</div>
      )}

      {/* ---- ready to pay banner ---- */}
      <Card className="relative mt-5 overflow-hidden border-primary/30 shadow-lg">
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
        <CardContent className="flex flex-wrap items-center justify-between gap-5 p-6">
          <div>
            <div className="text-xs text-muted-foreground">Ready to pay · matured &amp; over threshold</div>
            <div className="mt-1 font-display text-4xl font-extrabold tracking-tight tabular-nums text-primary">
              <MoneyCounter cents={totalPayable} currency={c} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground/70">
              {payable?.members.length ?? 0} members · min threshold {payable ? money(payable.payoutMinCents, c) : '—'}
            </div>
            <PayoutProgress ready={totalPayable} blocked={totalOwed} currency={c} />
          </div>
          <div className="flex flex-wrap gap-2.5 print:hidden">
            <Button onClick={() => setConfirmRun('all')} disabled={busy || !payable?.members.length}>
              <span aria-hidden>→</span> {t('payouts.run')}
            </Button>
            <Button variant="outline" onClick={downloadExport}><span aria-hidden>⇩</span> {t('payouts.export')}</Button>
            <Button variant="outline" onClick={runFraudScan} disabled={scanning}>{scanning ? 'Scanning…' : <><span aria-hidden>⚠</span> Fraud scan</>}</Button>
            <Button variant="outline" onClick={() => { const y = new Date().getFullYear(); downloadCsv(`/admin/tax/1099.csv?year=${y}`, `1099-nec-${y}.csv`).catch((e) => setError(String((e as ApiError).message))); }}><span aria-hidden>⇩</span> 1099-NEC</Button>
            <Button variant="outline" onClick={() => { downloadCsv('/admin/payouts/ach.txt', 'payouts-ach.txt').catch((e) => setError(String((e as ApiError).message))); }} title="Self-hosted bank file (NACHA) — upload to your bank"><span aria-hidden>⇩</span> ACH file</Button>
            <Button variant="outline" onClick={() => { setReconcileOpen(true); setReconcileText(''); setReconcileResult(null); }} title="Match the bank statement against paid payouts"><span aria-hidden>⇄</span> Reconcile</Button>
          </div>
        </CardContent>
      </Card>

      {/* ---- negatif bakiye band ---- */}
      {clawbacks && clawbacks.members.length > 0 && (
        <div className="mt-3.5 flex items-center gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] text-destructive">
          <span aria-hidden className="text-base leading-none">⚠</span>
          <span>
            <strong>{clawbacks.members.length} member{clawbacks.members.length > 1 ? 's' : ''}</strong> {clawbacks.members.length > 1 ? 'have' : 'has'} a negative balance
            {' '}(owed {money(clawbacks.totalOwedCents, c)} from a reversal) — excluded from this run until covered.
          </span>
        </div>
      )}

      {/* ---- talep kuyrugu (request queue) ---- */}
      {requests && requests.length > 0 && (
        <Card className="mt-4 shadow-lg" style={{ borderColor: 'color-mix(in srgb, var(--amber) 30%, transparent)' }}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <strong className="text-[13.5px] text-foreground">Payout requests</strong>
              <Badge style={toneStyle('amber')} className="border-transparent">{requests.length} pending</Badge>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Member</Th>
                  <Th>Period</Th>
                  <Th className="text-right">Requested</Th>
                  <Th className="text-right print:hidden">Decision</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setDetailId(r.id)}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.fullName} />
                        <div>
                          <div className="font-medium text-foreground">{r.fullName}</div>
                          <div className="font-mono text-[11px] text-muted-foreground/70">{r.referralCode}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.period}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-foreground">{money(r.totalCents, c)}</TableCell>
                    <TableCell className="text-right print:hidden" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" style={successBtnStyle} onClick={() => { setDecideRef(''); setDecide({ p: r, action: 'approve' }); }}>Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => { setDecideRef(''); setDecide({ p: r, action: 'reject' }); }}>Reject</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ---- maker-checker: bekleyen payout onaylari ---- */}
      {batches.length > 0 && (
        <Card className="mt-4 border-primary/40 shadow-lg">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <strong className="text-[13.5px] text-foreground">Payout approvals (4-eyes)</strong>
              <Badge className="border-transparent bg-primary/15 text-primary">{batches.length}</Badge>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Period</Th>
                  <Th>Members</Th>
                  <Th className="text-right">Estimate</Th>
                  <Th className="text-right print:hidden">Decision</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id} className="hover:bg-transparent">
                    <TableCell className="text-foreground">{b.period}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{b.count}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-foreground">{money(b.estimateCents, c)}</TableCell>
                    <TableCell className="text-right print:hidden">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" style={successBtnStyle} disabled={busyId === b.id} onClick={() => decideBatch(b.id, 'approve')}>Approve &amp; pay</Button>
                        <Button size="sm" variant="destructive" disabled={busyId === b.id} onClick={() => decideBatch(b.id, 'reject')}>Reject</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="px-5 py-3 text-[11px] text-muted-foreground/70">The admin who proposed a batch cannot approve it.</p>
          </CardContent>
        </Card>
      )}

      {/* ---- clawback / negatif bakiye detay ---- */}
      {clawbacks && clawbacks.members.length > 0 && (
        <Card className="mt-4 border-destructive/30 shadow-lg">
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
              <strong className="text-[13.5px] text-foreground">Clawbacks — negative balances</strong>
              <span className="text-xs text-muted-foreground">Total owed: <span className="font-semibold tabular-nums text-destructive">{money(clawbacks.totalOwedCents, c)}</span></span>
            </div>
            <p className="px-5 pt-3 text-xs text-muted-foreground">Auto-offset from future earnings. These members owe a balance after a post-payout reversal.</p>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Member</Th>
                  <Th className="text-right">Owed</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clawbacks.members.map((m) => (
                  <TableRow key={m.membershipId} className="hover:bg-transparent">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={m.name} />
                        <div>
                          <div className="font-medium text-foreground">{m.name}</div>
                          <div className="font-mono text-[11px] text-muted-foreground/70">{m.referralCode}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-destructive">{money(m.owedCents, c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ---- fraud inceleme kuyrugu ---- */}
      {fraud.length > 0 && (
        <Card className="mt-4 border-destructive/30 shadow-lg">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <strong className="text-[13.5px] text-foreground">Fraud review</strong>
              <Badge variant="destructive">{fraud.length}</Badge>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Member</Th>
                  <Th>Score</Th>
                  <Th>Signals</Th>
                  <Th className="text-right print:hidden">Decision</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fraud.map((f) => (
                  <TableRow key={f.membershipId} className="hover:bg-transparent">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={f.fullName} />
                        <div>
                          <div className="font-medium text-foreground">{f.fullName}</div>
                          <div className="font-mono text-[11px] text-muted-foreground/70">{f.referralCode}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        style={f.blocked ? undefined : toneStyle('amber')}
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums ${f.blocked ? 'border-destructive/30 bg-destructive/10 text-destructive' : ''}`}
                      >
                        {f.score}{f.blocked ? ' · blocked' : ''}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{f.reasons.join(', ')}</TableCell>
                    <TableCell className="text-right print:hidden">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" style={successBtnStyle} disabled={busyId === f.membershipId} onClick={() => decideFraud(f.membershipId, 'clear')}>Clear</Button>
                        <Button size="sm" variant="destructive" disabled={busyId === f.membershipId} onClick={() => decideFraud(f.membershipId, 'confirm')}>Confirm</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ---- KYC inceleme kuyrugu ---- */}
      {kyc.length > 0 && (
        <Card className="mt-4 border-primary/30 shadow-lg">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <strong className="text-[13.5px] text-foreground">Payout profiles to review</strong>
              <Badge className="border-transparent bg-primary/15 text-primary">{kyc.length}</Badge>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Member</Th>
                  <Th>Legal name</Th>
                  <Th>Tax ID</Th>
                  <Th>Bank</Th>
                  <Th className="text-right print:hidden">Decision</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kyc.map((k) => (
                  <TableRow key={k.membershipId} className="hover:bg-transparent">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={k.fullName} />
                        <div>
                          <div className="font-medium text-foreground">{k.fullName}</div>
                          <div className="font-mono text-[11px] text-muted-foreground/70">{k.referralCode}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground">
                      {k.legalName}
                      {k.sanctionsHit && <Badge variant="destructive" className="ml-2">⚠ sanctions</Badge>}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{k.taxIdType.toUpperCase()} ••••{k.taxIdLast4}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{k.bankName ? `${k.bankName} · ` : ''}{k.accountType} ••••{k.accountLast4} · {k.routingNumber}</TableCell>
                    <TableCell className="text-right print:hidden">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" style={successBtnStyle} disabled={busyId === k.membershipId} onClick={() => decideKyc(k.membershipId, 'verify')}>Verify</Button>
                        <Button size="sm" variant="destructive" disabled={busyId === k.membershipId} onClick={() => decideKyc(k.membershipId, 'reject')}>Reject</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ---- odenebilir uyeler (secimli odeme) ---- */}
      <Card className="mt-4 shadow-lg">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <strong className="text-[13.5px] text-foreground">{t('payouts.payable')}</strong>
            {payable && payable.members.length > 0 ? (
              selected.size > 0 ? (
                <Button size="sm" className="print:hidden" disabled={busy} onClick={() => setConfirmRun('selected')}>
                  Pay selected ({selected.size}) · {money(selTotal, c)}
                </Button>
              ) : (
                <button className="text-xs font-semibold text-primary hover:underline print:hidden" onClick={toggleAll}>Select all</button>
              )
            ) : null}
          </div>
          {!payable ? <div className="p-5"><Loading rows={2} /></div> : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th className="w-[34px] print:hidden">
                    <input type="checkbox" className="accent-primary" checked={selected.size > 0 && selected.size === payable.members.length} onChange={toggleAll} aria-label="Select all" />
                  </Th>
                  <Th>Member</Th>
                  <Th>Code</Th>
                  <Th className="text-right">Sold (mo)</Th>
                  <Th className="text-right">Net payable</Th>
                  <Th className="text-right">Eff. %</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payable.members.map((m) => (
                  <TableRow key={m.membershipId} data-state={selected.has(m.membershipId) ? 'selected' : undefined}>
                    <TableCell className="print:hidden">
                      <input type="checkbox" className="accent-primary" checked={selected.has(m.membershipId)} onChange={() => toggle(m.membershipId)} aria-label={`Select ${m.fullName}`} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={m.fullName} />
                        <span className="font-medium text-foreground">{m.fullName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground/70">{m.referralCode}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{Number(m.soldThisMonthCents) > 0 ? money(m.soldThisMonthCents, c) : '—'}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums" style={{ color: 'var(--emerald)' }}>{money(m.netCents, c)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground/70">{Number(m.soldThisMonthCents) > 0 ? `%${((Number(m.netCents) / Number(m.soldThisMonthCents)) * 100).toFixed(1)}` : '—'}</TableCell>
                  </TableRow>
                ))}
                {payable.members.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No members above the threshold.</TableCell>
                  </TableRow>
                )}
              </TableBody>
              {payable.members.length > 0 && (
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="print:hidden" />
                    <TableCell colSpan={3} className="font-semibold text-foreground">
                      {selected.size > 0 ? `${selected.size} selected` : `${payable.members.length} members`}
                    </TableCell>
                    <TableCell className="text-right font-display font-extrabold tabular-nums text-primary">
                      {money(String(selected.size > 0 ? selTotal : totalPayable), c)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---- gecmis (filtreli + sayfali) ---- */}
      <Card className="mt-4 shadow-lg">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <strong className="text-[13.5px] text-foreground">{t('payouts.history')}{history ? ` · ${history.total}` : ''}</strong>
            <div className="flex gap-2 print:hidden">
              <Input type="month" value={hPeriod} onChange={(e) => { setHPeriod(e.target.value); setHPage(1); }} aria-label="Period" className="h-8 w-auto text-xs" />
              <select
                value={hStatus}
                onChange={(e) => { setHStatus(e.target.value); setHPage(1); }}
                aria-label="Status"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {HISTORY_STATUS.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
              </select>
            </div>
          </div>
          {!history ? <div className="p-5"><Loading rows={2} /></div> : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Member</Th>
                  <Th>Amount</Th>
                  <Th>Method</Th>
                  <Th>Status</Th>
                  <Th>Period</Th>
                  <Th>Date</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.items.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setDetailId(p.id)}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={p.fullName} />
                        <div>
                          <div className="font-medium text-foreground">{p.fullName}</div>
                          <div className="font-mono text-[11px] text-muted-foreground/70">{p.referralCode}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums text-foreground">{money(p.totalCents, c)}</TableCell>
                    <TableCell className="text-muted-foreground">{p.method}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StatusPill status={p.status} />
                        {p.clearedAt ? (
                          <span style={toneStyle('emerald')} className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold" title={p.bankRef ? `Bank ref: ${p.bankRef}` : 'Bank reconciled'}><span aria-hidden>✓</span>&nbsp;cleared</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.period}</TableCell>
                    <TableCell className="text-muted-foreground/70">{dateShort(p.paidAt)}</TableCell>
                  </TableRow>
                ))}
                {history.items.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No payouts match these filters.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          {history && <div className="px-5 py-3"><Pagination page={history.page} pageSize={history.pageSize} total={history.total} onPage={setHPage} /></div>}
        </CardContent>
      </Card>

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
          <div className="w-[min(440px,88vw)]">
            <p className="mt-0 text-sm text-muted-foreground">
              {decide.action === 'approve'
                ? `Approve ${decide.p.fullName}'s request for ${money(decide.p.totalCents, c)}? Linked balance is marked paid.`
                : `Reject ${decide.p.fullName}'s request? Their payable balance is returned and the request is closed.`}
            </p>
            <div className="mt-3.5">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{decide.action === 'approve' ? 'Bank / transfer reference (optional)' : 'Reason (optional)'}</label>
              <Input aria-label={decide.action === 'approve' ? 'Bank or transfer reference' : 'Reason'} value={decideRef} onChange={(e) => setDecideRef(e.target.value)} placeholder={decide.action === 'approve' ? 'e.g. ACH-20260613-001' : 'e.g. invalid bank details'} autoFocus />
            </div>
            <div className="mt-3.5 flex justify-end gap-2.5">
              <Button variant="ghost" onClick={() => setDecide(null)} disabled={busy}>Cancel</Button>
              <Button
                style={decide.action === 'reject' ? undefined : successBtnStyle}
                variant={decide.action === 'reject' ? 'destructive' : 'default'}
                onClick={submitDecide}
                disabled={busy}
              >
                {busy ? '…' : decide.action === 'approve' ? 'Approve & mark paid' : 'Reject'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {detailId && <PayoutDrawer id={detailId} currency={c} onClose={() => setDetailId(null)} onChanged={refreshAll} onToast={showToast} />}

      {reasonModal && (
        <Modal title={reasonModal.title} onClose={() => setReasonModal(null)}>
          <div className="w-[min(420px,100%)]">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{reasonModal.label}</label>
              <textarea
                aria-label={reasonModal.label}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                rows={2}
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="mt-1 flex justify-end gap-2.5">
              <Button variant="ghost" onClick={() => setReasonModal(null)} disabled={busy}>Cancel</Button>
              <Button disabled={busy} onClick={async () => { setBusy(true); try { await reasonModal.run(reasonText); setReasonModal(null); } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); } }}>Confirm</Button>
            </div>
          </div>
        </Modal>
      )}

      {reconcileOpen && (
        <Modal title="Bank reconciliation" onClose={() => setReconcileOpen(false)}>
          <div className="w-[min(520px,100%)]">
            <p className="mt-0 text-sm text-muted-foreground">
              After the bank processes the ACH file and sends the money, paste the returned statement here.
              Each line is <strong>amount</strong> (e.g. <code className="rounded bg-muted px-1 py-0.5 text-xs">1500.00</code>) or <strong>amount,reference</strong> (e.g. <code className="rounded bg-muted px-1 py-0.5 text-xs">1500.00,ACH-001</code>).
              We match by amount against paid payouts and mark them <em>cleared</em>.
            </p>
            <div className="mt-3.5">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Statement lines</label>
              <textarea
                aria-label="Bank statement lines"
                value={reconcileText}
                onChange={(e) => setReconcileText(e.target.value)}
                rows={6}
                placeholder={'1500.00,ACH-20260613-001\n2250.50\n980.00,WIRE-77'}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            {reconcileResult && (
              <div className="mt-3 rounded-lg border border-border bg-muted p-3 text-sm">
                <div className="flex items-center justify-between"><span style={{ color: 'var(--emerald)' }}><span aria-hidden>✓</span> Cleared</span><strong className="tabular-nums text-foreground">{reconcileResult.clearedCount}</strong></div>
                <div className="mt-1 flex items-center justify-between"><span className="text-muted-foreground">Unmatched lines</span><strong className="tabular-nums text-foreground">{reconcileResult.unmatched.length}</strong></div>
                <div className="mt-1 flex items-center justify-between"><span className="text-muted-foreground/70">Still uncleared payouts</span><span className="tabular-nums text-muted-foreground/70">{reconcileResult.remainingUncleared}</span></div>
                {reconcileResult.unmatched.length > 0 && (
                  <div className="mt-1.5 text-xs text-muted-foreground/70">
                    Unmatched: {reconcileResult.unmatched.map((u) => money(String(u.amountCents), c)).join(', ')}
                  </div>
                )}
              </div>
            )}
            <div className="mt-3.5 flex justify-end gap-2.5">
              <Button variant="ghost" onClick={() => setReconcileOpen(false)} disabled={busy}>Close</Button>
              <Button onClick={runReconcile} disabled={busy || !reconcileText.trim()}>{busy ? 'Matching…' : <><span aria-hidden>⇄</span> Match</>}</Button>
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
          <Button variant="outline" onClick={() => setPrinting(true)}><span aria-hidden>🖶</span> Print slip</Button>
          {d.status === 'failed' && <Button disabled={busy} onClick={() => setConfirmRetry(true)}>Retry</Button>}
        </>
      )}
    >
      {err && <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
      {!d ? <Loading rows={4} /> : (
        <div className="grid gap-4">
          <div><StatusPill status={d.status} /></div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Member" value={`${d.member.fullName} · ${d.member.referralCode}`} />
            <Field label="Email" value={d.member.email} />
            <Field label="Method" value={d.method} />
            <Field label="Reference" value={d.ref ?? '—'} />
            <Field label="Period" value={d.period} />
            <Field label="Paid at" value={d.paidAt ? dateShort(d.paidAt) : '—'} />
          </div>
          <div>
            <strong className="mb-2 block text-[13px] text-foreground">Included commission lines ({d.lines.length})</strong>
            {d.lines.length === 0 ? <div className="text-[13px] text-muted-foreground">No linked ledger lines (balance was returned).</div> : (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <Th>Lvl</Th>
                      <Th>Type</Th>
                      <Th>Date</Th>
                      <Th className="text-right">Amount</Th>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.lines.map((l) => (
                      <TableRow key={l.id} className="hover:bg-transparent">
                        <TableCell className="tabular-nums text-foreground">{l.level}</TableCell>
                        <TableCell className="text-muted-foreground">{l.type}</TableCell>
                        <TableCell className="text-muted-foreground/70">{dateShort(l.createdAt)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${l.type === 'reversal' ? 'text-destructive' : 'text-foreground'}`}>{money(l.amountCents, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
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
      <div className="text-[11px] text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 break-words text-[13.5px] text-foreground">{value}</div>
    </div>
  );
}
