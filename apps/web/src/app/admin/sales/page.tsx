'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronLeft, ChevronRight, PackageCheck, Plus, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, Modal, useToast } from '@/components/ui';
import { Drawer } from '@/components/Drawer';
import { ImportWizard } from '@/components/ImportWizard';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
interface SalesList { total: number; page: number; pageSize: number; items: SaleItem[] }
type SaleAction = 'approve' | 'void' | 'deliver';
type Pending = { ids: string[]; action: SaleAction };

interface Filters { status: string; q: string; from: string; to: string; minAmount: string; maxAmount: string }
const EMPTY: Filters = { status: '', q: '', from: '', to: '', minAmount: '', maxAmount: '' };
const STATUS_OPTIONS = ['draft', 'approved', 'void'] as const;
const VIEWS_KEY = 'refearn.sales.views';

interface SavedView { name: string; filters: Filters }

function amountInputToCents(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function centsToAmountInput(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return '';
  return (Number(value) / 100).toFixed(2);
}

function normalizeFilters(value: Partial<Filters> & { minCents?: string; maxCents?: string }): Filters {
  return {
    ...EMPTY,
    ...value,
    minAmount: value.minAmount ?? centsToAmountInput(value.minCents),
    maxAmount: value.maxAmount ?? centsToAmountInput(value.maxCents),
  };
}

function saleActionLabel(action: SaleAction): string {
  if (action === 'approve') return t('sales.approve');
  if (action === 'void') return t('sales.void');
  return t('sales.deliver');
}

function saleActionTitle(action: SaleAction, count: number): string {
  const suffix = count > 1 ? 's' : '';
  if (action === 'approve') return `Approve ${count} sale${suffix}`;
  if (action === 'void') return `Void ${count} sale${suffix}`;
  return 'Mark sale delivered';
}

function saleActionMessage(action: SaleAction): string {
  if (action === 'approve') return 'On approval, commissions are distributed across the tree. This action cannot be undone.';
  if (action === 'void') return 'Voiding creates reversing entries and reduces balances.';
  return 'Delivery can release pending commissions when the tenant maturation rule is on delivery.';
}

function statusVariant(status: SaleItem['status']): 'default' | 'secondary' | 'destructive' {
  if (status === 'approved') return 'default';
  if (status === 'void') return 'destructive';
  return 'secondary';
}

function SaleStatusBadge({ status }: { status: SaleItem['status'] }) {
  return <Badge variant={statusVariant(status)}>{status}</Badge>;
}

export default function SalesPage() {
  const [list, setList] = useState<SalesList | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
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
  const [page, setPage] = useState(1);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '[]') as Array<{ name: string; filters: Partial<Filters> & { minCents?: string; maxCents?: string } }>;
      setViews(raw.map((view) => ({ name: view.name, filters: normalizeFilters(view.filters) })));
    } catch { /* ignore invalid saved views */ }
  }, []);

  function updateFilters(next: Filters) {
    setDetailId(null);
    setPage(1);
    setFilters(next);
  }

  const queryString = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (filters.status) p.set('status', filters.status);
    if (filters.q.trim()) p.set('q', filters.q.trim());
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    const minCents = amountInputToCents(filters.minAmount);
    const maxCents = amountInputToCents(filters.maxAmount);
    if (minCents !== null) p.set('minCents', String(minCents));
    if (maxCents !== null) p.set('maxCents', String(maxCents));
    return p.toString();
  }, [filters, page]);

  const load = useCallback(async () => {
    try {
      setError('');
      setList(await api.get<SalesList>(`/admin/sales?${queryString}`));
      setSelected(new Set());
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [queryString]);

  // Debounced reload when filters change.
  useEffect(() => {
    const id = setTimeout(() => void load(), 300);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    if (!list) return;
    const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
    if (page > lastPage) setPage(lastPage);
  }, [list, page]);

  async function createSale(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const amountCents = amountInputToCents(amount);
      if (!amountCents || amountCents <= 0) throw new Error('Enter a valid sale amount.');
      await api.post('/admin/sales', { sellerReferralCode: code.trim(), amountCents });
      setCode(''); setAmount(''); setShowNew(false);
      showToast('Sale created (draft)');
      if (page !== 1) setPage(1);
      else await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function act(p: Pending) {
    setBusy(true);
    try {
      if (p.action === 'deliver') {
        await api.post(`/admin/sales/${p.ids[0]}/deliver`, {});
        showToast('Marked as delivered');
      } else if (p.ids.length === 1) {
        await api.post(`/admin/sales/${p.ids[0]}/${p.action}`);
        showToast(p.action === 'approve' ? 'Approved, commissions distributed' : 'Voided');
      } else {
        const res = await api.post<{ succeeded: number; failed: { id: string; reason: string }[] }>('/admin/sales/bulk', { action: p.action, ids: p.ids });
        showToast(`${res.succeeded} ${p.action}d${res.failed.length ? `, ${res.failed.length} failed` : ''}`);
      }
      setConfirm(null);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    if (!list) return;
    setSelected((prev) => prev.size === list.items.length ? new Set() : new Set(list.items.map((s) => s.id)));
  }

  function saveView() {
    const name = prompt('Save this view as:');
    if (!name?.trim()) return;
    const next = [...views.filter((v) => v.name !== name.trim()), { name: name.trim(), filters }];
    setViews(next);
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(next)); } catch { /* ignore storage errors */ }
    showToast('View saved');
  }
  function deleteView(name: string) {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(next)); } catch { /* ignore storage errors */ }
  }

  const selDrafts = useMemo(() => list?.items.filter((s) => selected.has(s.id) && s.status === 'draft').map((s) => s.id) ?? [], [list, selected]);
  const selVoidable = useMemo(() => list?.items.filter((s) => selected.has(s.id) && s.status !== 'void').map((s) => s.id) ?? [], [list, selected]);
  const activeFilters = filters.status || filters.q || filters.from || filters.to || filters.minAmount || filters.maxAmount;
  const advCount = [filters.status, filters.from, filters.to, filters.minAmount, filters.maxAmount].filter(Boolean).length;
  const pageCount = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="eyebrow fade-in">{t('nav.sales')}</div>
          <h1 className="h1 fade-in">Sales Management</h1>
          <p className="sub fade-in mb-0">Review draft sales, approve commissions and keep import work visible.</p>
        </div>
        <div className="flex flex-wrap gap-2 fade-in">
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload data-icon="inline-start" />
            Import
          </Button>
          <Button onClick={() => setShowNew(true)}>
            <Plus data-icon="inline-start" />
            New sale
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4 fade-in">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card size="sm" className="fade-in delay-1 my-4">
        <CardHeader className="border-b">
          <CardTitle>Filter sales</CardTitle>
          <CardDescription>Search the ledger before approving or voiding commission impact.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(118px,1fr))]">
            <Field>
              <FieldLabel>Search</FieldLabel>
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={filters.q}
                  onChange={(e) => updateFilters({ ...filters, q: e.target.value })}
                  placeholder="Seller, code, customer"
                />
              </div>
            </Field>
            <Field>
              <FieldLabel>Status</FieldLabel>
              <Select value={filters.status || 'all'} onValueChange={(value: string) => updateFilters({ ...filters, status: value === 'all' ? '' : value })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">All statuses</SelectItem>
                    {STATUS_OPTIONS.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>From</FieldLabel>
              <Input type="date" value={filters.from} onChange={(e) => updateFilters({ ...filters, from: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel>To</FieldLabel>
              <Input type="date" value={filters.to} onChange={(e) => updateFilters({ ...filters, to: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel>Min amount</FieldLabel>
              <Input type="number" min={0} step="0.01" value={filters.minAmount} onChange={(e) => updateFilters({ ...filters, minAmount: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel>Max amount</FieldLabel>
              <Input type="number" min={0} step="0.01" value={filters.maxAmount} onChange={(e) => updateFilters({ ...filters, maxAmount: e.target.value })} />
            </Field>
          </div>

          <div className="flex flex-col gap-3">
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Views</span>
              {views.length === 0 ? (
                <span className="text-xs text-muted-foreground">No saved views.</span>
              ) : views.map((v) => (
                <span key={v.name} className="inline-flex items-center gap-1 rounded-lg border bg-background p-1">
                  <Button variant="ghost" size="sm" onClick={() => updateFilters(normalizeFilters(v.filters))}>{v.name}</Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => deleteView(v.name)} aria-label={`Delete ${v.name}`}>
                    <Trash2 />
                  </Button>
                </span>
              ))}
              <span className="min-w-2 flex-1" />
              {advCount > 0 && <Badge variant="outline">{advCount} filters</Badge>}
              {activeFilters && (
                <Button variant="ghost" size="sm" onClick={() => updateFilters(EMPTY)}>
                  <X data-icon="inline-start" />
                  Clear
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={saveView}>
                <Save data-icon="inline-start" />
                Save view
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="fade-in delay-2 py-0">
        <CardHeader className="border-b">
          <div>
            <CardTitle>Sales ledger</CardTitle>
            <CardDescription>
              {list ? `${list.items.length} visible of ${list.total} sales` : 'Loading sales records'}
            </CardDescription>
          </div>
          <CardAction>
            {selected.size > 0 ? <Badge variant="default">{selected.size} selected</Badge> : activeFilters ? <Badge variant="outline">Filtered</Badge> : null}
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          {!list ? <div className="p-4"><Loading rows={3} /></div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={selected.size > 0 && selected.size === list.items.length}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Seller</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>{t('sales.status')}</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((s) => (
                  <TableRow
                    key={s.id}
                    className={cn('cursor-pointer', selected.has(s.id) && 'bg-muted/50')}
                    onClick={() => setDetailId(s.id)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} aria-label={`Select ${s.sellerName}`} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{s.sellerName}</div>
                      <div className="text-xs text-muted-foreground">{s.sellerReferralCode}</div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(s.amountCents, s.currency)}</TableCell>
                    <TableCell><SaleStatusBadge status={s.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{dateShort(s.saleDate)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap justify-end gap-1">
                        {s.status === 'draft' && (
                          <Button size="sm" onClick={() => setConfirm({ ids: [s.id], action: 'approve' })}>
                            <Check data-icon="inline-start" />
                            {t('sales.approve')}
                          </Button>
                        )}
                        {s.status === 'approved' && !s.deliveredAt && (
                          <Button size="sm" variant="outline" onClick={() => setConfirm({ ids: [s.id], action: 'deliver' })}>
                            <PackageCheck data-icon="inline-start" />
                            {t('sales.deliver')}
                          </Button>
                        )}
                        {s.status !== 'void' && (
                          <Button size="sm" variant="destructive" onClick={() => setConfirm({ ids: [s.id], action: 'void' })}>
                            {t('sales.void')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {list.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center">
                      <div className="font-medium text-foreground">No sales match these filters.</div>
                      <div className="mt-1 text-xs text-muted-foreground">Clear filters or import a new batch to continue.</div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {list && list.total > list.pageSize && (
          <CardContent className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
            <span className="text-xs text-muted-foreground">
              Page {list.page} of {pageCount} · {list.total} sales
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={list.page <= 1}
                onClick={() => { setDetailId(null); setPage((current) => Math.max(1, current - 1)); }}
              >
                <ChevronLeft data-icon="inline-start" />
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={list.page >= pageCount}
                onClick={() => { setDetailId(null); setPage((current) => Math.min(pageCount, current + 1)); }}
              >
                Next
                <ChevronRight data-icon="inline-end" />
              </Button>
            </div>
          </CardContent>
        )}

        {selected.size > 0 && (
          <CardFooter className="sticky bottom-3 z-10 mx-3 mb-3 flex flex-wrap gap-2 rounded-xl border bg-card shadow-lg">
            <strong className="text-sm">{selected.size} selected</strong>
            <span className="min-w-2 flex-1" />
            <Button size="sm" disabled={selDrafts.length === 0} onClick={() => setConfirm({ ids: selDrafts, action: 'approve' })}>
              <Check data-icon="inline-start" />
              Approve {selDrafts.length || ''}
            </Button>
            <Button size="sm" variant="destructive" disabled={selVoidable.length === 0} onClick={() => setConfirm({ ids: selVoidable, action: 'void' })}>
              Void {selVoidable.length || ''}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X data-icon="inline-start" />
              Clear
            </Button>
          </CardFooter>
        )}
      </Card>

      {confirm && (
        <Confirm
          title={saleActionTitle(confirm.action, confirm.ids.length)}
          message={saleActionMessage(confirm.action)}
          confirmLabel={saleActionLabel(confirm.action)}
          danger={confirm.action === 'void'}
          busy={busy}
          onConfirm={() => act(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}

      {showNew && (
        <Modal title="Record a sale" onClose={() => setShowNew(false)}>
          <form onSubmit={createSale} className="grid w-[min(420px,88vw)] gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel>{t('sales.seller')}</FieldLabel>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ALICE1" required autoFocus />
              </Field>
              <Field>
                <FieldLabel>{t('sales.amount')}</FieldLabel>
                <Input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100000.00" required />
              </Field>
            </FieldGroup>
            <div className="text-xs text-muted-foreground">Enter the sale total in the tenant currency.</div>
            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)} disabled={busy}>Cancel</Button>
              <Button disabled={busy}>{busy ? 'Saving...' : 'Create draft'}</Button>
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

/* --------------------------------------------------- sale detail drawer */
interface LedgerLine { id: string; level: number; type: string; status: string; rateBpsUsed: number; amountCents: string; beneficiaryName: string; beneficiaryCode: string }
interface SaleDetail extends SaleItem {
  sellerEmail: string;
  createdAt: string;
  customerRef?: string | null;
  externalRef?: string | null;
  ledger: LedgerLine[];
}

function SaleDrawer({ id, onClose, onChanged, onToast }: { id: string; onClose: () => void; onChanged: () => void; onToast: (m: string) => void }) {
  const [d, setD] = useState<SaleDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<SaleAction | null>(null);

  const load = useCallback(() => {
    api.get<SaleDetail>(`/admin/sales/${id}`).then(setD).catch((e) => setErr(String((e as ApiError).message)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function action(a: 'approve' | 'void' | 'deliver') {
    setBusy(true);
    try {
      await api.post(`/admin/sales/${id}/${a}`, a === 'deliver' ? {} : undefined);
      setConfirmAction(null);
      onToast(a === 'approve' ? 'Approved' : a === 'void' ? 'Voided' : 'Delivered');
      load(); onChanged();
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  const totalCommission = d?.ledger.filter((l) => l.type === 'commission').reduce((a, l) => a + Number(l.amountCents), 0) ?? 0;

  return (
    <>
    <Drawer
      title={d ? money(d.amountCents, d.currency) : 'Sale'}
      subtitle={d ? `${d.sellerName} - ${d.sellerReferralCode}` : undefined}
      onClose={onClose}
      footer={d && (
        <>
          {d.status === 'draft' && <Button disabled={busy} onClick={() => setConfirmAction('approve')}><Check data-icon="inline-start" />Approve</Button>}
          {d.status === 'approved' && !d.deliveredAt && <Button variant="outline" disabled={busy} onClick={() => setConfirmAction('deliver')}><PackageCheck data-icon="inline-start" />Mark delivered</Button>}
          {d.status !== 'void' && <Button variant="destructive" disabled={busy} onClick={() => setConfirmAction('void')}>Void</Button>}
        </>
      )}
    >
      {err && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{err}</AlertDescription>
        </Alert>
      )}
      {!d ? <Loading rows={4} /> : (
        <div className="grid gap-5">
          <div className="flex flex-wrap gap-2">
            <SaleStatusBadge status={d.status} />
            {d.deliveredAt && <Badge variant="outline">delivered</Badge>}
          </div>
          <DetailField label="Seller" value={`${d.sellerName} - ${d.sellerEmail}`} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DetailField label="Sale date" value={dateShort(d.saleDate)} />
            <DetailField label="Recorded" value={dateShort(d.createdAt)} />
            <DetailField label="Customer ref" value={d.customerRef || '-'} />
            <DetailField label="External ref" value={d.externalRef || '-'} />
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm">Commission distribution</strong>
              {totalCommission > 0 && <span className="text-xs tabular-nums text-muted-foreground">{money(totalCommission, d.currency)} total</span>}
            </div>
            {d.ledger.length === 0 ? (
              <div className="text-sm text-muted-foreground">No commissions yet - approve to distribute.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lvl</TableHead>
                    <TableHead>Beneficiary</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.ledger.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="tabular-nums">{l.level}</TableCell>
                      <TableCell>
                        <div>{l.beneficiaryName}</div>
                        <div className="text-[11px] text-muted-foreground">{l.beneficiaryCode}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{(l.rateBpsUsed / 100).toFixed(2)}%</TableCell>
                      <TableCell className={cn('text-right tabular-nums', l.type === 'reversal' && 'text-destructive')}>
                        {money(l.amountCents, d.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </Drawer>
    {confirmAction && (
      <Confirm
        title={saleActionTitle(confirmAction, 1)}
        message={saleActionMessage(confirmAction)}
        confirmLabel={saleActionLabel(confirmAction)}
        danger={confirmAction === 'void'}
        busy={busy}
        onConfirm={() => action(confirmAction)}
        onClose={() => setConfirmAction(null)}
      />
    )}
    </>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[13.5px]">{value}</div>
    </div>
  );
}
