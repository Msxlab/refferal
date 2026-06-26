'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { CountUp, Loading, Modal, MoneyCounter, Pagination, useToast } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Plus, Banknote, Wallet, Clock, Info, Check } from 'lucide-react';

interface MySale {
  id: string;
  amountCents: string;
  currency: string;
  status: 'draft' | 'approved' | 'void';
  saleDate: string;
  customerRef: string | null;
  deliveredAt: string | null;
  myCommissionCents: string;
}
interface MySalesList { total: number; page: number; pageSize: number; items: MySale[] }
interface SalesSummary { currency: string; soldThisMonthCents: string; salesThisMonth: number; soldLifetimeCents: string; earnedThisMonthCents: string }

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MySalesPage() {
  const [list, setList] = useState<MySalesList | null>(null);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [showNew, setShowNew] = useState(false);
  const [amount, setAmount] = useState('');
  const [saleDate, setSaleDate] = useState(todayYmd());
  const [customer, setCustomer] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  const load = useCallback(async () => {
    try { setList(await api.get<MySalesList>(`/app/sales?page=${page}&pageSize=25`)); }
    catch (e) { setError(String((e as ApiError).message)); }
  }, [page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.get<SalesSummary>('/app/dashboard').then(setSummary).catch(() => { /* optional */ }); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormErr('');
    const dollars = parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) { setFormErr('Enter a valid amount greater than 0.'); return; }
    const cents = Math.round(dollars * 100);
    setBusy(true);
    try {
      await api.post('/app/sales', { amountCents: cents, saleDate, ...(customer.trim() ? { customerRef: customer.trim() } : {}) });
      setAmount(''); setCustomer(''); setSaleDate(todayYmd()); setShowNew(false);
      showToast('Sale recorded — pending verification');
      setPage(1);
      await load();
    } catch (e) { setFormErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">{t('anav.sales')}</div>
          <h1 className="h1 fade-in">My Sales</h1>
          <p className="sub fade-in">Record your sales and track their commission.</p>
        </div>
        <button className="btn fade-in" onClick={() => { setFormErr(''); setShowNew(true); }}><Plus className="size-4" aria-hidden />Record sale</button>
      </div>

      {error && <Alert variant="destructive" style={{ marginBottom: 16 }}><AlertDescription>{error}</AlertDescription></Alert>}

      {summary && (
        <div className="stat-grid fade-in delay-1" style={{ marginBottom: 16 }}>
          <div className="card stat lift"><div className="spread"><span className="k">Sold (this month)</span><span className="icon"><Banknote className="size-[18px]" aria-hidden /></span></div><div className="v"><MoneyCounter cents={Number(summary.soldThisMonthCents)} currency={summary.currency} /></div><div className="hint">{summary.salesThisMonth} sales · {money(summary.soldLifetimeCents, summary.currency)} lifetime</div></div>
          <div className="card stat lift"><div className="spread"><span className="k">Earned (this month)</span><span className="icon" style={{ background: 'var(--foil)' }}><Wallet className="size-[18px]" aria-hidden /></span></div><div className="v" style={{ color: 'var(--gold-500)' }}><MoneyCounter cents={Number(summary.earnedThisMonthCents)} currency={summary.currency} /></div><div className="hint">commission you earned</div></div>
          <div className="card stat lift"><div className="spread"><span className="k">Awaiting approval</span><span className="icon"><Clock className="size-[18px]" aria-hidden /></span></div><div className="v"><CountUp value={list?.items.filter((s) => s.status === 'draft').length ?? 0} /></div><div className="hint">drafts on this page</div></div>
        </div>
      )}

      {/* the drafts explainer only matters before the first sale */}
      {list && list.total === 0 && (
        <Alert className="fade-in delay-1" style={{ background: 'color-mix(in srgb, var(--sky) 7%, transparent)', borderColor: 'color-mix(in srgb, var(--sky) 30%, transparent)', marginBottom: 16 }}>
          <AlertDescription className="faint" style={{ fontSize: 12, lineHeight: 1.5, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Info className="size-4" aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Sales you record are <b>drafts</b> until verified by your company. Commission is distributed across your network after approval.</span>
          </AlertDescription>
        </Alert>
      )}

      <div className="card lift fade-in delay-2">
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong>History{list ? ` · ${list.total}` : ''}</strong>
        </div>
        {!list ? <Loading rows={3} /> : list.items.length === 0 ? (
          <div className="muted" style={{ padding: '10px 2px' }}>Record your first sale to start earning commissions.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Date</th><th>Amount</th><th>Customer</th><th>Status</th><th style={{ textAlign: 'right' }}>My commission</th></tr></thead>
              <tbody>
                {list.items.map((s) => (
                  <tr key={s.id}>
                    <td className="muted">{dateShort(s.saleDate)}</td>
                    <td className="tnum" style={{ fontWeight: 650 }}>{money(s.amountCents, s.currency)}</td>
                    <td className="faint" style={{ fontSize: 12 }}>{s.customerRef || '—'}</td>
                    <td>
                      <span className={`badge ${s.status}`}>{s.status}</span>
                      {s.deliveredAt && <span className="badge active" style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center' }} aria-label="Delivered"><Check className="size-3" aria-hidden /></span>}
                    </td>
                    <td className="tnum" style={{ textAlign: 'right', color: Number(s.myCommissionCents) > 0 ? 'var(--emerald)' : 'var(--faint)' }}>
                      {Number(s.myCommissionCents) > 0 ? money(s.myCommissionCents, s.currency) : '—'}
                      {Number(s.myCommissionCents) > 0 && Number(s.amountCents) > 0 && <div className="faint" style={{ fontSize: 11 }}>%{((Number(s.myCommissionCents) / Number(s.amountCents)) * 100).toFixed(1)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list && <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={setPage} />}
      </div>

      {showNew && (
        <Modal title="Record a sale" onClose={() => setShowNew(false)}>
          <form onSubmit={submit} style={{ width: 'min(420px, 88vw)' }}>
            <div className="field">
              <label>Amount</label>
              <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 149.90" required autoFocus />
              <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>In dollars — e.g. 149.90</div>
            </div>
            <div className="field"><label>Sale date</label><input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} required /></div>
            <div className="field"><label>Customer reference (optional)</label><input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. order #1234" /></div>
            {formErr && <Alert variant="destructive" style={{ marginTop: 10 }}><AlertDescription>{formErr}</AlertDescription></Alert>}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn ghost" onClick={() => setShowNew(false)} disabled={busy}>Cancel</button>
              <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Submit sale'}</button>
            </div>
          </form>
        </Modal>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
