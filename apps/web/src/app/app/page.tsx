'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { NextActions } from '@/components/NextActions';
import { money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface LevelRow {
  level: number;
  pendingCents: string;
  payableCents: string;
  processingCents: string;
  paidCents: string;
}
interface Dashboard {
  month: string;
  currency: string;
  totals: { pendingCents: string; payableCents: string; processingCents: string; paidCents: string };
  levels: LevelRow[];
}

export default function MemberDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Dashboard>('/app/dashboard').then(setData).catch((e) => setError(String((e as ApiError).message)));
  }, []);

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
  const { pendingCents, payableCents, processingCents, paidCents } = data.totals;
  const totalCents = sumCents([pendingCents, payableCents, processingCents, paidCents]);

  return (
    <div>
      <div className="eyebrow fade-in">{t('anav.home')} - {data.month}</div>
      <h1 className="h1 fade-in">{t('me.title')}</h1>
      <p className="sub fade-in">{t('me.sub')}</p>
      <NextActions endpoint="/app/recommendations" />

      <div className="grid gap-4 fade-in delay-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,1fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>This month</CardTitle>
            <CardDescription>Pending, payable, processing and paid commissions in one view.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('me.monthTotal')}</div>
              <div className="mt-1 font-[var(--font-display)] text-3xl font-semibold tracking-normal">
                {money(totalCents, c)}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Chip color="var(--amber)" label={t('me.pending')} value={money(pendingCents, c)} />
              <Chip color="var(--sky)" label={t('me.payable')} value={money(payableCents, c)} />
              <Chip color="var(--primary)" label="Processing" value={money(processingCents, c)} />
              <Chip color="var(--emerald)" label={t('me.paid')} value={money(paidCents, c)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Transfer status</CardTitle>
            <CardDescription>Processing funds have been reserved for a payout and are not withdrawable again.</CardDescription>
          </CardHeader>
          <CardContent className="grid min-h-[220px] content-center gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Funds in processing</div>
            <div className="font-[var(--font-display)] text-3xl font-semibold tracking-normal">{money(processingCents, c)}</div>
            <p className="m-0 text-sm text-muted-foreground">
              {hasPositiveCents(processingCents)
                ? 'Your payout is waiting for settlement evidence from the business.'
                : 'No funds are currently reserved for payout processing.'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 fade-in delay-2">
        <CardHeader>
          <CardTitle>{t('me.levelBreakdown')}</CardTitle>
          <div className="text-xs text-muted-foreground">{t('me.levelHint')}</div>
        </CardHeader>
        <CardContent>
          {data.levels.length > 0 ? <LevelBreakdown levels={data.levels} currency={c} /> : <div className="text-sm text-muted-foreground">{t('me.noData')}</div>}
        </CardContent>
      </Card>

      <div className="mt-4 text-[11px] leading-normal text-muted-foreground fade-in">{t('me.incomeNote')}</div>
    </div>
  );
}

function Chip({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="inline-flex items-center gap-2">
        <span className="size-2.5 rounded-sm" style={{ background: color }} />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function LevelBreakdown({ levels, currency }: { levels: LevelRow[]; currency: string }) {
  const rows = levels.map((level) => ({
    label: `Level ${level.level}`,
    totalCents: sumCents([level.pendingCents, level.payableCents, level.processingCents, level.paidCents]),
  }));
  const largest = rows.reduce((max, row) => (cents(row.totalCents) > max ? cents(row.totalCents) : max), 0n);

  return (
    <div className="grid gap-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{row.label}</span>
            <span className="text-sm font-semibold tabular-nums">{money(row.totalCents, currency)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-md bg-muted">
            <div className="h-full rounded-md bg-primary" style={{ width: percentOf(row.totalCents, largest) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function sumCents(values: readonly string[]): string {
  return values.reduce((total, value) => total + cents(value), 0n).toString();
}

function cents(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function hasPositiveCents(value: string): boolean {
  return cents(value) > 0n;
}

function percentOf(value: string, maximum: bigint): string {
  if (maximum <= 0n || cents(value) <= 0n) return '0%';
  const hundredths = (cents(value) * 10_000n) / maximum;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}%`;
}
