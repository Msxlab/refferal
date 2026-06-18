'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Donut, Loading, MoneyCounter, StatCard } from '@/components/ui';
import { TrendChart } from '@/components/TrendChart';
import { useLiveRefresh } from '@/components/LiveIndicator';
import { bps, money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Dashboard {
  month: string;
  currency: string;
  members: { total: number; active: number };
  thisMonth: { approvedSalesCount: number; revenueCents: string; commissionCents: string; effectiveRateBps: number };
  outstandingPayableCents: string;
  liability: { pendingCents: string; payableCents: string; inPayoutCents: string };
  topEarners: { membershipId: string; fullName: string; referralCode: string; earnedCents: string }[];
  pendingPayoutRequests: number;
}

interface Analytics {
  currency: string;
  range: { months: number; from: string; to: string };
  series: Array<{ month: string; revenueCents: string; commissionCents: string; approvedSales: number }>;
  totals: { revenueCents: string; commissionCents: string; approvedSales: number; effectiveRateBps: number };
  previous: { revenueCents: string; commissionCents: string; approvedSales: number };
  deltas: { revenuePct: number | null; commissionPct: number | null; salesPct: number | null };
  funnel: Record<'draft' | 'approved' | 'void', { count: number; amountCents: string }>;
  topPerformers: Array<{ membershipId: string; fullName: string; referralCode: string; revenueCents: string; salesCount: number }>;
}

interface Onboarding {
  steps: { key: string; label: string; done: boolean; cta: string | null }[];
  done: number; total: number; percent: number;
}

interface Todo {
  items: { key: string; label: string; count: number; href: string }[];
  total: number;
}
const TODO_ICON: Record<string, string> = {
  sales_approval: '◇', payout_requests: '◆', checks_to_process: '🖶', fraud_review: '⚑',
};

const RANGES = [3, 6, 12];
const CTA_LABEL: Record<string, string> = {
  invite_team: 'Invite members',
  first_sale: 'Record a sale',
  first_payout: 'Go to payouts',
};

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [todo, setTodo] = useState<Todo | null>(null);
  const [months, setMonths] = useState(6);
  const [error, setError] = useState('');
  const [fin, setFin] = useState<{ ok: boolean; payoutMismatches: unknown[]; summaryMismatches: unknown[] } | null>(null);
  const [finBusy, setFinBusy] = useState(false);

  async function verifyFinancials() {
    setFinBusy(true);
    try { setFin(await api.get('/admin/financials/verify')); }
    catch (e) { setError(String((e as ApiError).message)); } finally { setFinBusy(false); }
  }

  const loadDashboard = useCallback(() => {
    api.get<Dashboard>('/admin/dashboard').then(setData).catch((e) => setError(String((e as ApiError).message)));
    api.get<Onboarding>('/admin/onboarding').then(setOnboarding).catch(() => { /* opsiyonel */ });
    api.get<Todo>('/admin/todo').then(setTodo).catch(() => { /* opsiyonel */ });
  }, []);
  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // canli: satis onayi/odeme oldukca ozet kartlari kendiliginden gunceller
  useLiveRefresh(loadDashboard);

  useEffect(() => {
    setAnalytics(null);
    api.get<Analytics>(`/admin/analytics?months=${months}`).then(setAnalytics).catch(() => {});
  }, [months]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <Loading />;

  const c = data.currency;
  const revenue = Number(data.thisMonth.revenueCents);
  const commission = Number(data.thisMonth.commissionCents);
  const net = Math.max(0, revenue - commission);

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">{t('nav.dashboard')} · {data.month}</div>
          <h1 className="h1 fade-in">{t('dash.title')}</h1>
          <p className="sub fade-in">{t('dash.sub')}</p>
        </div>
        <div className="row fade-in no-print" style={{ gap: 8 }}>
          {fin && <span className={`badge ${fin.ok ? 'active' : 'failed'}`}>{fin.ok ? '✓ Books balanced' : `✗ ${fin.payoutMismatches.length + fin.summaryMismatches.length} issue(s)`}</span>}
          <button className="btn ghost" onClick={verifyFinancials} disabled={finBusy}>{finBusy ? 'Checking…' : '⚖ Verify financials'}</button>
          <button className="btn ghost" onClick={() => window.print()}>🖶 Print report</button>
        </div>
      </div>

      {/* ---- Yapilacaklar (C4): bekleyen eylemler ---- */}
      {todo && todo.total > 0 && (
        <div className="card fade-in" style={{ marginTop: 16, marginBottom: 16, borderColor: 'color-mix(in srgb, var(--gold-500) 30%, transparent)' }}>
          <div className="spread" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 15 }}>Needs your attention</strong>
            <span className="badge pending" style={{ fontSize: 10 }}>{todo.total} item{todo.total === 1 ? '' : 's'}</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
            {todo.items.map((it) => (
              <Link key={it.key} href={it.href} className="card hover" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', padding: 14 }}>
                <span style={{ fontSize: 20 }}>{TODO_ICON[it.key] ?? '•'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 18, lineHeight: 1 }}>{it.count}</div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>{it.label}</div>
                </div>
                <span className="faint" style={{ fontSize: 16 }}>→</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ---- ilk-kurulum rehberi: %100'de gizlenir ---- */}
      {onboarding && onboarding.percent < 100 && (
        <div className="card fade-in" style={{ marginBottom: 18, border: '1px solid var(--gold-500)', boxShadow: 'var(--shadow-glow)' }}>
          <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <strong style={{ fontSize: 16 }}>Get your referral program running</strong>
              <div className="faint" style={{ fontSize: 13, marginTop: 2 }}>Finish setup to start tracking referrals and paying commissions.</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 22 }}>{onboarding.percent}%</div>
              <div className="faint" style={{ fontSize: 12 }}>{onboarding.done} of {onboarding.total}</div>
            </div>
          </div>
          <div style={{ height: 6, background: 'var(--panel-3)', borderRadius: 3, marginBottom: 14 }}>
            <div style={{ height: '100%', width: `${onboarding.percent}%`, borderRadius: 3, background: 'var(--foil)', transition: 'width .7s' }} />
          </div>
          <div>
            {onboarding.steps.map((s) => (
              <div key={s.key} className="row" style={{ gap: 12, padding: '9px 0', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
                <span style={{ fontSize: 16, width: 18, textAlign: 'center', color: s.done ? 'var(--emerald)' : 'var(--faint)' }}>{s.done ? '✓' : '○'}</span>
                <span style={{ flex: 1, fontSize: 14, color: s.done ? 'var(--muted)' : 'var(--text)' }}>{s.label}</span>
                {s.done
                  ? <span className="faint" style={{ fontSize: 12 }}>Done</span>
                  : s.cta
                    ? <Link href={s.cta} className="btn ghost sm">{CTA_LABEL[s.key] ?? 'Open'} →</Link>
                    : <span className="faint" style={{ fontSize: 12 }}>Pending</span>}
              </div>
            ))}
          </div>
          <div className="faint" style={{ fontSize: 11, marginTop: 10 }}>This guide hides automatically once every step is done.</div>
        </div>
      )}

      <div className="grid stack-sm fade-in delay-1" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
        <div className="card hero">
          <div className="faint" style={{ fontSize: 12 }}>{t('dash.revenue')}</div>
          <div className="bignum gradient-text" style={{ marginTop: 6 }}><MoneyCounter cents={revenue} currency={c} /></div>
          <div className="row" style={{ marginTop: 18, gap: 22 }}>
            <div>
              <div className="faint" style={{ fontSize: 11 }}>{t('dash.commission')}</div>
              <div className="tnum" style={{ fontWeight: 700 }}>{money(commission, c)}</div>
            </div>
            <div>
              <div className="faint" style={{ fontSize: 11 }}>{t('dash.effRate')}</div>
              <div className="tnum" style={{ fontWeight: 700 }}>{bps(data.thisMonth.effectiveRateBps)}</div>
            </div>
            <div>
              <div className="faint" style={{ fontSize: 11 }}>{t('dash.approvedSales')}</div>
              <div className="tnum" style={{ fontWeight: 700 }}>{data.thisMonth.approvedSalesCount}</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ display: 'grid', placeItems: 'center' }}>
          <Donut
            segments={[
              { label: 'Net', value: net, color: 'var(--emerald)' },
              { label: t('dash.commission'), value: commission, color: 'var(--primary)' },
            ]}
            center={
              <div>
                <div className="faint" style={{ fontSize: 11 }}>{t('dash.commissionShare')}</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{bps(data.thisMonth.effectiveRateBps)}</div>
              </div>
            }
          />
        </div>
      </div>

      <div className="stat-grid fade-in delay-2" style={{ marginTop: 16 }}>
        <StatCard label={t('dash.payable')} value={money(data.outstandingPayableCents, c)} icon="◆" hint={t('dash.payableHint')} />
        <StatCard label={t('dash.members')} value={`${data.members.active} / ${data.members.total}`} icon="⬡" hint={t('dash.membersHint')} />
        {data.pendingPayoutRequests > 0
          ? <a href="/admin/payouts" style={{ textDecoration: 'none' }} title="Go to payouts"><StatCard label={`${t('dash.pendingReq')} →`} value={String(data.pendingPayoutRequests)} icon="◷" hint={t('dash.requestsHint')} /></a>
          : <StatCard label={t('dash.pendingReq')} value={String(data.pendingPayoutRequests)} icon="◷" hint={t('dash.requestsHint')} />}
      </div>

      {/* ---- borc kirilimi + en cok kazananlar ---- */}
      <div className="grid stack-sm fade-in delay-2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)', gap: 16, marginTop: 16 }}>
        <div className="card">
          <strong style={{ fontSize: 13 }}>Commission owed (to members)</strong>
          <div className="faint" style={{ fontSize: 11, marginBottom: 12 }}>What the company owes members — by maturation and payout state.</div>
          <div className="grid" style={{ gap: 8 }}>
            <div className="row spread"><span className="row" style={{ gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--amber)' }} />Pending (not yet matured)</span><strong className="tnum">{money(data.liability.pendingCents, c)}</strong></div>
            <div className="row spread"><span className="row" style={{ gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--sky)' }} />Payable (ready)</span><strong className="tnum">{money(data.liability.payableCents, c)}</strong></div>
            <div className="row spread"><span className="row" style={{ gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--emerald)' }} />In payout</span><strong className="tnum">{money(data.liability.inPayoutCents, c)}</strong></div>
          </div>
        </div>
        <div className="card">
          <strong style={{ fontSize: 13 }}>Top earners · {data.month}</strong>
          <div className="faint" style={{ fontSize: 11, marginBottom: 10 }}>Members with the highest commission this month.</div>
          {data.topEarners.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>No commission yet this month.</span> : (
            <div className="grid" style={{ gap: 6 }}>
              {data.topEarners.map((e, i) => (
                <div key={e.membershipId} className="row spread" style={{ fontSize: 13 }}>
                  <span className="row" style={{ gap: 8, minWidth: 0 }}><span className="faint tnum" style={{ width: 18 }}>{i + 1}.</span><span style={{ fontWeight: 600 }}>{e.fullName}</span><span className="faint" style={{ fontSize: 11 }}>{e.referralCode}</span></span>
                  <strong className="tnum" style={{ color: 'var(--gold-500)' }}>{money(e.earnedCents, c)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- analitik: zaman serisi + karsilastirma + huni + top performers ---- */}
      <div className="spread fade-in" style={{ marginTop: 28, marginBottom: 14, alignItems: 'flex-end' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 750, margin: 0 }}>Performance</h2>
          <span className="faint" style={{ fontSize: 12 }}>Trends and comparison vs the previous period.</span>
        </div>
        <div className="seg-tabs no-print" role="tablist">
          {RANGES.map((r) => (
            <button key={r} className={`seg-tab ${months === r ? 'on' : ''}`} onClick={() => setMonths(r)} role="tab" aria-selected={months === r}>
              {r}M
            </button>
          ))}
        </div>
      </div>

      {!analytics ? (
        <Loading rows={3} />
      ) : (
        <>
          <div className="card fade-in" style={{ marginBottom: 16 }}>
            <div className="row" style={{ gap: 22, marginBottom: 14, flexWrap: 'wrap' }}>
              <Metric label="Revenue" value={money(analytics.totals.revenueCents, c)} delta={analytics.deltas.revenuePct} />
              <Metric label="Commission" value={money(analytics.totals.commissionCents, c)} delta={analytics.deltas.commissionPct} invertGood />
              <Metric label="Approved sales" value={String(analytics.totals.approvedSales)} delta={analytics.deltas.salesPct} />
              <Metric label="Effective rate" value={bps(analytics.totals.effectiveRateBps)} />
            </div>
            <TrendChart series={analytics.series} currency={c} />
          </div>

          <div className="grid stack-sm fade-in" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)', gap: 16 }}>
            <div className="card">
              <strong style={{ fontSize: 14 }}>Sales funnel</strong>
              <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>Status mix over the selected window.</div>
              <Funnel funnel={analytics.funnel} currency={c} />
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 18px 10px' }}>
                <strong style={{ fontSize: 14 }}>Top performers</strong>
                <div className="faint" style={{ fontSize: 12 }}>By approved revenue in this window.</div>
              </div>
              {analytics.topPerformers.length === 0 ? (
                <div className="muted" style={{ padding: 18 }}>No approved sales in this window.</div>
              ) : (
                <table>
                  <thead><tr><th>Member</th><th style={{ textAlign: 'right' }}>Sales</th><th style={{ textAlign: 'right' }}>Revenue</th></tr></thead>
                  <tbody>
                    {analytics.topPerformers.map((p, i) => (
                      <tr key={p.membershipId}>
                        <td>
                          <div className="row" style={{ gap: 9 }}>
                            <span style={{ width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, background: i === 0 ? 'var(--foil)' : 'var(--panel-2)', color: i === 0 ? 'var(--on-gold)' : 'var(--muted)' }}>{i + 1}</span>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.fullName}</div>
                              <div className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{p.referralCode}</div>
                            </div>
                          </div>
                        </td>
                        <td className="tnum" style={{ textAlign: 'right' }}>{p.salesCount}</td>
                        <td className="tnum" style={{ textAlign: 'right', fontWeight: 700 }}>{money(p.revenueCents, c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, delta, invertGood }: { label: string; value: string; delta?: number | null; invertGood?: boolean }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div className="tnum" style={{ fontWeight: 750, fontSize: 19, marginTop: 2 }}>{value}</div>
      {delta !== undefined && <Delta pct={delta} invertGood={invertGood} />}
    </div>
  );
}

function Delta({ pct, invertGood }: { pct: number | null; invertGood?: boolean }) {
  if (pct === null) return <span className="faint" style={{ fontSize: 11 }}>— new</span>;
  const up = pct > 0;
  const flat = pct === 0;
  const good = flat ? null : invertGood ? !up : up;
  const color = good === null ? 'var(--muted)' : good ? 'var(--emerald)' : 'var(--rose)';
  return (
    <span className="row" style={{ gap: 4, fontSize: 11.5, color, marginTop: 3, fontWeight: 650 }}>
      {flat ? '→' : up ? '▲' : '▼'} {Math.abs(pct)}%
      <span className="faint" style={{ fontWeight: 400 }}>vs prev</span>
    </span>
  );
}

function Funnel({ funnel, currency }: { funnel: Record<'draft' | 'approved' | 'void', { count: number; amountCents: string }>; currency: string }) {
  const rows: Array<{ k: 'draft' | 'approved' | 'void'; label: string; color: string }> = [
    { k: 'draft', label: 'Draft', color: 'var(--muted)' },
    { k: 'approved', label: 'Approved', color: 'var(--emerald)' },
    { k: 'void', label: 'Void', color: 'var(--rose)' },
  ];
  const max = Math.max(1, ...rows.map((r) => funnel[r.k].count));
  return (
    <div className="grid" style={{ gap: 12 }}>
      {rows.map((r) => {
        const f = funnel[r.k];
        return (
          <div key={r.k}>
            <div className="spread" style={{ marginBottom: 5 }}>
              <span className="row" style={{ gap: 7, fontSize: 12.5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: r.color }} /> {r.label}
              </span>
              <span className="tnum" style={{ fontSize: 12.5 }}>{f.count} · {money(f.amountCents, currency)}</span>
            </div>
            <div style={{ height: 9, borderRadius: 6, background: 'rgba(255,255,255,.05)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(f.count / max) * 100}%`, borderRadius: 6, background: r.color, transition: 'width .7s cubic-bezier(.2,.9,.3,1)' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
