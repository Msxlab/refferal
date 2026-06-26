'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Donut, Loading, MoneyCounter, StatCard } from '@/components/ui';
import { TrendChart } from '@/components/TrendChart';
import { useLiveRefresh } from '@/components/LiveIndicator';
import { bps, money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContinuousTabs } from '@/components/ui/continuous-tabs';

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
const TODO_ICON_COLOR: Record<string, string> = {
  sales_approval: 'text-muted-foreground', payout_requests: 'text-primary',
  checks_to_process: 'text-muted-foreground', fraud_review: 'text-destructive',
};

interface Cohorts {
  cohorts: { cohort: string; joined: number; active: number; churned: number; producing: number; retentionPct: number; activationPct: number }[];
  totals: { joined: number; active: number; producing: number; churned: number; retentionPct: number };
}

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
  const [cohorts, setCohorts] = useState<Cohorts | null>(null);
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
    api.get<Cohorts>('/admin/cohorts').then(setCohorts).catch(() => { /* opsiyonel */ });
  }, []);
  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // canli: satis onayi/odeme oldukca ozet kartlari kendiliginden gunceller
  useLiveRefresh(loadDashboard);

  useEffect(() => {
    setAnalytics(null);
    api.get<Analytics>(`/admin/analytics?months=${months}`).then(setAnalytics).catch(() => {});
  }, [months]);

  if (error) return <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>;
  if (!data) return <Loading />;

  const c = data.currency;
  const revenue = Number(data.thisMonth.revenueCents);
  const commission = Number(data.thisMonth.commissionCents);
  const net = Math.max(0, revenue - commission);

  // commission-owed stacked bar segments
  const liaPending = Number(data.liability.pendingCents);
  const liaPayable = Number(data.liability.payableCents);
  const liaInPayout = Number(data.liability.inPayoutCents);
  const liaTotal = Math.max(1, liaPending + liaPayable + liaInPayout);

  return (
    <div className="mx-auto max-w-[1160px]">
      {/* ---- header ---- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">{t('nav.dashboard')} · {data.month}</div>
          <h1 className="mt-1 font-display text-[27px] font-extrabold tracking-tight text-foreground">{t('dash.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('dash.sub')}</p>
        </div>
        <div className="flex items-center gap-2 no-print">
          {fin && (
            <Badge variant="outline" className={fin.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-destructive/40 bg-destructive/10 text-destructive'}>
              {fin.ok ? '✓ Books balanced' : `✗ ${fin.payoutMismatches.length + fin.summaryMismatches.length} issue(s)`}
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={verifyFinancials} disabled={finBusy}>{finBusy ? 'Checking…' : '⚖ Verify financials'}</Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}>🖶 Print report</Button>
        </div>
      </div>

      {/* ---- Yapilacaklar (C4): bekleyen eylemler / Needs your attention ---- */}
      {todo && todo.total > 0 && (
        <Card className="mt-5 border-primary/30 bg-card p-4 shadow-lg sm:p-[18px]">
          <div className="mb-3 flex items-center justify-between">
            <strong className="text-sm text-foreground">Needs your attention</strong>
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400">{todo.total} item{todo.total === 1 ? '' : 's'}</Badge>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {todo.items.map((it) => (
              <Link
                key={it.key}
                href={it.href}
                className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-[13px] transition-colors hover:border-input hover:bg-muted"
              >
                <span className={`text-lg ${TODO_ICON_COLOR[it.key] ?? 'text-muted-foreground'}`}>{TODO_ICON[it.key] ?? '•'}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[19px] font-bold leading-none text-foreground tabular-nums">{it.count}</div>
                  <div className="mt-[3px] text-[11.5px] text-muted-foreground/70">{it.label}</div>
                </div>
                <span className="text-muted-foreground/70">→</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* ---- ilk-kurulum rehberi: %100'de gizlenir ---- */}
      {onboarding && onboarding.percent < 100 && (
        <Card className="mt-4 border-primary/50 bg-card p-[18px] shadow-lg ring-1 ring-primary/20">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <strong className="text-base text-foreground">Get your referral program running</strong>
              <div className="mt-0.5 text-[13px] text-muted-foreground/70">Finish setup to start tracking referrals and paying commissions.</div>
            </div>
            <div className="flex-shrink-0 text-right">
              <div className="font-display text-[22px] font-extrabold text-foreground tabular-nums">{onboarding.percent}%</div>
              <div className="text-xs text-muted-foreground/70">{onboarding.done} of {onboarding.total}</div>
            </div>
          </div>
          <div className="mb-3.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${onboarding.percent}%` }} />
          </div>
          <div>
            {onboarding.steps.map((s) => (
              <div key={s.key} className="flex items-center gap-3 border-t border-border py-[9px]">
                <span className={`w-[18px] text-center text-base ${s.done ? 'text-emerald-400' : 'text-muted-foreground/70'}`}>{s.done ? '✓' : '○'}</span>
                <span className={`flex-1 text-sm ${s.done ? 'text-muted-foreground' : 'text-foreground'}`}>{s.label}</span>
                {s.done
                  ? <span className="text-xs text-muted-foreground/70">Done</span>
                  : s.cta
                    ? <Button asChild variant="ghost" size="sm"><Link href={s.cta}>{CTA_LABEL[s.key] ?? 'Open'} →</Link></Button>
                    : <span className="text-xs text-muted-foreground/70">Pending</span>}
              </div>
            ))}
          </div>
          <div className="mt-2.5 text-[11px] text-muted-foreground/70">This guide hides automatically once every step is done.</div>
        </Card>
      )}

      {/* ---- hero revenue + donut ---- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card className="relative overflow-hidden bg-card p-6 shadow-lg">
          <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent opacity-45" />
          <div className="text-xs text-muted-foreground">{t('dash.revenue')}</div>
          <div className="mt-1.5 font-display text-[46px] font-extrabold leading-[1.04] tracking-tight text-foreground tabular-nums">
            <MoneyCounter cents={revenue} currency={c} />
          </div>
          <div className="mt-[22px] flex flex-wrap gap-x-8 gap-y-4">
            <div>
              <div className="text-[11px] text-muted-foreground/70">{t('dash.commission')}</div>
              <div className="mt-[3px] text-[15px] font-bold text-foreground tabular-nums">{money(commission, c)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground/70">{t('dash.effRate')}</div>
              <div className="mt-[3px] text-[15px] font-bold text-foreground tabular-nums">{bps(data.thisMonth.effectiveRateBps)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground/70">{t('dash.approvedSales')}</div>
              <div className="mt-[3px] text-[15px] font-bold text-foreground tabular-nums">{data.thisMonth.approvedSalesCount}</div>
            </div>
            <div>
              <div className="text-[11px] text-emerald-400">Net to company</div>
              <div className="mt-[3px] text-[15px] font-bold text-emerald-400 tabular-nums">{money(net, c)}</div>
            </div>
          </div>
        </Card>

        <Card className="grid place-items-center bg-card p-[18px] shadow-lg">
          <Donut
            segments={[
              { label: 'Net', value: net, color: 'var(--emerald, #34d399)' },
              { label: t('dash.commission'), value: commission, color: 'hsl(var(--primary))' },
            ]}
            center={
              <div className="text-center">
                <div className="text-[11px] text-muted-foreground/70">{t('dash.commissionShare')}</div>
                <div className="font-display text-lg font-extrabold text-foreground tabular-nums">{bps(data.thisMonth.effectiveRateBps)}</div>
              </div>
            }
          />
        </Card>
      </div>

      {/* ---- 3-up stat cards ---- */}
      <div className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t('dash.payable')} value={money(data.outstandingPayableCents, c)} icon="◆" hint={t('dash.payableHint')} />
        <StatCard label={t('dash.members')} value={`${data.members.active} / ${data.members.total}`} icon="⬡" hint={t('dash.membersHint')} />
        {data.pendingPayoutRequests > 0
          ? <Link href="/admin/payouts" title="Go to payouts" className="block"><StatCard label={`${t('dash.pendingReq')} →`} value={String(data.pendingPayoutRequests)} icon="◷" hint={t('dash.requestsHint')} /></Link>
          : <StatCard label={t('dash.pendingReq')} value={String(data.pendingPayoutRequests)} icon="◷" hint={t('dash.requestsHint')} />}
      </div>

      {/* ---- borc kirilimi (stacked bar) + en cok kazananlar ---- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card className="bg-card p-[18px] shadow-lg">
          <strong className="text-[13px] text-foreground">Commission owed (to members)</strong>
          <div className="mb-3.5 mt-[3px] text-[11px] text-muted-foreground/70">What the company owes members — by maturation and payout state.</div>
          <div className="flex flex-col gap-[11px]">
            <div className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-amber-400" />Pending (not yet matured)</span>
              <strong className="text-foreground tabular-nums">{money(data.liability.pendingCents, c)}</strong>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-sky-400" />Payable (ready)</span>
              <strong className="text-foreground tabular-nums">{money(data.liability.payableCents, c)}</strong>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-400" />In payout</span>
              <strong className="text-foreground tabular-nums">{money(data.liability.inPayoutCents, c)}</strong>
            </div>
          </div>
          <div className="mt-4 flex h-[9px] overflow-hidden rounded-md bg-muted">
            <div className="bg-amber-400" style={{ width: `${(liaPending / liaTotal) * 100}%` }} />
            <div className="bg-sky-400" style={{ width: `${(liaPayable / liaTotal) * 100}%` }} />
            <div className="bg-emerald-400" style={{ width: `${(liaInPayout / liaTotal) * 100}%` }} />
          </div>
        </Card>

        <Card className="bg-card p-[18px] shadow-lg">
          <strong className="text-[13px] text-foreground">Top earners · {data.month}</strong>
          <div className="mb-3 mt-[3px] text-[11px] text-muted-foreground/70">Members with the highest commission this month.</div>
          {data.topEarners.length === 0 ? (
            <span className="text-[13px] text-muted-foreground">No commission yet this month.</span>
          ) : (
            <div className="flex flex-col gap-[9px]">
              {data.topEarners.map((e, i) => (
                <div key={e.membershipId} className="flex items-center justify-between text-[13px]">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="w-[18px] text-[12px] text-muted-foreground/70 tabular-nums">{i + 1}.</span>
                    <span className="truncate font-semibold text-foreground">{e.fullName}</span>
                    <span className="text-[11px] text-muted-foreground/70">{e.referralCode}</span>
                  </span>
                  <strong className="text-primary tabular-nums">{money(e.earnedCents, c)}</strong>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ---- analitik: zaman serisi + karsilastirma + huni + top performers ---- */}
      <div className="mb-3.5 mt-7 flex items-end justify-between">
        <div>
          <h2 className="font-display text-lg font-[750] text-foreground">Performance</h2>
          <span className="text-xs text-muted-foreground/70">Trends and comparison vs the previous period.</span>
        </div>
        <div className="no-print">
          <ContinuousTabs
            tabs={RANGES.map((r) => ({ id: String(r), label: `${r}M` }))}
            defaultActiveId={String(months)}
            onChange={(id) => setMonths(Number(id))}
          />
        </div>
      </div>

      {!analytics ? (
        <Loading rows={3} />
      ) : (
        <>
          <Card className="mb-4 bg-card p-[18px] shadow-lg">
            <div className="mb-3.5 flex flex-wrap gap-x-8 gap-y-4">
              <Metric label="Revenue" value={money(analytics.totals.revenueCents, c)} delta={analytics.deltas.revenuePct} />
              <Metric label="Commission" value={money(analytics.totals.commissionCents, c)} delta={analytics.deltas.commissionPct} invertGood />
              <Metric label="Approved sales" value={String(analytics.totals.approvedSales)} delta={analytics.deltas.salesPct} />
              <Metric label="Effective rate" value={bps(analytics.totals.effectiveRateBps)} />
            </div>
            <TrendChart series={analytics.series} currency={c} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <Card className="bg-card p-[18px] shadow-lg">
              <strong className="text-sm text-foreground">Sales funnel</strong>
              <div className="mb-4 mt-[3px] text-xs text-muted-foreground/70">Status mix over the selected window.</div>
              <Funnel funnel={analytics.funnel} currency={c} />
            </Card>

            <Card className="overflow-hidden bg-card p-0 shadow-lg">
              <div className="px-[18px] pb-2 pt-4">
                <strong className="text-sm text-foreground">Top performers</strong>
                <div className="text-xs text-muted-foreground/70">By approved revenue in this window.</div>
              </div>
              {analytics.topPerformers.length === 0 ? (
                <div className="p-[18px] text-sm text-muted-foreground">No approved sales in this window.</div>
              ) : (
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left">
                      <th className="px-[18px] py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Member</th>
                      <th className="px-[18px] py-2 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Sales</th>
                      <th className="px-[18px] py-2 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topPerformers.map((p, i) => (
                      <tr key={p.membershipId} className="border-t border-border">
                        <td className="px-[18px] py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className={`grid h-[22px] w-[22px] place-items-center rounded-md text-[11px] font-extrabold ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{i + 1}</span>
                            <div>
                              <div className="font-semibold text-foreground">{p.fullName}</div>
                              <div className="font-mono text-[11px] text-muted-foreground/70">{p.referralCode}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-[18px] py-2.5 text-right text-muted-foreground tabular-nums">{p.salesCount}</td>
                        <td className="px-[18px] py-2.5 text-right font-bold text-foreground tabular-nums">{money(p.revenueCents, c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}

      {/* ---- Kohort retention/churn (D3) — yazdirilabilir ---- */}
      {cohorts && cohorts.cohorts.length > 0 && (
        <Card className="mt-4 bg-card p-[18px] shadow-lg">
          <div className="mb-1 flex items-center justify-between">
            <strong className="text-[15px] text-foreground">Member cohorts — retention &amp; churn</strong>
            <span className="text-xs text-muted-foreground/70">{cohorts.totals.retentionPct}% still active · {cohorts.totals.churned} churned</span>
          </div>
          <div className="mb-3 text-xs text-muted-foreground/70">Members grouped by the month they joined. “Producing” = made an approved sale in the last 30 days.</div>
          <div className="overflow-x-auto rounded-xl border border-border bg-muted/40">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left">
                  <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Joined</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Members</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Still active</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Retention</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Producing</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Churned</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.cohorts.map((co) => (
                  <tr key={co.cohort} className="border-t border-border">
                    <td className="px-3 py-2.5 text-foreground">{co.cohort}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{co.joined}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{co.active}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <span className="inline-block h-1.5 w-11 overflow-hidden rounded bg-muted">
                          <span className={`block h-full ${co.retentionPct >= 60 ? 'bg-emerald-400' : co.retentionPct >= 30 ? 'bg-amber-400' : 'bg-destructive'}`} style={{ width: `${co.retentionPct}%` }} />
                        </span>
                        <span className="min-w-[34px] font-semibold tabular-nums">{co.retentionPct}%</span>
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${co.producing > 0 ? 'text-emerald-400' : 'text-muted-foreground/70'}`}>{co.producing} <span className="text-muted-foreground/70">({co.activationPct}%)</span></td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${co.churned > 0 ? 'text-muted-foreground/70' : ''}`}>{co.churned || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-bold">
                  <td className="px-3 py-2.5">All</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{cohorts.totals.joined}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{cohorts.totals.active}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{cohorts.totals.retentionPct}%</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{cohorts.totals.producing}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{cohorts.totals.churned}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, delta, invertGood }: { label: string; value: string; delta?: number | null; invertGood?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 text-[19px] font-[750] text-foreground tabular-nums">{value}</div>
      {delta !== undefined && <Delta pct={delta} invertGood={invertGood} />}
    </div>
  );
}

function Delta({ pct, invertGood }: { pct: number | null; invertGood?: boolean }) {
  if (pct === null) return <span className="text-[11px] text-muted-foreground/70">— new</span>;
  const up = pct > 0;
  const flat = pct === 0;
  const good = flat ? null : invertGood ? !up : up;
  const color = good === null ? 'text-muted-foreground' : good ? 'text-emerald-400' : 'text-destructive';
  return (
    <span className={`mt-[3px] flex items-center gap-1 text-[11.5px] font-[650] ${color}`}>
      {flat ? '→' : up ? '▲' : '▼'} {Math.abs(pct)}%
      <span className="font-normal text-muted-foreground/70">vs prev</span>
    </span>
  );
}

function Funnel({ funnel, currency }: { funnel: Record<'draft' | 'approved' | 'void', { count: number; amountCents: string }>; currency: string }) {
  const rows: Array<{ k: 'draft' | 'approved' | 'void'; label: string; color: string }> = [
    { k: 'draft', label: 'Draft', color: 'bg-muted-foreground' },
    { k: 'approved', label: 'Approved', color: 'bg-emerald-400' },
    { k: 'void', label: 'Void', color: 'bg-destructive' },
  ];
  const max = Math.max(1, ...rows.map((r) => funnel[r.k].count));
  return (
    <div className="flex flex-col gap-3.5">
      {rows.map((r) => {
        const f = funnel[r.k];
        return (
          <div key={r.k}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12.5px] text-foreground">
                <span className={`h-[9px] w-[9px] rounded-sm ${r.color}`} /> {r.label}
              </span>
              <span className="text-[12.5px] text-muted-foreground tabular-nums">{f.count} · {money(f.amountCents, currency)}</span>
            </div>
            <div className="h-[9px] overflow-hidden rounded-md bg-muted">
              <div className={`h-full rounded-md ${r.color} transition-[width] duration-700`} style={{ width: `${(f.count / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
