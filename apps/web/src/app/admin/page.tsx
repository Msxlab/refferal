'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { sparkle } from '@/lib/celebrate';
import { CountUp, Donut, Loading, MoneyCounter, StatCard, TrendBadge } from '@/components/ui';
import { TrendChart } from '@/components/TrendChart';
import { useLiveRefresh } from '@/components/LiveIndicator';
import { bps, money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContinuousTabs } from '@/components/ui/continuous-tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, Check, X, Scale, Printer, Wallet, Flag, Clock, ArrowRight, CheckCircle2, Circle, Users, Diamond, Sparkles } from 'lucide-react';

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
const TODO_ICON: Record<string, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  sales_approval: Diamond, payout_requests: Wallet, checks_to_process: Printer, fraud_review: Flag,
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

  // kucuk kutlama: bir kurulum adimi tamamlandikca tek seferlik parlama (her render'da degil)
  const prevPercentRef = useRef<number | null>(null);
  useEffect(() => {
    const p = onboarding?.percent;
    if (p === undefined) return;
    const prev = prevPercentRef.current;
    if (prev !== null && p > prev && p < 100) sparkle();
    prevPercentRef.current = p;
  }, [onboarding?.percent]);

  if (error)
    return (
      <div className="mx-auto max-w-[1160px]">
        <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">{t('nav.dashboard')}</div>
        <h1 className="mt-1 font-display text-[27px] font-extrabold tracking-tight text-foreground">{t('dash.title')}</h1>
        <Alert variant="destructive" className="mt-4">
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Button
              variant="ghost"
              size="sm"
              className="self-start sm:self-auto"
              onClick={() => { setError(''); loadDashboard(); }}
            >
              <RefreshCw className="size-4" aria-hidden /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
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
            fin.ok ? (
              <Badge
                variant="outline"
                style={{ borderColor: 'color-mix(in srgb, var(--emerald) 40%, transparent)', backgroundColor: 'color-mix(in srgb, var(--emerald) 10%, transparent)', color: 'var(--emerald)' }}
              >
                <Check className="size-4" aria-hidden /> Books balanced
              </Badge>
            ) : (
              <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                <X className="size-4" aria-hidden /> {fin.payoutMismatches.length + fin.summaryMismatches.length} issue(s)
              </Badge>
            )
          )}
          <Button variant="ghost" size="sm" onClick={verifyFinancials} disabled={finBusy}>{finBusy ? 'Checking…' : <><Scale className="size-4" aria-hidden /> Verify financials</>}</Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print report</Button>
        </div>
      </div>

      {/* ---- Yapilacaklar (C4): bekleyen eylemler / Needs your attention ---- */}
      {todo && todo.total > 0 && (
        <Card className="beam mt-5 border-primary/25 bg-card p-4 glow-primary sm:p-[18px]">
          <div className="mb-3 flex items-center justify-between">
            <strong className="text-sm text-foreground">Needs your attention</strong>
            <Badge
              variant="outline"
              className="text-[10px]"
              style={{ borderColor: 'color-mix(in srgb, var(--amber) 30%, transparent)', backgroundColor: 'color-mix(in srgb, var(--amber) 10%, transparent)', color: 'var(--amber)' }}
            >
              {todo.total} item{todo.total === 1 ? '' : 's'}
            </Badge>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {todo.items.map((it) => (
              <Link
                key={it.key}
                href={it.href}
                className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-[13px] transition-colors hover:border-input hover:bg-muted"
              >
                <span aria-hidden className={`${TODO_ICON_COLOR[it.key] ?? 'text-muted-foreground'}`}>
                  {(() => { const Icon = TODO_ICON[it.key] ?? Circle; return <Icon className="size-[18px]" aria-hidden />; })()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[19px] font-bold leading-none text-foreground tabular-nums">{it.count}</div>
                  <div className="mt-[3px] text-[11.5px] text-muted-foreground/70">{it.label}</div>
                </div>
                <ArrowRight aria-hidden className="size-4 text-muted-foreground/70" />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* ---- ilk-kurulum rehberi (premium kilavuzlu kontrol listesi): %100'de gizlenir ---- */}
      {onboarding && onboarding.percent < 100 && (
        <Card className="beam lift relative mt-4 overflow-hidden border-primary/50 bg-card p-[18px] shadow-lg ring-1 ring-primary/20 glow-primary">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent opacity-60" />
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles aria-hidden className="size-[18px] text-primary" />
                <strong className="text-base text-foreground">Get your referral program running</strong>
              </div>
              <div className="mt-1 text-[13px] text-muted-foreground/70">Finish setup to start tracking referrals and paying commissions.</div>
              <div className="mt-3 flex items-center gap-2.5">
                <Progress value={onboarding.percent} className="h-1.5 w-40 bg-muted sm:w-56" />
                <span className="text-xs font-medium text-muted-foreground/70 tabular-nums">{onboarding.done} of {onboarding.total} done</span>
              </div>
            </div>
            {/* ilerleme halkasi */}
            <div className="relative flex-shrink-0" aria-hidden>
              <svg viewBox="0 0 72 72" width="72" height="72" className="-rotate-90">
                <circle cx="36" cy="36" r="30" fill="none" stroke="hsl(var(--muted))" strokeWidth="7" />
                <circle
                  cx="36" cy="36" r="30" fill="none" stroke="hsl(var(--primary))" strokeWidth="7" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 30}
                  strokeDashoffset={(2 * Math.PI * 30) * (1 - onboarding.percent / 100)}
                  style={{ transition: 'stroke-dashoffset 700ms ease-out' }}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <span className="font-display text-[17px] font-extrabold text-foreground tabular-nums">{onboarding.percent}%</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {onboarding.steps.map((s, i) => (
              <div
                key={s.key}
                className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${s.done ? 'border-border bg-muted/30' : 'border-border bg-muted/40 hover:border-input hover:bg-muted'}`}
              >
                <span
                  aria-hidden
                  className="grid size-7 flex-shrink-0 place-items-center rounded-full"
                  style={s.done
                    ? { color: 'var(--emerald)', background: 'color-mix(in srgb, var(--emerald) 12%, transparent)' }
                    : { borderWidth: 1, borderStyle: 'solid', borderColor: 'hsl(var(--border))' }}
                >
                  {s.done
                    ? <CheckCircle2 className="size-[18px]" aria-hidden />
                    : <span className="text-[11px] font-bold text-muted-foreground/70 tabular-nums">{i + 1}</span>}
                </span>
                <span className={`flex-1 text-sm font-medium ${s.done ? 'text-muted-foreground line-through decoration-muted-foreground/40' : 'text-foreground'}`}>{s.label}</span>
                {s.done
                  ? <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--emerald)' }}><Check className="size-3.5" aria-hidden /> Done</span>
                  : s.cta
                    ? <Button asChild variant="ghost" size="sm"><Link href={s.cta}>{CTA_LABEL[s.key] ?? 'Open'} <ArrowRight className="size-4" aria-hidden /></Link></Button>
                    : <span className="text-xs text-muted-foreground/70">Pending</span>}
              </div>
            ))}
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground/70">This guide hides automatically once every step is done.</div>
        </Card>
      )}

      {/* ---- hero revenue + donut ---- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card className="lift relative overflow-hidden bg-card p-6 shadow-lg">
          <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent opacity-45" />
          <div className="text-xs text-muted-foreground">{t('dash.revenue')}</div>
          <div className="mt-1.5 font-display text-[46px] font-extrabold leading-[1.04] tracking-tight text-foreground tabular-nums">
            <MoneyCounter cents={revenue} currency={c} />
          </div>
          <div className="mt-[22px] flex flex-wrap gap-x-6 gap-y-4 sm:gap-x-8">
            <div>
              <div className="text-[11px] text-muted-foreground/70">{t('dash.commission')}</div>
              <div className="mt-[3px] text-[15px] font-bold text-foreground tabular-nums"><MoneyCounter cents={commission} currency={c} /></div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground/70">{t('dash.effRate')}</div>
              <div className="mt-[3px] text-[15px] font-bold text-foreground tabular-nums">{bps(data.thisMonth.effectiveRateBps)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground/70">{t('dash.approvedSales')}</div>
              <div className="mt-[3px] text-[15px] font-bold text-foreground tabular-nums"><CountUp value={data.thisMonth.approvedSalesCount} /></div>
            </div>
            <div>
              <div className="text-[11px]" style={{ color: 'var(--emerald)' }}>Net to company</div>
              <div className="mt-[3px] text-[15px] font-bold tabular-nums" style={{ color: 'var(--emerald)' }}><MoneyCounter cents={net} currency={c} /></div>
            </div>
          </div>
        </Card>

        <Card className="lift grid place-items-center bg-card p-[18px] shadow-lg">
          <Donut
            segments={[
              { label: 'Net', value: net, color: 'var(--emerald)' },
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
        <StatCard label={t('dash.payable')} value={<MoneyCounter cents={data.outstandingPayableCents} currency={c} />} icon={<Wallet className="size-[18px]" aria-hidden />} hint={t('dash.payableHint')} />
        <StatCard label={t('dash.members')} value={<><CountUp value={data.members.active} /> / <CountUp value={data.members.total} /></>} icon={<Users className="size-[18px]" aria-hidden />} hint={t('dash.membersHint')} />
        {data.pendingPayoutRequests > 0
          ? <Link href="/admin/payouts" title="Go to payouts" className="block"><StatCard label={`${t('dash.pendingReq')} →`} value={<CountUp value={data.pendingPayoutRequests} />} icon={<Clock className="size-[18px]" aria-hidden />} hint={t('dash.requestsHint')} /></Link>
          : <StatCard label={t('dash.pendingReq')} value={<CountUp value={data.pendingPayoutRequests} />} icon={<Clock className="size-[18px]" aria-hidden />} hint={t('dash.requestsHint')} />}
      </div>

      {/* ---- borc kirilimi (stacked bar) + en cok kazananlar ---- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card className="lift bg-card p-[18px] shadow-lg">
          <strong className="text-[13px] text-foreground">Commission owed (to members)</strong>
          <div className="mb-3.5 mt-[3px] text-[11px] text-muted-foreground/70">What the company owes members — by maturation and payout state.</div>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--amber)' }} />Pending (not yet matured)</span>
              <strong className="text-foreground tabular-nums">{money(data.liability.pendingCents, c)}</strong>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--sky)' }} />Payable (ready)</span>
              <strong className="text-foreground tabular-nums">{money(data.liability.payableCents, c)}</strong>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--emerald)' }} />In payout</span>
              <strong className="text-foreground tabular-nums">{money(data.liability.inPayoutCents, c)}</strong>
            </div>
          </div>
          <div className="mt-4 flex h-2 overflow-hidden rounded-md bg-muted">
            <div style={{ background: 'var(--amber)', width: `${(liaPending / liaTotal) * 100}%` }} />
            <div style={{ background: 'var(--sky)', width: `${(liaPayable / liaTotal) * 100}%` }} />
            <div style={{ background: 'var(--emerald)', width: `${(liaInPayout / liaTotal) * 100}%` }} />
          </div>
        </Card>

        <Card className="lift bg-card p-[18px] shadow-lg">
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
          <Card className="lift mb-4 bg-card p-[18px] shadow-lg">
            <div className="mb-3.5 flex flex-wrap gap-x-6 gap-y-4 sm:gap-x-8">
              <Metric label="Revenue" value={money(analytics.totals.revenueCents, c)} delta={analytics.deltas.revenuePct} />
              <Metric label="Commission" value={money(analytics.totals.commissionCents, c)} delta={analytics.deltas.commissionPct} />
              <Metric label="Approved sales" value={String(analytics.totals.approvedSales)} delta={analytics.deltas.salesPct} />
              <Metric label="Effective rate" value={bps(analytics.totals.effectiveRateBps)} />
            </div>
            <TrendChart series={analytics.series} currency={c} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <Card className="lift bg-card p-[18px] shadow-lg">
              <strong className="text-sm text-foreground">Sales funnel</strong>
              <div className="mb-4 mt-[3px] text-xs text-muted-foreground/70">Status mix over the selected window.</div>
              <Funnel funnel={analytics.funnel} currency={c} />
            </Card>

            <Card className="lift overflow-hidden bg-card p-0 shadow-lg">
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
        <Card className="lift mt-4 bg-card p-[18px] shadow-lg">
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
                          <span
                            className={`block h-full ${co.retentionPct < 30 ? 'bg-destructive' : ''}`}
                            style={{ width: `${co.retentionPct}%`, background: co.retentionPct >= 60 ? 'var(--emerald)' : co.retentionPct >= 30 ? 'var(--amber)' : undefined }}
                          />
                        </span>
                        <span className="min-w-[34px] font-semibold tabular-nums">{co.retentionPct}%</span>
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${co.producing > 0 ? '' : 'text-muted-foreground/70'}`} style={co.producing > 0 ? { color: 'var(--emerald)' } : undefined}>{co.producing} <span className="text-muted-foreground/70">({co.activationPct}%)</span></td>
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

function Metric({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 text-[19px] font-[750] text-foreground tabular-nums">{value}</div>
      {/* delta omitted entirely (e.g. effective rate) → render nothing; null → "new"; number → TrendBadge */}
      {delta !== undefined && (
        delta === null
          ? <span className="mt-[3px] block text-[11px] text-muted-foreground/70">— new</span>
          : (
            <span className="mt-[3px] flex items-center gap-1.5">
              <TrendBadge delta={delta} />
              <span className="text-[11px] font-normal text-muted-foreground/70">vs prev</span>
            </span>
          )
      )}
    </div>
  );
}

function Funnel({ funnel, currency }: { funnel: Record<'draft' | 'approved' | 'void', { count: number; amountCents: string }>; currency: string }) {
  // cls = token utility class; color = CSS-var token (takes precedence via inline style)
  const rows: Array<{ k: 'draft' | 'approved' | 'void'; label: string; cls?: string; color?: string }> = [
    { k: 'draft', label: 'Draft', cls: 'bg-muted-foreground' },
    { k: 'approved', label: 'Approved', color: 'var(--emerald)' },
    { k: 'void', label: 'Void', cls: 'bg-destructive' },
  ];
  const max = Math.max(1, ...rows.map((r) => funnel[r.k].count));
  return (
    <div className="flex flex-col gap-3.5">
      {rows.map((r) => {
        const f = funnel[r.k];
        const fill = r.color ? { background: r.color } : undefined;
        return (
          <div key={r.k}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12.5px] text-foreground">
                <span className={`h-[9px] w-[9px] rounded-sm ${r.cls ?? ''}`} style={fill} /> {r.label}
              </span>
              <span className="text-[12.5px] text-muted-foreground tabular-nums">{f.count} · {money(f.amountCents, currency)}</span>
            </div>
            <div className="h-[9px] overflow-hidden rounded-md bg-muted">
              <div className={`h-full rounded-md transition-[width] duration-700 ${r.cls ?? ''}`} style={{ ...fill, width: `${(f.count / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
