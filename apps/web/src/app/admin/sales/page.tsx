'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { ColumnsMenu, Confirm, Loading, Modal, Pagination, SortableTh, SortDir, StatCard, MoneyCounter, TableColumn, useTablePrefs, useToast } from '@/components/ui';
import { Drawer } from '@/components/Drawer';
import { Popover } from '@/components/Popover';
import { ImportWizard } from '@/components/ImportWizard';
import { useLiveRefresh } from '@/components/LiveIndicator';
import { PrintSheet, PrintHeader, PrintSignatures } from '@/components/PrintSheet';
import { activeMembership, getSession } from '@/lib/auth';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface SaleItem {
  id: string;
  amountCents: string;
  currency: string;
  status: 'draft' | 'approved' | 'void';
  saleDate: string;
  deliveredAt: string | null;
  customerRef: string | null;
  sellerReferralCode: string;
  sellerName: string;
  selfSubmitted: boolean;
}
interface SalesList { total: number; page: number; pageSize: number; items: SaleItem[] }
interface Summary {
  currency: string;
  count: number;
  sumCents: string;
  avgCents: string;
  deliveredCount: number;
  byStatus: Record<'draft' | 'approved' | 'void', { count: number; amountCents: string }>;
}
type Pending = { ids: string[]; action: 'approve' | 'void' | 'delete' | 'deliver' };

interface Filters { status: string; q: string; from: string; to: string; minCents: string; maxCents: string }
const EMPTY: Filters = { status: '', q: '', from: '', to: '', minCents: '', maxCents: '' };
const STATUSES = ['', 'draft', 'approved', 'void'] as const;

// Kayitli gorunum (API): config = filtreler + siralama. shared=ekip gorur.
interface ViewConfig extends Filters { sort?: string; dir?: SortDir }
interface SavedView { id: string; name: string; shared: boolean; config: ViewConfig; mine: boolean; ownerName: string | null }

const SALE_COLUMNS: TableColumn[] = [
  { key: 'seller', label: 'Seller', locked: true },
  { key: 'amount', label: 'Amount' },
  { key: 'customer', label: 'Customer' },
  { key: 'status', label: 'Status' },
  { key: 'date', label: 'Date' },
];

/* tarih cipleri icin yerel gun anahtari (YYYY-MM-DD) */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
type ChipKey = 'today' | '7d' | 'month' | 'lastMonth';
function chipRange(key: ChipKey): { from: string; to: string } {
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1); // ust sinir dahil olsun
  if (key === 'today') return { from: ymd(now), to: ymd(tomorrow) };
  if (key === '7d') { const f = new Date(now); f.setDate(now.getDate() - 6); return { from: ymd(f), to: ymd(tomorrow) }; }
  if (key === 'month') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(tomorrow) };
  // lastMonth
  return {
    from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    to: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
  };
}

