'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Building2, CircleDollarSign, Plus, Search, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Loading } from '@/components/ui';
import { NextActions } from '@/components/NextActions';
import { money } from '@/lib/format';
import { APP_NAME } from '@/lib/brand';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Company {
  id: string;
  slug: string;
  name: string;
  currency: string;
  status: 'active' | 'suspended';
  members: number;
  activeMembers: number;
  revenueThisMonthByCurrency: CurrencyRevenue[];
  salesThisMonth: number;
  createdAt: string;
}

interface CurrencyRevenue {
  currency: string;
  revenueThisMonthCents: string;
  salesThisMonth: number;
}

interface CompanyDirectory {
  companies: Company[];
  totals: {
    companies: number;
    members: number;
    activeMembers: number;
    revenueThisMonthByCurrency: CurrencyRevenue[];
  };
}

export default function CompaniesPage() {
  const router = useRouter();
  const [directory, setDirectory] = useState<CompanyDirectory | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get<CompanyDirectory>('/platform/companies').then(setDirectory).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  const companies = directory?.companies ?? [];

  const filtered = useMemo(
    () => companies.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.toLowerCase()) || c.slug.includes(q.toLowerCase())),
    [companies, q],
  );

  if (error) {
    return (
      <Alert variant="destructive" className="fade-in">
        <AlertCircle />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!directory) return <Loading rows={4} />;

  return (
    <div>
      <div className="eyebrow fade-in">Platform</div>
      <h1 className="h1 fade-in">Companies</h1>
      <p className="sub fade-in mb-4">Every workspace on {APP_NAME}. Open one to manage its network and settings.</p>
      <NextActions endpoint="/platform/recommendations" />

      <div className="mb-4 grid gap-4 fade-in delay-1 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        <Kpi label="Companies" value={String(directory.totals.companies)} Icon={Building2} />
        <Kpi label="Members (all)" value={directory.totals.members.toLocaleString('en-US')} Icon={Users} />
        <RevenueByCurrency rows={directory.totals.revenueThisMonthByCurrency} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 fade-in delay-1">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-8" placeholder="Search companies" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button variant="outline" title="Onboarding wizard coming soon" disabled><Plus />New company</Button>
      </div>

      <div className="grid gap-4 fade-in delay-2 md:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
        {filtered.map((company) => (
          <Button key={company.id} variant="ghost" onClick={() => router.push(`/platform/companies/${company.id}`)} className="h-auto justify-start rounded-xl border bg-card p-4 text-left whitespace-normal hover:bg-muted/50">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground text-base font-bold">
              {company.name.charAt(0).toUpperCase()}
            </span>
            <span className="grid min-w-0 flex-1 gap-3">
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-base font-semibold">{company.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{company.slug}</span>
                </span>
                <StatusBadge status={company.status} />
              </span>
              <span className="grid gap-3 sm:grid-cols-3">
                <Mini label="Members" value={`${company.activeMembers}/${company.members}`} />
                <RevenueMini rows={company.revenueThisMonthByCurrency} />
                <Mini label="Sales (mo)" value={String(company.salesThisMonth)} />
              </span>
              <span className="text-xs text-muted-foreground">Open company</span>
            </span>
          </Button>
        ))}
        {filtered.length === 0 && (
          <div className="text-sm text-muted-foreground">
            {companies.length === 0 ? 'No companies yet.' : 'No companies match your search.'}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, Icon }: { label: string; value: string; Icon: typeof Building2 }) {
  return (
    <Card>
      <CardContent className="grid gap-2">
        <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span><span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span></div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
function RevenueByCurrency({ rows }: { rows: CurrencyRevenue[] }) {
  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue by currency</span>
          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><CircleDollarSign className="size-4" /></span>
        </div>
        <div className="text-xs text-muted-foreground">Company-local month; currencies are not converted or combined.</div>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No approved revenue in the current company-local month.</div>
        ) : (
          <div className="grid gap-2" role="list" aria-label="Revenue by company currency">
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
function Mini({ label, value }: { label: string; value: string }) {
  return <span><span className="block text-[10.5px] text-muted-foreground">{label}</span><span className="mt-0.5 block text-sm font-semibold tabular-nums">{value}</span></span>;
}
function RevenueMini({ rows }: { rows: CurrencyRevenue[] }) {
  return (
    <span>
      <span className="block text-[10.5px] text-muted-foreground">Revenue (mo)</span>
      {rows.length === 0 ? (
        <span className="mt-0.5 block text-sm font-semibold text-muted-foreground">—</span>
      ) : (
        <span className="mt-0.5 grid gap-0.5">
          {rows.map((row) => (
            <span key={row.currency} className="block text-sm font-semibold tabular-nums">{row.currency} {money(row.revenueThisMonthCents, row.currency)}</span>
          ))}
        </span>
      )}
    </span>
  );
}
function StatusBadge({ status }: { status: Company['status'] }) {
  return <Badge variant={status === 'active' ? 'default' : 'destructive'}>{status}</Badge>;
}
