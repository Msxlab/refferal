'use client';

import { CSSProperties, FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { ColumnsMenu, Confirm, Loading, Modal, Pagination, SortableTh, SortDir, MoneyCounter, TableColumn, useTablePrefs, useToast } from '@/components/ui';
import { Drawer } from '@/components/Drawer';
import { Popover } from '@/components/Popover';
import { ImportWizard } from '@/components/ImportWizard';
import { useLiveRefresh } from '@/components/LiveIndicator';
import { PrintSheet, PrintHeader, PrintSignatures } from '@/components/PrintSheet';
import { activeMembership, getSession } from '@/lib/auth';
import { dateShort, money, levelLabel, ledgerTypeLabel } from '@/lib/format';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ChevronDown, Download, Printer, Upload, Plus, ArrowRight, Search, Users, X, Check, Trash2 } from 'lucide-react';

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
  commissionCents: string;
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
  { key: 'commission', label: 'Commission' },
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

/* ---- status -> para-anlamli rozet (var() + /15 alfa, light+dark dogru) ---- */
type MoneyTone = 'emerald' | 'amber' | 'rose';
function toneStyle(tone: MoneyTone): CSSProperties {
  const v = `var(--${tone})`;
  return {
    color: v,
    backgroundColor: `color-mix(in srgb, ${v} 15%, transparent)`,
    borderColor: `color-mix(in srgb, ${v} 30%, transparent)`,
  };
}
function saleTone(status: string): MoneyTone | null {
  if (status === 'approved') return 'emerald';
  if (status === 'draft') return 'amber';
  if (status === 'void') return 'rose';
  return null;
}
/* tutarli durum pill'i — para renkleriyle */
function StatusPill({ status, className }: { status: string; className?: string }) {
  const tone = saleTone(status);
  return (
    <span
      style={tone ? toneStyle(tone) : undefined}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize leading-tight',
        !tone && 'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      {status}
    </span>
  );
}
/* teslim/self gibi yan rozetler — yumusak emerald/amber */
function ToneChip({ tone, children, className, title }: { tone: MoneyTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      style={toneStyle(tone)}
      className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-tight', className)}
    >
      {children}
    </span>
  );
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
  const [sellerOpts, setSellerOpts] = useState<{ fullName: string; referralCode: string }[]>([]);
  const [sellerPicked, setSellerPicked] = useState(false);
  const [amount, setAmount] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newCustomer, setNewCustomer] = useState('');
  const [newExternalRef, setNewExternalRef] = useState('');
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

  // satici otomatik-tamamlama (Record a sale): isim/kod ile canli arama
  useEffect(() => {
    if (!showNew || sellerPicked || code.trim().length < 1) { setSellerOpts([]); return; }
    const id = setTimeout(() => {
      api.get<{ items: { fullName: string; referralCode: string }[] }>(`/admin/members?search=${encodeURIComponent(code.trim())}&pageSize=6`)
        .then((r) => setSellerOpts(r.items)).catch(() => setSellerOpts([]));
    }, 200);
    return () => clearTimeout(id);
  }, [code, showNew, sellerPicked]);

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
      const dollars = parseFloat(amount);
      if (!Number.isFinite(dollars) || dollars <= 0) { setError('Enter a valid amount greater than 0.'); setBusy(false); return; }
      const cents = Math.round(dollars * 100);
      await api.post('/admin/sales', {
        sellerReferralCode: code.trim(),
        amountCents: cents,
        ...(newDate ? { saleDate: newDate } : {}),
        ...(newCustomer.trim() ? { customerRef: newCustomer.trim() } : {}),
        ...(newExternalRef.trim() ? { externalRef: newExternalRef.trim() } : {}),
      });
      setCode(''); setAmount(''); setNewCustomer(''); setNewExternalRef(''); setShowNew(false);
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

  const inputCls = 'h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary';

  return (
    <div className="text-foreground">
      {/* ---- baslik ---- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">{t('nav.sales')}</div>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-[27px]">Sales &amp; commissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every booked sale, its status, and the commission it generates.</p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">More <ChevronDown className="size-4" aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={exportCsv}><Download className="size-4 mr-2" aria-hidden /> Export CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => window.print()}><Printer className="size-4 mr-2" aria-hidden /> Print</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowImport(true)}><Upload className="size-4 mr-2" aria-hidden /> Import</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => { setError(''); setCode(''); setSellerOpts([]); setSellerPicked(false); setNewDate(new Date().toLocaleDateString('en-CA')); setShowNew(true); }}><Plus className="size-4" aria-hidden /> New sale</Button>
        </div>
      </div>

      {error && <Alert variant="destructive" className="mt-4"><AlertDescription>{error}</AlertDescription></Alert>}

      {/* ---- KPI seridi ---- */}
      <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Revenue (approved)" accent
          value={summary ? <MoneyCounter cents={summary.byStatus.approved.amountCents} currency={cur} /> : '—'}
          hint={summary ? `${summary.byStatus.approved.count} approved sales` : undefined} />
        <button type="button" onClick={() => patchFilters({ ...EMPTY, status: 'draft' })} title="Show drafts awaiting approval" aria-label="Show drafts awaiting approval" className="rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Kpi label={<>Awaiting approval <ArrowRight className="inline size-[15px] align-text-bottom" aria-hidden /></>}
            value={summary ? summary.byStatus.draft.count : '—'}
            valueStyle={{ color: 'var(--amber)' }}
            hint={summary ? money(summary.byStatus.draft.amountCents, cur) : undefined} />
        </button>
        <Kpi label="Average sale"
          value={summary ? <MoneyCounter cents={summary.avgCents} currency={cur} /> : '—'}
          hint={summary ? `${summary.count} sales in view` : undefined} />
        <Kpi label="Voided"
          value={summary ? summary.byStatus.void.count : '—'}
          valueClass="text-destructive"
          hint={summary ? money(summary.byStatus.void.amountCents, cur) : undefined} />
      </div>

      {/* ---- arac cubugu: ara + hizli tarih + filtreler + kayitli gorunumler ---- */}
      <div className="no-print my-4 flex flex-wrap items-center gap-2">
        <div className="flex h-9 basis-full items-center gap-2 rounded-lg border border-input bg-card px-3 transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary sm:min-w-[210px] sm:max-w-[320px] sm:flex-1 sm:basis-auto">
          <Search className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
          <input aria-label="Search sales by seller, code, or customer" value={filters.q} onChange={(e) => patchFilters({ ...filters, q: e.target.value })}
            placeholder="Search seller, code, customer…" className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70" />
        </div>

        {/* hizli tarih cipleri — aktif: primary, pasif: secondary + hover */}
        <div className="flex items-center gap-1">
          {([['today', 'Today'], ['7d', '7 days'], ['month', 'This month'], ['lastMonth', 'Last month']] as [ChipKey, string][]).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => toggleChip(k)} aria-pressed={activeChip === k}
              className={cn(
                'h-9 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                activeChip === k
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
              )}>{lbl}</button>
          ))}
        </div>

        <Popover label={<>Filters</>} badge={advCount} width={300}>
          {(close) => (
            <div className="grid gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Status</label>
                <Select value={filters.status || '__all__'} onValueChange={(v) => patchFilters({ ...filters, status: v === '__all__' ? '' : v })}>
                  <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s || '__all__'}>{s || 'All statuses'}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div><label className="mb-1 block text-xs text-muted-foreground">From</label><input type="date" value={filters.from} onChange={(e) => patchFilters({ ...filters, from: e.target.value })} className={inputCls} /></div>
                <div><label className="mb-1 block text-xs text-muted-foreground">To</label><input type="date" value={filters.to} onChange={(e) => patchFilters({ ...filters, to: e.target.value })} className={inputCls} /></div>
                <div><label className="mb-1 block text-xs text-muted-foreground">Min ($)</label><input type="number" min={0} step="0.01" value={filters.minCents ? String(Number(filters.minCents) / 100) : ''} onChange={(e) => patchFilters({ ...filters, minCents: e.target.value ? String(Math.round(parseFloat(e.target.value) * 100)) : '' })} placeholder="0.00" className={cn(inputCls, 'tabular-nums')} /></div>
                <div><label className="mb-1 block text-xs text-muted-foreground">Max ($)</label><input type="number" min={0} step="0.01" value={filters.maxCents ? String(Number(filters.maxCents) / 100) : ''} onChange={(e) => patchFilters({ ...filters, maxCents: e.target.value ? String(Math.round(parseFloat(e.target.value) * 100)) : '' })} placeholder="0.00" className={cn(inputCls, 'tabular-nums')} /></div>
              </div>
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => patchFilters({ ...EMPTY, q: filters.q })}>Reset</Button>
                <Button size="sm" onClick={close}>Done</Button>
              </div>
            </div>
          )}
        </Popover>

        {/* kayitli gorunumler — SPEC'teki kayitli-filtre cipi gorunumu */}
        {views.map((v) => (
          <span key={v.id} className="inline-flex h-9 items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2.5 text-xs font-semibold text-primary">
            <button type="button" onClick={() => applyView(v)} title={v.mine ? undefined : `Shared by ${v.ownerName ?? 'team'}`} className="inline-flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {v.shared && <><Users className="size-[15px]" aria-hidden /><span className="sr-only">Shared view: </span></>}{v.name}
            </button>
            {v.mine && <Tooltip><TooltipTrigger asChild><button type="button" onClick={() => deleteView(v.id)} aria-label={`Delete ${v.name}`} className="ml-0.5 rounded-sm text-primary/70 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-[15px]" aria-hidden /></button></TooltipTrigger><TooltipContent>{`Delete ${v.name}`}</TooltipContent></Tooltip>}
          </span>
        ))}

        <span className="ml-auto flex items-center gap-2">
          <ColumnsMenu prefs={cols} />
          {activeFilters && <Button variant="ghost" size="sm" onClick={() => patchFilters(EMPTY)}>Clear</Button>}
          <Button variant="outline" size="sm" onClick={() => { setViewName(''); setViewShared(false); setShowSaveView(true); }}><Plus className="size-4" aria-hidden /> Save view</Button>
        </span>
      </div>

      {/* ---- tablo ---- */}
      <Card className="overflow-hidden shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <strong className="text-sm text-foreground">Sales{list ? ` · ${list.total}` : ''}</strong>
          <div className="flex items-center gap-3">
            {summary && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                In view · <strong className="tabular-nums text-foreground">{money(summary.sumCents, cur)}</strong> · commission{' '}
                <strong className="tabular-nums text-primary">{money(summary.byStatus.approved.amountCents, cur)}</strong>
              </span>
            )}
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="no-print h-8 w-auto rounded-md border border-input bg-card px-2 text-xs text-foreground outline-none focus:border-primary" aria-label="Rows per page"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
                <SelectItem value="100">100 / page</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && !list ? (
          <div className="px-4 py-12 text-center">
            <Alert variant="destructive" className="mx-auto max-w-sm text-left">
              <AlertDescription>Couldn&apos;t load sales. {error}</AlertDescription>
            </Alert>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => { setError(''); void load(); }}>Try again</Button>
          </div>
        ) : !list ? <div className="p-4"><Loading rows={3} /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="no-print w-8 px-4 py-2.5"><input type="checkbox" className="accent-primary" checked={selected.size > 0 && selected.size === list.items.length} onChange={toggleAll} aria-label="Select all" /></th>
                  {cols.isVisible('seller') && <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Seller</th>}
                  {cols.isVisible('amount') && <Th align="right"><SortableTh label="Amount" field="amountCents" sort={sort} dir={dir} onSort={onSort} /></Th>}
                  {cols.isVisible('commission') && <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Commission</th>}
                  {cols.isVisible('customer') && <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Customer</th>}
                  {cols.isVisible('status') && <Th><SortableTh label={t('sales.status')} field="status" sort={sort} dir={dir} onSort={onSort} /></Th>}
                  {cols.isVisible('date') && <Th><SortableTh label="Date" field="saleDate" sort={sort} dir={dir} onSort={onSort} /></Th>}
                  <th className="no-print px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((s) => (
                  <tr key={s.id} onClick={() => setDetailId(s.id)}
                    className={cn('cursor-pointer border-t border-border transition-colors hover:bg-accent/40', selected.has(s.id) && 'bg-accent/60')}>
                    <td className="no-print px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="accent-primary" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.sellerName}`} />
                    </td>
                    {cols.isVisible('seller') && (
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-7 shrink-0">
                            <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                              {(s.sellerName || '?').trim().charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-foreground">{s.sellerName}</span>
                              {s.selfSubmitted && <ToneChip tone="amber" title="Submitted by member" className="px-1.5 py-0 text-[10px]">self</ToneChip>}
                            </div>
                            <div className="font-mono text-[11px] text-muted-foreground/70">{s.sellerReferralCode}</div>
                          </div>
                        </div>
                      </td>
                    )}
                    {cols.isVisible('amount') && <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">{money(s.amountCents, s.currency)}</td>}
                    {cols.isVisible('commission') && (
                      <td className="px-4 py-2.5 text-right">
                        {Number(s.commissionCents) > 0
                          ? <>
                              <span className="font-bold tabular-nums text-primary">{money(s.commissionCents, s.currency)}</span>
                              <div className="text-[11px] text-muted-foreground/70">{Number(s.amountCents) > 0 ? `%${((Number(s.commissionCents) / Number(s.amountCents)) * 100).toFixed(1)}` : '—'}</div>
                            </>
                          : <span className="text-muted-foreground/70">{s.status === 'draft' ? 'draft' : '—'}</span>}
                      </td>
                    )}
                    {cols.isVisible('customer') && <td className="px-4 py-2.5 text-[12.5px] text-muted-foreground">{s.customerRef || '—'}</td>}
                    {cols.isVisible('status') && (
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusPill status={s.status} />
                          {s.deliveredAt && <ToneChip tone="emerald"><Check className="size-[13px]" aria-hidden /> delivered</ToneChip>}
                        </div>
                      </td>
                    )}
                    {cols.isVisible('date') && <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{dateShort(s.saleDate)}</td>}
                    <td className="no-print px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {s.status === 'draft' && <Button size="sm" onClick={() => setConfirm({ ids: [s.id], action: 'approve' })}>{t('sales.approve')}</Button>}
                        {s.status === 'approved' && !s.deliveredAt && <Button variant="outline" size="sm" onClick={() => deliver(s.id)}>{t('sales.deliver')}</Button>}
                        {s.status === 'draft' && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-8 w-8 px-0 text-destructive hover:text-destructive" onClick={() => setConfirm({ ids: [s.id], action: 'delete' })} aria-label="Delete draft" title="Delete draft"><Trash2 className="size-4" aria-hidden /></Button></TooltipTrigger><TooltipContent>Delete draft</TooltipContent></Tooltip>}
                        {s.status !== 'void' && <Button variant="destructive" size="sm" onClick={() => setConfirm({ ids: [s.id], action: 'void' })}>{t('sales.void')}</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {list.items.length === 0 && <tr><td colSpan={colCount} className="px-4 py-10 text-center text-sm text-muted-foreground">No sales match these filters.</td></tr>}
              </tbody>
              {summary && summary.count > 0 && (
                <tfoot>
                  <tr className="border-t border-border">
                    <td colSpan={colCount} className="px-4 py-3 text-xs text-muted-foreground/70">
                      {summary.count} sales in view · <b className="tabular-nums text-foreground">{money(summary.sumCents, cur)}</b> · {summary.deliveredCount} delivered
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {list && <div className="border-t border-border px-4 py-2"><Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={setPage} /></div>}

        {selected.size > 0 && (
          <div className="no-print flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-4 py-3">
            <strong className="text-[13px] text-foreground">{selected.size} selected</strong>
            <span className="flex-1" />
            <Button size="sm" disabled={selDrafts.length === 0} onClick={() => setConfirm({ ids: selDrafts, action: 'approve' })}>Approve {selDrafts.length || ''}</Button>
            <Button variant="outline" size="sm" disabled={selDeliverable.length === 0} onClick={() => setConfirm({ ids: selDeliverable, action: 'deliver' })}>Deliver {selDeliverable.length || ''}</Button>
            <Button variant="destructive" size="sm" disabled={selVoidable.length === 0} onClick={() => setConfirm({ ids: selVoidable, action: 'void' })}>Void {selVoidable.length || ''}</Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={selDrafts.length === 0} onClick={() => setConfirm({ ids: selDrafts, action: 'delete' })}>Delete {selDrafts.length || ''}</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
      </Card>

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
          <form onSubmit={createSale} className="w-[min(460px,100%)]">
            <div className="relative mb-3">
              <label className="mb-1 block text-xs text-muted-foreground">{t('sales.seller')}</label>
              <input value={code} onChange={(e) => { setCode(e.target.value); setSellerPicked(false); }} placeholder="Search name or code…" required autoFocus autoComplete="off" className={inputCls} />
              {sellerOpts.length > 0 && !sellerPicked && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-[200px] overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
                  {sellerOpts.map((o) => (
                    <button key={o.referralCode} type="button" className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-muted"
                      onClick={() => { setCode(o.referralCode); setSellerPicked(true); setSellerOpts([]); }}>
                      <span className="text-[13px] font-semibold text-foreground">{o.fullName}</span>
                      <span className="font-mono text-xs text-muted-foreground/70">{o.referralCode}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-xs text-muted-foreground">{t('sales.amount')} ($)</label>
              <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100000.00" required className={cn(inputCls, 'tabular-nums')} />
              {Number(amount) > 0 && <div className="mt-1 text-xs text-muted-foreground/70">= {money(Math.round(parseFloat(amount) * 100), cur)}</div>}
            </div>
            <div className="flex gap-3">
              <div className="flex-1"><label className="mb-1 block text-xs text-muted-foreground">Sale date</label><input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className={inputCls} /></div>
              <div className="flex-1"><label className="mb-1 block text-xs text-muted-foreground">Customer (optional)</label><input value={newCustomer} onChange={(e) => setNewCustomer(e.target.value)} placeholder="e.g. Smith kitchen" className={inputCls} /></div>
            </div>
            <div className="mt-3"><label className="mb-1 block text-xs text-muted-foreground">External ref (optional)</label><input value={newExternalRef} onChange={(e) => setNewExternalRef(e.target.value)} placeholder="e.g. INV-2026-014" className={inputCls} /></div>
            {error && <Alert variant="destructive" className="mt-3"><AlertDescription>{error}</AlertDescription></Alert>}
            <div className="mt-3.5 flex justify-end gap-2.5">
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create draft'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {showSaveView && (
        <Modal title="Save view" onClose={() => setShowSaveView(false)}>
          <form onSubmit={saveView} className="w-[min(380px,88vw)]">
            <div className="mb-3"><label className="mb-1 block text-xs text-muted-foreground">View name</label><input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="e.g. Awaiting approval" required autoFocus className={inputCls} /></div>
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
              <input type="checkbox" className="accent-primary" checked={viewShared} onChange={(e) => setViewShared(e.target.checked)} />
              Share with the whole team
            </label>
            <div className="mt-1 text-[11px] text-muted-foreground/70">Saves the current filters and sorting. {viewShared ? 'Everyone on your team will see this view.' : 'Only you will see this view.'}</div>
            <div className="mt-3.5 flex justify-end gap-2.5">
              <Button type="button" variant="ghost" onClick={() => setShowSaveView(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {showImport && <ImportWizard onClose={() => setShowImport(false)} onDone={(n) => { setShowImport(false); showToast(`${n} sales imported`); void load(); }} />}

      {detailId && <SaleDrawer id={detailId} onClose={() => setDetailId(null)} onChanged={load} onToast={showToast} />}

      {toast && <div className="toast fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-popover px-4 py-2 text-sm text-foreground shadow-lg" role="status">{toast}</div>}
    </div>
  );
}

/* ------------------------------------------------- KPI karti (sayfa-ici) */
function Kpi({ label, value, hint, accent, valueClass, valueStyle }: { label: ReactNode; value: ReactNode; hint?: string; accent?: boolean; valueClass?: string; valueStyle?: CSSProperties }) {
  return (
    <Card className={cn('p-4 shadow-lg', accent && 'border-primary/30')}>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div style={valueStyle} className={cn('mt-1.5 font-display text-2xl font-extrabold tabular-nums tracking-tight text-foreground', accent && 'text-primary', valueClass)}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground/70">{hint}</div>}
    </Card>
  );
}

/* ------------------------------------------------- tablo basligi sarici */
function Th({ children, align }: { children: ReactNode; align?: 'right' }) {
  return <th className={cn('px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground [&_th]:p-0 [&_th]:text-inherit', align === 'right' && 'text-right')}>{children}</th>;
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

  // ---- yasam dongusu (lifecycle) adimlari: kayit -> onay -> teslim/iptal
  // nokta renkleri tek tip token/var() ile (primary token, emerald/rose para-token, muted token)
  const dotPrimary: CSSProperties = { backgroundColor: 'hsl(var(--primary))' };
  const dotEmerald: CSSProperties = { backgroundColor: 'var(--emerald)' };
  const dotDestructive: CSSProperties = { backgroundColor: 'hsl(var(--destructive))' };
  const dotMuted: CSSProperties = { backgroundColor: 'hsl(var(--muted))' };
  const steps: { t: string; d: string; done: boolean; dot: CSSProperties }[] = d ? [
    { t: 'Recorded', d: dateShort(d.createdAt), done: true, dot: dotPrimary },
    {
      t: d.status === 'void' ? 'Voided' : 'Approved',
      d: d.status === 'draft' ? 'pending' : (d.status === 'void' ? '—' : dateShort(d.createdAt)),
      done: d.status !== 'draft',
      dot: d.status === 'void' ? dotDestructive : d.status === 'approved' ? dotEmerald : dotMuted,
    },
    {
      t: 'Delivered',
      d: d.deliveredAt ? dateShort(d.deliveredAt) : '—',
      done: !!d.deliveredAt,
      dot: d.deliveredAt ? dotEmerald : dotMuted,
    },
  ] : [];

  return (
    <Drawer
      title={d ? money(d.amountCents, d.currency) : 'Sale'}
      subtitle={d ? `${d.sellerName} · ${d.sellerReferralCode}` : undefined}
      onClose={onClose}
      footer={d && (
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setPrinting(true)}><Printer className="size-4" aria-hidden /> Print receipt</Button>
          {d.status === 'draft' && <Button size="sm" disabled={busy} onClick={() => action('approve')}>Approve</Button>}
          {d.status === 'approved' && !d.deliveredAt && <Button variant="outline" size="sm" disabled={busy} onClick={() => action('deliver')}>Mark delivered</Button>}
          {d.status === 'draft' && <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirmDel(true)}>Delete</Button>}
          {d.status !== 'void' && <Button variant="destructive" size="sm" disabled={busy} onClick={() => action('void')}>Void</Button>}
        </>
      )}
    >
      {err && <Alert variant="destructive" className="mb-3"><AlertDescription>{err}</AlertDescription></Alert>}
      {!d ? <Loading rows={4} /> : (
        <div className="flex flex-col gap-[18px]">
          {/* tutar + status — SPEC: buyuk Sora rakam + rozet */}
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] text-muted-foreground/70">Sale amount</div>
              <div className="font-display text-[30px] font-extrabold tabular-nums text-foreground">{money(d.amountCents, d.currency)}</div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <StatusPill status={d.status} />
              {d.deliveredAt && <ToneChip tone="emerald">delivered</ToneChip>}
              {d.selfSubmitted && <ToneChip tone="amber">self-submitted</ToneChip>}
            </div>
          </div>

          {/* toplam komisyon seridi */}
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted px-3.5 py-3">
            <span className="text-[12.5px] text-muted-foreground">Total commission generated</span>
            <strong className="text-base tabular-nums text-primary">{money(totalCommission, d.currency)}</strong>
          </div>

          {/* kunye alanlari */}
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Seller" value={`${d.sellerName}`} sub={d.sellerEmail} />
            <Field label="Sale date" value={dateShort(d.saleDate)} />
            <Field label="Entered by" value={d.createdByName || '—'} />
            <Field label="Approved by" value={d.approvedByName || '—'} />
            <Field label="Customer ref" value={d.customerRef || '—'} />
            <Field label="External ref" value={d.externalRef || '—'} />
          </div>

          {/* komisyon dagilimi — SPEC: kart-satir listesi */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <strong className="text-[13px] text-foreground">Commission distribution</strong>
              {totalCommission > 0 && <span className="text-xs tabular-nums text-muted-foreground/70">{money(totalCommission, d.currency)} total</span>}
            </div>
            {d.ledger.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/40 px-3 py-4 text-center text-[13px] text-muted-foreground">No commissions yet — approve to distribute.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {d.ledger.map((l) => (
                  <div key={l.id} className="flex items-center gap-2.5 rounded-xl border border-border bg-muted px-3 py-2.5">
                    <span className="whitespace-nowrap rounded-md border border-border bg-card px-2 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground" title={ledgerTypeLabel(l.type)}>{(l.rateBpsUsed / 100).toFixed(2)}%</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold text-foreground">{levelLabel(l.level)}</div>
                      <div className="truncate text-[11px] text-muted-foreground/70">{l.beneficiaryName} · {l.beneficiaryCode}</div>
                    </div>
                    <strong style={l.type === 'reversal' ? undefined : { color: 'var(--emerald)' }} className={cn('text-[13px] tabular-nums', l.type === 'reversal' && 'text-destructive')}>{money(l.amountCents, d.currency)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* yasam dongusu zaman cizelgesi — SPEC: noktali timeline */}
          <div>
            <strong className="mb-3 block text-[13px] text-foreground">Lifecycle</strong>
            <div className="flex flex-col">
              {steps.map((st, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5">
                  <span style={st.done ? st.dot : undefined} className={cn('h-3 w-3 shrink-0 rounded-full ring-4 ring-muted', !st.done && 'bg-muted-foreground/30')} />
                  <span className={cn('flex-1 text-[13px] font-medium', st.done ? 'text-foreground' : 'text-muted-foreground/70')}>{st.t}</span>
                  <span className="text-xs tabular-nums text-muted-foreground/70">{st.d}</span>
                </div>
              ))}
            </div>
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
                <thead><tr><th>Tier</th><th>Beneficiary</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {d.ledger.map((l) => (
                    <tr key={l.id}>
                      <td>{levelLabel(l.level)}</td>
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

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 text-[13.5px] text-foreground">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground/70">{sub}</div>}
    </div>
  );
}
