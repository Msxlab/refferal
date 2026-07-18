'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calculator, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PlanLevel {
  level: number;
  rateBps: number;
}

interface Plan {
  id: string;
  name: string;
  poolRateBps: number;
  depth: number;
  effectiveFrom: string;
  levels: PlanLevel[];
}

interface Simulation {
  amountCents: string;
  distributedCents: string;
  retainedCents: string;
  lines: Array<{ level: number; beneficiary: string; rateBps: number; amountCents: string }>;
}

interface SettingsSummary {
  currency: string;
}

function money(cents: string, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents) / 100);
}

function percentInputToBps(value: string): number | null {
  const raw = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, decimal = ''] = raw.split('.');
  const bps = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return Number.isInteger(bps) && bps >= 0 && bps <= 10000 ? bps : null;
}

function amountInputToCentsString(value: string): string | null {
  const raw = value.trim().replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, decimal = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? String(cents) : null;
}

export default function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('Standard plan');
  const [poolRatePercent, setPoolRatePercent] = useState('30');
  const [rates, setRates] = useState<string[]>(['10', '8', '6', '4', '2']);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [amount, setAmount] = useState('1000.00');
  const [currency, setCurrency] = useState('USD');
  const [sim, setSim] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const depth = rates.length;
  const selected = useMemo(() => plans.find((p) => p.id === selectedId) ?? plans[0], [plans, selectedId]);

  async function load() {
    try {
      const rows = await api.get<Plan[]>('/admin/plans');
      setPlans(rows);
      api.get<SettingsSummary>('/admin/settings')
        .then((settings) => setCurrency(settings.currency))
        .catch(() => { /* settings.view may be unavailable for custom plan-only roles */ });
      if (!selectedId && rows[0]) setSelectedId(rows[0].id);
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  useEffect(() => { void load(); }, []);

  function setRate(index: number, value: string) {
    setRates((current) => current.map((rate, i) => (i === index ? value : rate)));
  }

  function resize(nextDepth: number) {
    setRates((current) => Array.from({ length: nextDepth }, (_, i) => current[i] ?? '0'));
  }

  async function createPlan() {
    setBusy('create'); setError('');
    try {
      const poolRateBps = percentInputToBps(poolRatePercent);
      const parsedRates = rates.map(percentInputToBps);
      if (poolRateBps === null || parsedRates.some((rate) => rate === null)) {
        throw new Error('Enter valid percentages between 0 and 100.');
      }
      const levelRates = parsedRates as number[];
      await api.post<Plan>('/admin/plans', {
        name,
        poolRateBps,
        depth,
        levels: levelRates.map((rateBps, level) => ({ level, rateBps })),
        effectiveFrom: effectiveFrom || undefined,
      });
      await load();
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(''); }
  }

  async function simulate() {
    const planId = selected?.id;
    if (!planId) return;
    setBusy('simulate'); setError('');
    try {
      const amountCents = amountInputToCentsString(amount);
      if (!amountCents) throw new Error('Enter a valid sale amount.');
      setSim(await api.post<Simulation>('/admin/plans/simulate', { planId, amountCents }));
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(''); }
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Plan action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Commission plan versions</CardTitle>
          <CardDescription>
            Newest effective plan is used when sales are approved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Pool</TableHead>
                <TableHead>Depth</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Levels</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow
                  key={p.id}
                  data-state={p.id === selected?.id ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(p.id)}
                >
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{(p.poolRateBps / 100).toFixed(2)}%</TableCell>
                  <TableCell>{p.depth}</TableCell>
                  <TableCell>{new Date(p.effectiveFrom).toLocaleDateString()}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {p.levels.map((l) => `${l.level}:${(l.rateBps / 100).toFixed(2)}%`).join(' / ')}
                  </TableCell>
                </TableRow>
              ))}
              {plans.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">No plans yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create version</CardTitle>
          <CardDescription>
            Plans are versioned by effective date; historical sales keep their plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="plan-name">Name</FieldLabel>
              <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="plan-pool-percent">Commission pool %</FieldLabel>
              <Input
                id="plan-pool-percent"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={poolRatePercent}
                onChange={(e) => setPoolRatePercent(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="plan-depth">Depth</FieldLabel>
              <Input
                id="plan-depth"
                type="number"
                min={1}
                max={12}
                value={depth}
                onChange={(e) => resize(Number(e.target.value))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="plan-effective-from">Effective from</FieldLabel>
              <Input
                id="plan-effective-from"
                type="datetime-local"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </Field>
          </FieldGroup>
          <FieldGroup className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {rates.map((rate, level) => (
              <Field key={level}>
                <FieldLabel htmlFor={`plan-level-${level}`}>Level {level} %</FieldLabel>
                <Input
                  id={`plan-level-${level}`}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={rate}
                  onChange={(e) => setRate(level, e.target.value)}
                />
              </Field>
            ))}
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button type="button" disabled={busy === 'create'} onClick={createPlan}>
            <Plus data-icon="inline-start" />
            Create plan
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Simulator</CardTitle>
          <CardDescription>
            Uses fake upline members to show level payouts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_minmax(160px,1fr)_auto] md:items-end">
            <Field>
              <FieldLabel>Plan</FieldLabel>
              <Select
                value={selectedId || undefined}
                disabled={plans.length === 0}
                onValueChange={(value: string) => setSelectedId(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={plans.length ? 'Select plan' : 'No plans'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="simulation-amount">Sale amount</FieldLabel>
              <Input
                id="simulation-amount"
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Button type="button" disabled={!selected || busy === 'simulate'} onClick={simulate}>
              <Calculator data-icon="inline-start" />
              Simulate
            </Button>
          </FieldGroup>
          {sim && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Stat label="Sale" value={money(sim.amountCents, currency)} />
                <Stat label="Distributed" value={money(sim.distributedCents, currency)} />
                <Stat label="Retained" value={money(sim.retainedCents, currency)} />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Level</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Beneficiary</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sim.lines.map((l) => (
                    <TableRow key={l.level}>
                      <TableCell>{l.level}</TableCell>
                      <TableCell>{(l.rateBps / 100).toFixed(2)}%</TableCell>
                      <TableCell>{l.beneficiary}</TableCell>
                      <TableCell>{money(l.amountCents, currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-base font-medium">{value}</div>
    </div>
  );
}
