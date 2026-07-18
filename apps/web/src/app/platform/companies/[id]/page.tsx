'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CircleDollarSign, ClipboardList, Power, RotateCcw, Users, WalletCards } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading } from '@/components/ui';
import { NetworkExplorer, type ApiNode } from '@/components/NetworkExplorer';
import { bps, money } from '@/lib/format';
import { tenantStatusConfirmation } from '@/lib/privileged-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Company {
  id: string; slug: string; name: string; currency: string; timezone: string; status: string;
  payoutMinCents: string; maturationRule: string; createdAt: string;
  kpis: { members: number; activeMembers: number; revenueThisMonthByCurrency: CurrencyRevenue[]; salesThisMonth: number; outstandingPayableByCurrency: CurrencyAmount[] };
  plan: { name: string; poolRateBps: number; depth: number } | null;
}

interface CurrencyRevenue {
  currency: string;
  revenueThisMonthCents: string;
  salesThisMonth: number;
}

interface CurrencyAmount {
  currency: string;
  outstandingPayableCents: string;
}

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [nodes, setNodes] = useState<ApiNode[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState(false);

  async function load() {
    if (!id) return;
    try {
      setCompany(await api.get<Company>(`/platform/companies/${id}`));
      setNodes(await api.get<ApiNode[]>(`/platform/companies/${id}/network`));
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  useEffect(() => { void load(); }, [id]);

  async function toggleStatus() {
    if (!company) return;
    setBusy(true); setError('');
    try {
      const action = company.status === 'active' ? 'suspend' : 'reactivate';
      await api.post(`/platform/companies/${company.id}/${action}`, { reason: `platform ${action}` });
      setPendingStatusChange(false);
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Alert variant="destructive" className="fade-in">
        <AlertCircle />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!company) return <Loading rows={4} />;
  const statusConfirmation = tenantStatusConfirmation({ companyName: company.name, currentStatus: company.status });

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 fade-in">
        <Link href="/platform"><ArrowLeft />Companies</Link>
      </Button>
      <div className="flex flex-col gap-3 fade-in sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground text-xl font-bold">
            {company.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="h1 m-0">{company.name}</h1>
            <div className="font-mono text-xs text-muted-foreground">{company.slug} - {company.timezone}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={company.status} />
          <Button size="sm" variant={company.status === 'active' ? 'destructive' : 'default'} onClick={() => setPendingStatusChange(true)} disabled={busy}>
            {company.status === 'active' ? <Power /> : <RotateCcw />}
            {company.status === 'active' ? 'Suspend' : 'Reactivate'}
          </Button>
        </div>
      </div>

      <div className="my-4 grid gap-4 fade-in delay-1 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Members" value={`${company.kpis.activeMembers} / ${company.kpis.members}`} Icon={Users} hint="active / total" />
        <RevenueKpi rows={company.kpis.revenueThisMonthByCurrency} />
        <OutstandingPayableKpi rows={company.kpis.outstandingPayableByCurrency} />
        <Kpi label="Plan" value={company.plan ? bps(company.plan.poolRateBps) : '-'} Icon={ClipboardList} hint={company.plan ? `${company.plan.name} - depth ${company.plan.depth}` : 'no plan'} />
      </div>

      <Card className="fade-in delay-2">
        <CardHeader>
          <CardTitle>Referral network</CardTitle>
          <div className="text-xs text-muted-foreground">Tree / list - drill into anyone</div>
        </CardHeader>
        <CardContent>
          {!nodes ? <Loading rows={4} /> : <NetworkExplorer nodes={nodes} title={company.name} />}
        </CardContent>
      </Card>
      {pendingStatusChange && (
        <Confirm
          title={statusConfirmation.title}
          message={statusConfirmation.message}
          confirmLabel={statusConfirmation.confirmLabel}
          danger={statusConfirmation.danger}
          busy={busy}
          onConfirm={toggleStatus}
          onClose={() => setPendingStatusChange(false)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, Icon, hint }: { label: string; value: string; Icon: typeof Users; hint?: string }) {
  return (
    <Card>
      <CardContent className="grid gap-2">
        <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span><span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span></div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
function RevenueKpi({ rows }: { rows: CurrencyRevenue[] }) {
  return (
    <Card>
      <CardContent className="grid gap-2">
        <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue by currency</span><span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><CircleDollarSign className="size-4" /></span></div>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No approved revenue this month.</div>
        ) : (
          <div className="grid gap-1" role="list" aria-label="Company revenue by currency">
            {rows.map((row) => (
              <div key={row.currency} className="flex items-baseline justify-between gap-3" role="listitem">
                <span className="text-xs font-medium text-muted-foreground">{row.currency}</span>
                <span className="text-sm font-semibold tabular-nums">{money(row.revenueThisMonthCents, row.currency)}</span>
                <span className="text-xs text-muted-foreground">{row.salesThisMonth} sales</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function OutstandingPayableKpi({ rows }: { rows: CurrencyAmount[] }) {
  return (
    <Card>
      <CardContent className="grid gap-2">
        <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outstanding payable</span><span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><WalletCards className="size-4" /></span></div>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No outstanding payable balance.</div>
        ) : (
          <div className="grid gap-1" role="list" aria-label="Outstanding payable by currency">
            {rows.map((row) => (
              <div key={row.currency} className="flex items-baseline justify-between gap-3" role="listitem">
                <span className="text-xs font-medium text-muted-foreground">{row.currency}</span>
                <span className="text-sm font-semibold tabular-nums">{money(row.outstandingPayableCents, row.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'active' ? 'default' : 'destructive'}>{status}</Badge>;
}
