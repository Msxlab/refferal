'use client';

import { type ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clock3,
  ReceiptText,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Donut, Loading, MoneyCounter } from '@/components/ui';
import { NextActions } from '@/components/NextActions';
import { TrendChart } from '@/components/TrendChart';
import { bps, money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Dashboard {
  month: string;
  currency: string;
  members: { total: number; active: number };
  thisMonth: { approvedSalesCount: number; revenueCents: string; commissionCents: string; effectiveRateBps: number };
  outstandingPayableCents: string;
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

const RANGES = [3, 6, 12];

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [months, setMonths] = useState(6);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Dashboard>('/admin/dashboard').then(setData).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  useEffect(() => {
    setAnalytics(null);
    api.get<Analytics>(`/admin/analytics?months=${months}`).then(setAnalytics).catch(() => {});
  }, [months]);

  if (error) {
    return (
      <Alert variant="destructive" className="fade-in">
        <AlertCircle />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data) return <Loading />;

  const c = data.currency;
  const revenue = Number(data.thisMonth.revenueCents);
  const commission = Number(data.thisMonth.commissionCents);
  const net = Math.max(0, revenue - commission);

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.dashboard')} - {data.month}</div>
      <h1 className="h1 fade-in">{t('dash.title')}</h1>
      <p className="sub fade-in">{t('dash.sub')}</p>
      <NextActions endpoint="/admin/recommendations" />

      <div className="grid gap-4 fade-in delay-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.9fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>This month</CardTitle>
            <CardDescription>Approved sales, commission and effective rate.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="flex flex-col gap-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('dash.revenue')}</div>
              <div className="font-[var(--font-display)] text-3xl font-semibold tracking-normal text-foreground">
                <MoneyCounter cents={revenue} currency={c} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Metric label={t('dash.commission')} value={money(commission, c)} />
              <Metric label={t('dash.effRate')} value={bps(data.thisMonth.effectiveRateBps)} />
              <Metric label={t('dash.approvedSales')} value={String(data.thisMonth.approvedSalesCount)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Revenue split</CardTitle>
            <CardDescription>Net revenue versus commission allocation.</CardDescription>
          </CardHeader>
          <CardContent className="grid min-h-[220px] place-items-center">
            <Donut
              segments={[
                { label: 'Net', value: net, color: 'var(--emerald)' },
                { label: t('dash.commission'), value: commission, color: 'var(--primary)' },
              ]}
              center={
                <div>
                  <div className="text-[11px] text-muted-foreground">{t('dash.commissionShare')}</div>
                  <div className="text-lg font-extrabold">{bps(data.thisMonth.effectiveRateBps)}</div>
                </div>
              }
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 fade-in delay-2 md:grid-cols-3">
        <DashboardStatCard label={t('dash.payable')} value={money(data.outstandingPayableCents, c)} Icon={WalletCards} hint={t('dash.payableHint')} href="/admin/payouts" action="Review payouts" />
        <DashboardStatCard label={t('dash.members')} value={`${data.members.active} / ${data.members.total}`} Icon={Users} hint={t('dash.membersHint')} href="/admin/members" action="Open members" />
        <DashboardStatCard label={t('dash.pendingReq')} value={String(data.pendingPayoutRequests)} Icon={ReceiptText} hint={t('dash.requestsHint')} href="/admin/payouts" action="Resolve queue" />
      </div>

      <div className="mt-7 mb-4 flex flex-col gap-3 fade-in sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="m-0 text-lg font-semibold">Performance</h2>
          <span className="text-xs text-muted-foreground">Trends and comparison vs the previous period.</span>
        </div>
        <Tabs value={String(months)} onValueChange={(value: string) => setMonths(Number(value))}>
          <TabsList>
            {RANGES.map((range) => (
              <TabsTrigger key={range} value={String(range)}>{range}M</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {!analytics ? (
        <Loading rows={3} />
      ) : (
        <>
          <Card className="mb-4 fade-in">
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Revenue" value={money(analytics.totals.revenueCents, c)} delta={analytics.deltas.revenuePct} />
                <Metric label="Commission" value={money(analytics.totals.commissionCents, c)} delta={analytics.deltas.commissionPct} invertGood />
                <Metric label="Approved sales" value={String(analytics.totals.approvedSales)} delta={analytics.deltas.salesPct} />
                <Metric label="Effective rate" value={bps(analytics.totals.effectiveRateBps)} />
              </div>
              <TrendChart series={analytics.series} currency={c} />
            </CardContent>
          </Card>

          <div className="grid gap-4 fade-in lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Sales funnel</CardTitle>
                <div className="text-xs text-muted-foreground">Status mix over the selected window.</div>
              </CardHeader>
              <CardContent>
                <Funnel funnel={analytics.funnel} currency={c} />
              </CardContent>
            </Card>

            <Card className="py-0">
              <CardHeader className="border-b">
                <CardTitle>Top performers</CardTitle>
                <div className="text-xs text-muted-foreground">By approved revenue in this window.</div>
              </CardHeader>
              <CardContent className="p-0">
                {analytics.topPerformers.length === 0 ? (
                  <div className="p-5 text-sm text-muted-foreground">No approved sales in this window.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead className="text-right">Sales</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics.topPerformers.map((p, index) => (
                        <TableRow key={p.membershipId}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant={index === 0 ? 'default' : 'secondary'}>{index + 1}</Badge>
                              <div>
                                <div className="text-sm font-semibold">{p.fullName}</div>
                                <div className="font-mono text-[11px] text-muted-foreground">{p.referralCode}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{p.salesCount}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{money(p.revenueCents, c)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function DashboardStatCard({
  label,
  value,
  Icon,
  hint,
  href,
  action,
}: {
  label: string;
  value: ReactNode;
  Icon: LucideIcon;
  hint?: string;
  href?: string;
  action?: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        {href && action && (
          <Button variant="outline" size="sm" asChild>
            <Link href={href}>
              {action}
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, delta, invertGood }: { label: string; value: string; delta?: number | null; invertGood?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {delta !== undefined && <Delta pct={delta} invertGood={invertGood} />}
    </div>
  );
}

function Delta({ pct, invertGood }: { pct: number | null; invertGood?: boolean }) {
  if (pct === null) return <span className="mt-1 block text-[11px] text-muted-foreground">- new</span>;
  const up = pct > 0;
  const flat = pct === 0;
  const good = flat ? null : invertGood ? !up : up;
  const Icon = flat ? ArrowRight : up ? ArrowUp : ArrowDown;
  const sign = flat ? '' : up ? '+' : '-';
  return (
    <span
      className={cn(
        'mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold',
        good === null ? 'text-muted-foreground' : good ? 'text-[color:var(--emerald)]' : 'text-destructive',
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {sign}{Math.abs(pct)}%
      <span className="font-normal text-muted-foreground">vs prev</span>
    </span>
  );
}

function Funnel({ funnel, currency }: { funnel: Record<'draft' | 'approved' | 'void', { count: number; amountCents: string }>; currency: string }) {
  const rows: Array<{ k: 'draft' | 'approved' | 'void'; label: string; color: string }> = [
    { k: 'draft', label: 'Draft', color: 'var(--muted)' },
    { k: 'approved', label: 'Approved', color: 'var(--emerald)' },
    { k: 'void', label: 'Void', color: 'var(--rose)' },
  ];
  const max = Math.max(1, ...rows.map((row) => funnel[row.k].count));
  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const value = funnel[row.k];
        return (
          <div key={row.k}>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-sm">
                <span className="size-2.5 rounded-sm" style={{ background: row.color }} />
                {row.label}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{value.count} - {money(value.amountCents, currency)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-md bg-muted">
              <div
                className="h-full rounded-md transition-[width] duration-700"
                style={{ width: `${(value.count / max) * 100}%`, background: row.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