export default function SalesPage() {
  const [list, setList] = useState<SalesList | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState('saleDate');
  const [dir, setDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewShared, setViewShared] = useState(false);
  const cols = useTablePrefs('sales', SALE_COLUMNS);
  const colCount = 1 + SALE_COLUMNS.filter((c) => cols.isVisible(c.key)).length + 1; // checkbox + gorunur + actions

  const loadViews = useCallback(async () => {
    try { setViews(await api.get<SavedView[]>('/admin/views?target=sales')); } catch { /* yok say */ }
  }, []);
  useEffect(() => { void loadViews(); }, [loadViews]);

  // filtreler (page'siz) — summary + export ile paylasilan param seti
  const filterQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.status) p.set('status', filters.status);
    if (filters.q.trim()) p.set('q', filters.q.trim());
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    if (filters.minCents) p.set('minCents', filters.minCents);
    if (filters.maxCents) p.set('maxCents', filters.maxCents);
    return p.toString();
  }, [filters]);

  const listQuery = useMemo(() => {
    const p = new URLSearchParams(filterQuery);
    p.set('sort', sort); p.set('dir', dir);
    p.set('page', String(page)); p.set('pageSize', String(pageSize));
    return p.toString();
  }, [filterQuery, sort, dir, page, pageSize]);

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([
        api.get<SalesList>(`/admin/sales?${listQuery}`),
        api.get<Summary>(`/admin/sales/summary${filterQuery ? `?${filterQuery}` : ''}`),
      ]);
      setList(l); setSummary(s); setSelected(new Set());
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [listQuery, filterQuery]);

  // filtre/siralama/sayfa degisiminde debounce'lu yenile
  useEffect(() => {
    const id = setTimeout(() => void load(), 250);
    return () => clearTimeout(id);
  }, [load]);

  // canli: baska bir uye/admin satis girdiginde/onayladiginda liste kendiliginden tazelenir
  useLiveRefresh(() => void load(), ['sale.created', 'sale.approved']);

  // filtre degisince ilk sayfaya don
  function patchFilters(f: Filters) { setFilters(f); setPage(1); }
  function onSort(field: string, d: SortDir) { setSort(field); setDir(d); setPage(1); }

  const activeChip = useMemo<ChipKey | null>(() => {
    for (const k of ['today', '7d', 'month', 'lastMonth'] as ChipKey[]) {
      const r = chipRange(k);
      if (filters.from === r.from && filters.to === r.to) return k;
    }
    return null;
  }, [filters.from, filters.to]);
  function toggleChip(k: ChipKey) {
    if (activeChip === k) patchFilters({ ...filters, from: '', to: '' });
    else { const r = chipRange(k); patchFilters({ ...filters, from: r.from, to: r.to }); }
  }

  async function createSale(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const cents = Number(amount);
      if (!Number.isInteger(cents) || cents < 1) { setError('Tutar pozitif tam sayı (cent) olmalı'); setBusy(false); return; }
      await api.post('/admin/sales', { sellerReferralCode: code.trim(), amountCents: cents });
      setCode(''); setAmount(''); setShowNew(false);
      showToast('Sale created (draft)');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function act(p: Pending) {
    setBusy(true);
    try {
      if (p.ids.length === 1 && (p.action === 'approve' || p.action === 'void')) {
        await api.post(`/admin/sales/${p.ids[0]}/${p.action}`);
        showToast(p.action === 'approve' ? 'Approved, commissions distributed ✓' : 'Voided');
      } else if (p.ids.length === 1 && p.action === 'delete') {
        await api.del(`/admin/sales/${p.ids[0]}`);
        showToast('Draft deleted');
      } else {
        const res = await api.post<{ succeeded: number; failed: { id: string; reason: string }[] }>('/admin/sales/bulk', { action: p.action, ids: p.ids });
        showToast(`${res.succeeded} ${p.action}${p.action === 'delete' ? 'd' : p.action === 'deliver' ? 'ed' : 'd'}${res.failed.length ? `, ${res.failed.length} skipped` : ''}`);
      }
      setConfirm(null);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function deliver(id: string) {
    try { await api.post(`/admin/sales/${id}/deliver`, {}); showToast('Marked as delivered'); await load(); }
    catch (e) { setError(String((e as ApiError).message)); }
  }

  async function exportCsv() {
    try { await downloadCsv(`/admin/sales/export.csv${filterQuery ? `?${filterQuery}` : ''}`, 'sales.csv'); }
    catch (e) { setError(String((e as ApiError).message)); }
  }

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    if (!list) return;
    setSelected((prev) => prev.size === list.items.length ? new Set() : new Set(list.items.map((s) => s.id)));
  }

  function applyView(v: SavedView) {
    const { sort: s, dir: d, ...f } = v.config;
    setFilters({ status: f.status ?? '', q: f.q ?? '', from: f.from ?? '', to: f.to ?? '', minCents: f.minCents ?? '', maxCents: f.maxCents ?? '' });
    if (s) setSort(s);
    if (d) setDir(d);
    setPage(1);
  }
  async function saveView(e: FormEvent) {
    e.preventDefault();
    if (!viewName.trim()) return;
    try {
      await api.post('/admin/views', { target: 'sales', name: viewName.trim(), shared: viewShared, config: { ...filters, sort, dir } });
      setShowSaveView(false); setViewName(''); setViewShared(false);
      showToast(viewShared ? 'View shared with the team' : 'View saved');
      await loadViews();
    } catch (e) { setError(String((e as ApiError).message)); }
  }
  async function deleteView(id: string) {
    try { await api.del(`/admin/views/${id}`); await loadViews(); }
    catch (e) { setError(String((e as ApiError).message)); }
  }

  const selDrafts = useMemo(() => list?.items.filter((s) => selected.has(s.id) && s.status === 'draft').map((s) => s.id) ?? [], [list, selected]);
  const selVoidable = useMemo(() => list?.items.filter((s) => selected.has(s.id) && s.status !== 'void').map((s) => s.id) ?? [], [list, selected]);
  const selDeliverable = useMemo(() => list?.items.filter((s) => selected.has(s.id) && s.status === 'approved' && !s.deliveredAt).map((s) => s.id) ?? [], [list, selected]);
  const activeFilters = filters.status || filters.q || filters.from || filters.to || filters.minCents || filters.maxCents;
  const advCount = [filters.status, filters.from, filters.to, filters.minCents, filters.maxCents].filter(Boolean).length;
  const cur = summary?.currency ?? 'USD';

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">{t('nav.sales')}</div>
          <h1 className="h1 fade-in">Sales Management</h1>
        </div>
        <div className="row fade-in no-print" style={{ gap: 8 }}>
          <button className="btn ghost" onClick={exportCsv}>⇩ Export CSV</button>
          <button className="btn ghost" onClick={() => window.print()}>🖶 Print</button>
          <button className="btn ghost" onClick={() => setShowImport(true)}>⇪ Import</button>
          <button className="btn" onClick={() => setShowNew(true)}>＋ New sale</button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {/* ---- KPI seridi ---- */}
      <div className="stat-grid fade-in delay-1" style={{ margin: '16px 0' }}>
        <StatCard label="Revenue (approved)" icon="◆" grad="color-mix(in srgb, var(--emerald) 22%, transparent)"
          value={summary ? <MoneyCounter cents={summary.byStatus.approved.amountCents} currency={cur} /> : '—'}
          hint={summary ? `${summary.byStatus.approved.count} approved sales` : undefined} />
        <StatCard label="Awaiting approval" icon="◷"
          value={summary ? summary.byStatus.draft.count : '—'}
          hint={summary ? money(summary.byStatus.draft.amountCents, cur) : undefined} />
        <StatCard label="Average sale" icon="∑"
          value={summary ? <MoneyCounter cents={summary.avgCents} currency={cur} /> : '—'}
          hint={summary ? `${summary.count} sales in view` : undefined} />
        <StatCard label="Voided" icon="⊘"
          value={summary ? summary.byStatus.void.count : '—'}
          hint={summary ? money(summary.byStatus.void.amountCents, cur) : undefined} />
      </div>

      {/* ---- arac cubugu: ara + hizli tarih + filtreler + kayitli gorunumler ---- */}
      <div className="row fade-in delay-1 no-print" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '14px 0' }}>
        <input value={filters.q} onChange={(e) => patchFilters({ ...filters, q: e.target.value })}
          placeholder="🔍  Search seller, code, customer…" style={{ flex: 1, minWidth: 200, maxWidth: 320 }} />

        <div className="seg-tabs">
          {([['today', 'Today'], ['7d', '7 days'], ['month', 'This month'], ['lastMonth', 'Last month']] as [ChipKey, string][]).map(([k, lbl]) => (
            <button key={k} className={`seg-tab ${activeChip === k ? 'on' : ''}`} onClick={() => toggleChip(k)}>{lbl}</button>
          ))}
        </div>

        <Popover label={<>Filters</>} badge={advCount} width={300}>
          {(close) => (
            <div className="grid" style={{ gap: 12 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Status</label>
                <select value={filters.status} onChange={(e) => patchFilters({ ...filters, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
                </select>
              </div>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field" style={{ margin: 0 }}><label>From</label><input type="date" value={filters.from} onChange={(e) => patchFilters({ ...filters, from: e.target.value })} /></div>
                <div className="field" style={{ margin: 0 }}><label>To</label><input type="date" value={filters.to} onChange={(e) => patchFilters({ ...filters, to: e.target.value })} /></div>
                <div className="field" style={{ margin: 0 }}><label>Min (cents)</label><input type="number" min={0} step={1} value={filters.minCents} onChange={(e) => patchFilters({ ...filters, minCents: e.target.value })} placeholder="cents" /></div>
                <div className="field" style={{ margin: 0 }}><label>Max (cents)</label><input type="number" min={0} step={1} value={filters.maxCents} onChange={(e) => patchFilters({ ...filters, maxCents: e.target.value })} placeholder="cents" /></div>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button className="btn ghost sm" onClick={() => patchFilters({ ...EMPTY, q: filters.q })}>Reset</button>
                <button className="btn sm" onClick={close}>Done</button>
              </div>
            </div>
          )}
        </Popover>

        {views.map((v) => (
          <span key={v.id} className="row" style={{ gap: 3 }}>
            <button className="btn ghost sm" onClick={() => applyView(v)} title={v.mine ? undefined : `Shared by ${v.ownerName ?? 'team'}`}>
              {v.shared && <span style={{ marginRight: 3 }}>👥</span>}{v.name}
            </button>
            {v.mine && <button className="faint" onClick={() => deleteView(v.id)} aria-label={`Delete ${v.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>✕</button>}
          </span>
        ))}

        <span style={{ flex: 1 }} />
        <ColumnsMenu prefs={cols} />
        {activeFilters && <button className="btn ghost sm" onClick={() => patchFilters(EMPTY)}>Clear</button>}
        <button className="btn ghost sm" onClick={() => { setViewName(''); setViewShared(false); setShowSaveView(true); }}>＋ Save view</button>
      </div>

      {/* ---- tablo ---- */}
      <div className="card fade-in delay-2">
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong>Sales{list ? ` · ${list.total}` : ''}</strong>
          <select className="no-print" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ width: 'auto' }} aria-label="Rows per page">
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </div>
        {!list ? <Loading rows={3} /> : (
          <table className={cols.density === 'compact' ? 'dense' : undefined}>
            <thead>
              <tr>
                <th className="no-print" style={{ width: 30 }}><input type="checkbox" checked={selected.size > 0 && selected.size === list.items.length} onChange={toggleAll} aria-label="Select all" /></th>
                {cols.isVisible('seller') && <th>Seller</th>}
                {cols.isVisible('amount') && <SortableTh label="Amount" field="amountCents" sort={sort} dir={dir} onSort={onSort} />}
                {cols.isVisible('customer') && <th>Customer</th>}
                {cols.isVisible('status') && <SortableTh label={t('sales.status')} field="status" sort={sort} dir={dir} onSort={onSort} />}
                {cols.isVisible('date') && <SortableTh label="Date" field="saleDate" sort={sort} dir={dir} onSort={onSort} />}
                <th className="no-print" style={{ textAlign: 'right' }}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((s) => (
                <tr key={s.id} style={{ cursor: 'pointer', background: selected.has(s.id) ? 'var(--panel-2)' : undefined }} onClick={() => setDetailId(s.id)}>
                  <td className="no-print" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.sellerName}`} />
                  </td>
                  {cols.isVisible('seller') && (
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        {s.sellerName}
                        {s.selfSubmitted && <span className="badge pending" title="Submitted by member">self</span>}
                      </span>
                      <div className="faint" style={{ fontSize: 12 }}>{s.sellerReferralCode}</div>
                    </td>
                  )}
                  {cols.isVisible('amount') && <td className="tnum" style={{ fontWeight: 650 }}>{money(s.amountCents, s.currency)}</td>}
                  {cols.isVisible('customer') && <td className="muted" style={{ fontSize: 12.5 }}>{s.customerRef || '—'}</td>}
                  {cols.isVisible('status') && (
                    <td>
                      <span className={`badge ${s.status}`}>{s.status}</span>
                      {s.deliveredAt && <span className="badge active" style={{ marginLeft: 6 }}>✓ delivered</span>}
                    </td>
                  )}
                  {cols.isVisible('date') && <td className="muted">{dateShort(s.saleDate)}</td>}
                  <td className="no-print" onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {s.status === 'draft' && <button className="btn sm" onClick={() => setConfirm({ ids: [s.id], action: 'approve' })}>{t('sales.approve')}</button>}
                      {s.status === 'approved' && !s.deliveredAt && <button className="btn sm ghost" onClick={() => deliver(s.id)}>{t('sales.deliver')}</button>}
                      {s.status === 'draft' && <button className="btn sm ghost danger" onClick={() => setConfirm({ ids: [s.id], action: 'delete' })} aria-label="Delete draft">🗑</button>}
                      {s.status !== 'void' && <button className="btn sm danger" onClick={() => setConfirm({ ids: [s.id], action: 'void' })}>{t('sales.void')}</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {list.items.length === 0 && <tr><td colSpan={colCount} className="muted">No sales match these filters.</td></tr>}
            </tbody>
            {summary && summary.count > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={colCount} className="faint" style={{ fontSize: 12 }}>
                    {summary.count} sales in view · <b className="tnum">{money(summary.sumCents, cur)}</b> · {summary.deliveredCount} delivered
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        )}

        {list && <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={setPage} />}

        {selected.size > 0 && (
          <div className="bulkbar no-print">
            <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
            <span style={{ flex: 1 }} />
            <button className="btn sm" disabled={selDrafts.length === 0} onClick={() => setConfirm({ ids: selDrafts, action: 'approve' })}>Approve {selDrafts.length || ''}</button>
            <button className="btn sm ghost" disabled={selDeliverable.length === 0} onClick={() => setConfirm({ ids: selDeliverable, action: 'deliver' })}>Deliver {selDeliverable.length || ''}</button>
            <button className="btn sm danger" disabled={selVoidable.length === 0} onClick={() => setConfirm({ ids: selVoidable, action: 'void' })}>Void {selVoidable.length || ''}</button>
            <button className="btn sm ghost danger" disabled={selDrafts.length === 0} onClick={() => setConfirm({ ids: selDrafts, action: 'delete' })}>Delete {selDrafts.length || ''}</button>
            <button className="btn ghost sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      {confirm && (
        <Confirm
          title={
            confirm.action === 'approve' ? `Approve ${confirm.ids.length} sale${confirm.ids.length > 1 ? 's' : ''}`
            : confirm.action === 'void' ? `Void ${confirm.ids.length} sale${confirm.ids.length > 1 ? 's' : ''}`
            : confirm.action === 'deliver' ? `Mark ${confirm.ids.length} as delivered`
            : `Delete ${confirm.ids.length} draft${confirm.ids.length > 1 ? 's' : ''}`
          }
          message={
            confirm.action === 'approve' ? 'On approval, commissions are distributed across the tree. This cannot be undone.'
            : confirm.action === 'void' ? 'Voiding creates reversing entries and reduces balances.'
            : confirm.action === 'deliver' ? 'Marks the selected approved sales as delivered.'
            : 'Drafts are permanently deleted. Approved sales can only be voided, not deleted.'
          }
          confirmLabel={confirm.action === 'approve' ? t('sales.approve') : confirm.action === 'void' ? t('sales.void') : confirm.action === 'deliver' ? t('sales.deliver') : 'Delete'}
          danger={confirm.action === 'void' || confirm.action === 'delete'}
          busy={busy}
          onConfirm={() => act(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}

      {showNew && (
        <Modal title="Record a sale" onClose={() => setShowNew(false)}>
          <form onSubmit={createSale} style={{ width: 'min(420px, 88vw)' }}>
            <div className="field"><label>{t('sales.seller')}</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ALICE1" required autoFocus /></div>
            <div className="field"><label>{t('sales.amount')} (cents)</label><input type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000000" required /></div>
            <div className="faint" style={{ fontSize: 12 }}>e.g. $100,000 = 10000000</div>
            {error && <div className="error">{error}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn ghost" onClick={() => setShowNew(false)} disabled={busy}>Cancel</button>
              <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Create draft'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showSaveView && (
        <Modal title="Save view" onClose={() => setShowSaveView(false)}>
          <form onSubmit={saveView} style={{ width: 'min(380px, 88vw)' }}>
            <div className="field"><label>View name</label><input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="e.g. Awaiting approval" required autoFocus /></div>
            <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={viewShared} onChange={(e) => setViewShared(e.target.checked)} style={{ width: 'auto' }} />
              Share with the whole team
            </label>
            <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Saves the current filters and sorting. {viewShared ? 'Everyone on your team will see this view.' : 'Only you will see this view.'}</div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn ghost" onClick={() => setShowSaveView(false)}>Cancel</button>
              <button className="btn">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {showImport && <ImportWizard onClose={() => setShowImport(false)} onDone={(n) => { setShowImport(false); showToast(`${n} sales imported`); void load(); }} />}

      {detailId && <SaleDrawer id={detailId} onClose={() => setDetailId(null)} onChanged={load} onToast={showToast} />}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* --------------------------------------------------- satis detay cekmecesi */
interface LedgerLine { id: string; level: number; type: string; status: string; rateBpsUsed: number; amountCents: string; beneficiaryName: string; beneficiaryCode: string }
interface SaleDetail extends SaleItem {
  sellerEmail: string;
  createdAt: string;
  createdByName?: string | null;
  approvedByName?: string | null;
  externalRef?: string | null;
  ledger: LedgerLine[];
}

function SaleDrawer({ id, onClose, onChanged, onToast }: { id: string; onClose: () => void; onChanged: () => void; onToast: (m: string) => void }) {
  const [d, setD] = useState<SaleDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const session = getSession();
  const tenantName = (session ? activeMembership(session)?.tenantName : null) ?? 'Refearn';

  const load = useCallback(() => {
    api.get<SaleDetail>(`/admin/sales/${id}`).then(setD).catch((e) => setErr(String((e as ApiError).message)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function action(a: 'approve' | 'void' | 'deliver') {
    setBusy(true);
    try {
      await api.post(`/admin/sales/${id}/${a}`, a === 'deliver' ? {} : undefined);
      onToast(a === 'approve' ? 'Approved ✓' : a === 'void' ? 'Voided' : 'Delivered');
      load(); onChanged();
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.del(`/admin/sales/${id}`); onToast('Draft deleted'); onChanged(); onClose(); }
    catch (e) { setErr(String((e as ApiError).message)); setBusy(false); }
  }

  const totalCommission = d?.ledger.filter((l) => l.type === 'commission').reduce((a, l) => a + Number(l.amountCents), 0) ?? 0;

  return (
    <Drawer
      title={d ? money(d.amountCents, d.currency) : 'Sale'}
      subtitle={d ? `${d.sellerName} · ${d.sellerReferralCode}` : undefined}
      onClose={onClose}
      footer={d && (
        <>
          <button className="btn ghost" disabled={busy} onClick={() => setPrinting(true)}>🖶 Print receipt</button>
          {d.status === 'draft' && <button className="btn" disabled={busy} onClick={() => action('approve')}>Approve</button>}
          {d.status === 'approved' && !d.deliveredAt && <button className="btn ghost" disabled={busy} onClick={() => action('deliver')}>Mark delivered</button>}
          {d.status === 'draft' && <button className="btn ghost danger" disabled={busy} onClick={() => setConfirmDel(true)}>Delete</button>}
          {d.status !== 'void' && <button className="btn danger" disabled={busy} onClick={() => action('void')}>Void</button>}
        </>
      )}
    >
      {err && <div className="error">{err}</div>}
      {!d ? <Loading rows={4} /> : (
        <div className="grid" style={{ gap: 18 }}>
          <div>
            <span className={`badge ${d.status}`}>{d.status}</span>
            {d.deliveredAt && <span className="badge active" style={{ marginLeft: 6 }}>delivered</span>}
            {d.selfSubmitted && <span className="badge pending" style={{ marginLeft: 6 }}>self-submitted</span>}
          </div>
          <Field label="Seller" value={`${d.sellerName} · ${d.sellerEmail}`} />
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Sale date" value={dateShort(d.saleDate)} />
            <Field label="Recorded" value={dateShort(d.createdAt)} />
            <Field label="Entered by" value={d.createdByName || '—'} />
            <Field label="Approved by" value={d.approvedByName || '—'} />
            <Field label="Customer ref" value={d.customerRef || '—'} />
            <Field label="External ref" value={d.externalRef || '—'} />
          </div>

          <div>
            <div className="spread" style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>Commission distribution</strong>
              {totalCommission > 0 && <span className="tnum faint" style={{ fontSize: 12 }}>{money(totalCommission, d.currency)} total</span>}
            </div>
            {d.ledger.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No commissions yet — approve to distribute.</div>
            ) : (
              <table>
                <thead><tr><th>Lvl</th><th>Beneficiary</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {d.ledger.map((l) => (
                    <tr key={l.id}>
                      <td className="tnum">{l.level}</td>
                      <td>{l.beneficiaryName}<div className="faint" style={{ fontSize: 11 }}>{l.beneficiaryCode}</div></td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{(l.rateBpsUsed / 100).toFixed(2)}%</td>
                      <td className="tnum" style={{ textAlign: 'right', color: l.type === 'reversal' ? 'var(--rose)' : undefined }}>{money(l.amountCents, d.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {confirmDel && d && (
        <Confirm
          title="Delete draft"
          message="This draft sale will be permanently deleted. This cannot be undone."
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setConfirmDel(false)}
        />
      )}

      {printing && d && (
        <PrintSheet onDone={() => setPrinting(false)}>
          <PrintHeader tenantName={tenantName} title="Sale Receipt" subtitle={`Ref: ${d.id}`} />
          <table style={{ marginBottom: 18 }}>
            <tbody>
              <tr><td style={{ fontWeight: 700, width: 160 }}>Seller</td><td>{d.sellerName} ({d.sellerReferralCode})</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Sale date</td><td>{dateShort(d.saleDate)}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Customer</td><td>{d.customerRef || '—'}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Status</td><td>{d.status}{d.deliveredAt ? ' · delivered' : ''}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Amount</td><td style={{ fontWeight: 800, fontSize: 16 }}>{money(d.amountCents, d.currency)}</td></tr>
            </tbody>
          </table>
          {d.ledger.length > 0 && (
            <>
              <div style={{ fontWeight: 700, margin: '8px 0' }}>Commission distribution</div>
              <table>
                <thead><tr><th>Lvl</th><th>Beneficiary</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {d.ledger.map((l) => (
                    <tr key={l.id}>
                      <td>{l.level}</td>
                      <td>{l.beneficiaryName} ({l.beneficiaryCode})</td>
                      <td style={{ textAlign: 'right' }}>{(l.rateBpsUsed / 100).toFixed(2)}%</td>
                      <td style={{ textAlign: 'right' }}>{money(l.amountCents, d.currency)}</td>
                    </tr>
                  ))}
                  <tr><td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Total commission</td><td style={{ textAlign: 'right', fontWeight: 800 }}>{money(totalCommission, d.currency)}</td></tr>
                </tbody>
              </table>
            </>
          )}
          <PrintSignatures left="Prepared by" right="Approved by" />
        </PrintSheet>
      )}
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 13.5, marginTop: 2 }}>{value}</div>
    </div>
  );
}
