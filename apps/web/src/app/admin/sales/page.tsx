'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, useToast } from '@/components/ui';
import { Drawer } from '@/components/Drawer';
import { ImportWizard } from '@/components/ImportWizard';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';

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
interface SalesList { total: number; items: SaleItem[] }
type Pending = { ids: string[]; action: 'approve' | 'void' };

interface Filters { status: string; q: string; from: string; to: string; minCents: string; maxCents: string }
const EMPTY: Filters = { status: '', q: '', from: '', to: '', minCents: '', maxCents: '' };
const STATUSES = ['', 'draft', 'approved', 'void'] as const;
const VIEWS_KEY = 'refearn.sales.views';

interface SavedView { name: string; filters: Filters }

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);

  useEffect(() => {
    try { setViews(JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '[]')); } catch { /* yok say */ }
  }, []);

  const queryString = useMemo(() => {
    const p = new URLSearchParams({ pageSize: '50' });
    if (filters.status) p.set('status', filters.status);
    if (filters.q.trim()) p.set('q', filters.q.trim());
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    if (filters.minCents) p.set('minCents', filters.minCents);
    if (filters.maxCents) p.set('maxCents', filters.maxCents);
    return p.toString();
  }, [filters]);

  const load = useCallback(async () => {
    try {
      setList(await api.get<SalesList>(`/admin/sales?${queryString}`));
      setSelected(new Set());
    } catch (e) { setError(String((e as ApiError).message)); }
  }, [queryString]);

  // filtre degisiminde debounce'lu yenile
  useEffect(() => {
    const id = setTimeout(() => void load(), 300);
    return () => clearTimeout(id);
  }, [load]);

  async function createSale(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/admin/sales', { sellerReferralCode: code.trim(), amountCents: Number(amount) });
      setCode(''); setAmount('');
      showToast('Sale created (draft)');
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function act(p: Pending) {
    setBusy(true);
    try {
      if (p.ids.length === 1) {
        await api.post(`/admin/sales/${p.ids[0]}/${p.action}`);
        showToast(p.action === 'approve' ? 'Approved, commissions distributed ✓' : 'Voided');
      } else {
        const res = await api.post<{ succeeded: number; failed: { id: string; reason: string }[] }>('/admin/sales/bulk', { action: p.action, ids: p.ids });
        showToast(`${res.succeeded} ${p.action}d${res.failed.length ? `, ${res.failed.length} failed` : ''}`);
      }
      setConfirm(null);
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function deliver(id: string) {
    try { await api.post(`/admin/sales/${id}/deliver`, {}); showToast('Marked as delivered'); await load(); }
    catch (e) { setError(String((e as ApiError).message)); }
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
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(next)); } catch { /* yok say */ }
    showToast('View saved');
  }
  function deleteView(name: string) {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(next)); } catch { /* yok say */ }
  }

  const selectedIds = useMemo(() => [...selected], [selected]);
  const selDrafts = useMemo(() => list?.items.filter((s) => selected.has(s.id) && s.status === 'draft').map((s) => s.id) ?? [], [list, selected]);
  const selVoidable = useMemo(() => list?.items.filter((s) => selected.has(s.id) && s.status !== 'void').map((s) => s.id) ?? [], [list, selected]);
  const activeFilters = filters.status || filters.q || filters.from || filters.to || filters.minCents || filters.maxCents;

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">{t('nav.sales')}</div>
          <h1 className="h1 fade-in">Sales Management</h1>
        </div>
        <button className="btn ghost fade-in" onClick={() => setShowImport(true)}>⇪ Import sales</button>
      </div>

      <form className="card fade-in delay-1" onSubmit={createSale} style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label>{t('sales.seller')}</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ALICE1" required />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label>{t('sales.amount')}</label>
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000000" required />
          </div>
          <button className="btn" disabled={busy}>+ {t('sales.new')}</button>
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>Amount is in cents (e.g. $100,000 = 10000000).</div>
      </form>

      {error && <div className="error">{error}</div>}

      {/* ---- filtre cubugu ---- */}
      <div className="card fade-in delay-2" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label>Search</label>
            <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Seller name, code, customer…" />
          </div>
          <div style={{ minWidth: 130 }}>
            <label>Status</label>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 130 }}>
            <label>From</label>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div style={{ minWidth: 130 }}>
            <label>To</label>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <div style={{ width: 120 }}>
            <label>Min (¢)</label>
            <input type="number" min={0} value={filters.minCents} onChange={(e) => setFilters({ ...filters, minCents: e.target.value })} />
          </div>
          <div style={{ width: 120 }}>
            <label>Max (¢)</label>
            <input type="number" min={0} value={filters.maxCents} onChange={(e) => setFilters({ ...filters, maxCents: e.target.value })} />
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="faint" style={{ fontSize: 12 }}>Saved views:</span>
          {views.length === 0 && <span className="faint" style={{ fontSize: 12 }}>none yet</span>}
          {views.map((v) => (
            <span key={v.name} className="row" style={{ gap: 4 }}>
              <button className="btn ghost sm" onClick={() => setFilters(v.filters)}>{v.name}</button>
              <button className="faint" onClick={() => deleteView(v.name)} aria-label={`Delete ${v.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </span>
          ))}
          <span style={{ flex: 1 }} />
          {activeFilters && <button className="btn ghost sm" onClick={() => setFilters(EMPTY)}>Clear</button>}
          <button className="btn ghost sm" onClick={saveView}>＋ Save view</button>
        </div>
      </div>

      {/* ---- tablo ---- */}
      <div className="card fade-in delay-2">
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong>Sales{list ? ` · ${list.total}` : ''}</strong>
        </div>
        {!list ? <Loading rows={3} /> : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }}><input type="checkbox" checked={selected.size > 0 && selected.size === list.items.length} onChange={toggleAll} aria-label="Select all" /></th>
                <th>Seller</th><th>Amount</th><th>{t('sales.status')}</th><th>Date</th><th style={{ textAlign: 'right' }}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((s) => (
                <tr key={s.id} style={{ cursor: 'pointer', background: selected.has(s.id) ? 'var(--panel-2)' : undefined }} onClick={() => setDetailId(s.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.sellerName}`} />
                  </td>
                  <td>{s.sellerName}<div className="faint" style={{ fontSize: 12 }}>{s.sellerReferralCode}</div></td>
                  <td className="tnum" style={{ fontWeight: 650 }}>{money(s.amountCents, s.currency)}</td>
                  <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                  <td className="muted">{dateShort(s.saleDate)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {s.status === 'draft' && <button className="btn sm" onClick={() => setConfirm({ ids: [s.id], action: 'approve' })}>{t('sales.approve')}</button>}
                      {s.status === 'approved' && !s.deliveredAt && <button className="btn sm ghost" onClick={() => deliver(s.id)}>{t('sales.deliver')}</button>}
                      {s.status !== 'void' && <button className="btn sm danger" onClick={() => setConfirm({ ids: [s.id], action: 'void' })}>{t('sales.void')}</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {list.items.length === 0 && <tr><td colSpan={6} className="muted">No sales match these filters.</td></tr>}
            </tbody>
          </table>
        )}

        {selected.size > 0 && (
          <div className="bulkbar">
            <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
            <span style={{ flex: 1 }} />
            <button className="btn sm" disabled={selDrafts.length === 0} onClick={() => setConfirm({ ids: selDrafts, action: 'approve' })}>Approve {selDrafts.length || ''}</button>
            <button className="btn sm danger" disabled={selVoidable.length === 0} onClick={() => setConfirm({ ids: selVoidable, action: 'void' })}>Void {selVoidable.length || ''}</button>
            <button className="btn ghost sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      {confirm && (
        <Confirm
          title={confirm.action === 'approve' ? `Approve ${confirm.ids.length} sale${confirm.ids.length > 1 ? 's' : ''}` : `Void ${confirm.ids.length} sale${confirm.ids.length > 1 ? 's' : ''}`}
          message={confirm.action === 'approve'
            ? 'On approval, commissions are distributed across the tree. This action cannot be undone.'
            : 'Voiding creates reversing entries and reduces balances.'}
          confirmLabel={confirm.action === 'approve' ? t('sales.approve') : t('sales.void')}
          danger={confirm.action === 'void'}
          busy={busy}
          onConfirm={() => act(confirm)}
          onClose={() => setConfirm(null)}
        />
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
  customerRef?: string | null;
  externalRef?: string | null;
  ledger: LedgerLine[];
}

function SaleDrawer({ id, onClose, onChanged, onToast }: { id: string; onClose: () => void; onChanged: () => void; onToast: (m: string) => void }) {
  const [d, setD] = useState<SaleDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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

  const totalCommission = d?.ledger.filter((l) => l.type === 'commission').reduce((a, l) => a + Number(l.amountCents), 0) ?? 0;

  return (
    <Drawer
      title={d ? money(d.amountCents, d.currency) : 'Sale'}
      subtitle={d ? `${d.sellerName} · ${d.sellerReferralCode}` : undefined}
      onClose={onClose}
      footer={d && (
        <>
          {d.status === 'draft' && <button className="btn" disabled={busy} onClick={() => action('approve')}>Approve</button>}
          {d.status === 'approved' && !d.deliveredAt && <button className="btn ghost" disabled={busy} onClick={() => action('deliver')}>Mark delivered</button>}
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
          </div>
          <Field label="Seller" value={`${d.sellerName} · ${d.sellerEmail}`} />
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Sale date" value={dateShort(d.saleDate)} />
            <Field label="Recorded" value={dateShort(d.createdAt)} />
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
