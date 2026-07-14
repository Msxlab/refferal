'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

interface Mapping { code: string; amount: string; date: string; customer: string; external: string }
interface PreviewRow { line: number; ok: boolean; code: string; amountCents?: string; saleDate?: string; sellerName?: string; reason?: string }
interface PreviewResp { preview: true; currency: string; okCount: number; errorCount: number; rows: PreviewRow[] }

const SAMPLE = 'referral_code,amount,sale_date,customer_ref\nALICE1,100000.00,2026-06-01,Acme Corp\nBOB1,50000.00,2026-06-02,Beta LLC';
const NONE = '__none__';

function guess(headers: string[], names: string[]): string {
  const lower = headers.map((h) => h.toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n);
    if (i >= 0) return headers[i];
  }
  return '';
}

export function ImportWizard({ onClose, onDone }: { onClose: () => void; onDone: (created: number) => void }) {
  const [step, setStep] = useState<'data' | 'map' | 'preview'>('data');
  const [csv, setCsv] = useState(SAMPLE);
  const [mapping, setMapping] = useState<Mapping>({ code: '', amount: '', date: '', customer: '', external: '' });
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const headers = useMemo(() => {
    const first = csv.split(/\r?\n/).find((l) => l.trim());
    return first ? first.split(',').map((h) => h.trim()).filter(Boolean) : [];
  }, [csv]);

  function toMap() {
    if (headers.length === 0) { setErr('Add a CSV with a header row first.'); return; }
    setMapping({
      code: guess(headers, ['referral_code', 'code', 'seller']),
      amount: guess(headers, ['amount', 'amount_cents', 'cents']),
      date: guess(headers, ['sale_date', 'date']),
      customer: guess(headers, ['customer_ref', 'customer']),
      external: guess(headers, ['external_ref', 'external', 'ref']),
    });
    setErr(''); setStep('map');
  }

  async function toPreview() {
    if (!mapping.code || !mapping.amount) { setErr('Map both Referral code and Amount.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await api.post<PreviewResp>('/admin/sales/import', { csv, mapping: clean(mapping), preview: true });
      setPreview(res); setStep('preview');
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true); setErr('');
    try {
      const res = await api.post<{ created: number; errors: unknown[] }>('/admin/sales/import', { csv, mapping: clean(mapping) });
      onDone(res.created);
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <Modal title="Import sales wizard" onClose={onClose}>
      <div className="grid w-[min(640px,88vw)] gap-4">
        <Steps step={step} />

        {step === 'data' && (
          <div className="grid gap-2">
            <div className="text-sm text-muted-foreground">
              Paste CSV with a header row. Any column names work; you will map them next.
            </div>
            <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={9} className="font-mono text-xs" />
            <div className="text-xs text-muted-foreground">{headers.length} columns detected: {headers.join(', ') || '-'}</div>
          </div>
        )}

        {step === 'map' && (
          <div className="grid gap-3">
            <div className="text-sm text-muted-foreground">Match your columns to sale fields. Fields marked with * are required.</div>
            <MapRow label="Referral code *" value={mapping.code} headers={headers} onChange={(v) => setMapping({ ...mapping, code: v })} />
            <MapRow label="Amount *" value={mapping.amount} headers={headers} onChange={(v) => setMapping({ ...mapping, amount: v })} />
            <MapRow label="Sale date" value={mapping.date} headers={headers} onChange={(v) => setMapping({ ...mapping, date: v })} />
            <MapRow label="Customer ref" value={mapping.customer} headers={headers} onChange={(v) => setMapping({ ...mapping, customer: v })} />
            <MapRow label="External ref" value={mapping.external} headers={headers} onChange={(v) => setMapping({ ...mapping, external: v })} />
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">{preview.okCount} ready</Badge>
              {preview.errorCount > 0 && <Badge variant="destructive">{preview.errorCount} errors</Badge>}
            </div>
            <div className="max-h-[40vh] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Seller / error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={row.line}>
                      <TableCell className="text-muted-foreground">{row.line}</TableCell>
                      <TableCell className="font-mono text-xs">{row.code || '-'}</TableCell>
                      <TableCell className="tabular-nums">{formatPreviewAmount(row, preview.currency)}</TableCell>
                      <TableCell>
                        {row.ok
                          ? <span className="text-[color:var(--emerald)]">{row.sellerName}</span>
                          : <span className="text-xs text-destructive">{row.reason}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="text-xs text-muted-foreground">Imported sales are created as drafts; approve them to distribute commissions.</div>
          </div>
        )}

        {err && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{err}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={step === 'data' ? onClose : () => setStep(step === 'preview' ? 'map' : 'data')} disabled={busy}>
            {step !== 'data' && <ArrowLeft />}
            {step === 'data' ? 'Cancel' : 'Back'}
          </Button>
          {step === 'data' && <Button onClick={toMap}>Next: map columns <ArrowRight /></Button>}
          {step === 'map' && <Button onClick={toPreview} disabled={busy}>{busy ? 'Checking...' : 'Preview'} {!busy && <ArrowRight />}</Button>}
          {step === 'preview' && <Button onClick={confirm} disabled={busy || preview?.okCount === 0}>{busy ? 'Importing...' : `Import ${preview?.okCount ?? 0} sales`}</Button>}
        </div>
      </div>
    </Modal>
  );
}

function clean(m: Mapping) {
  return {
    code: m.code, amount: m.amount,
    date: m.date || undefined, customer: m.customer || undefined, external: m.external || undefined,
  };
}

function formatPreviewAmount(row: PreviewRow, currency: string) {
  if (!row.ok || !row.amountCents) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(row.amountCents) / 100);
}

function Steps({ step }: { step: 'data' | 'map' | 'preview' }) {
  const items: Array<{ k: typeof step; l: string }> = [{ k: 'data', l: 'Data' }, { k: 'map', l: 'Map' }, { k: 'preview', l: 'Preview' }];
  const idx = items.findIndex((i) => i.k === step);
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((it, i) => (
        <div key={it.k} className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
          <Badge variant={i <= idx ? 'default' : 'outline'}>{i + 1}</Badge>
          <span className="text-sm font-medium">{it.l}</span>
        </div>
      ))}
    </div>
  );
}

function MapRow({ label, value, headers, onChange }: { label: string; value: string; headers: string[]; onChange: (v: string) => void }) {
  return (
    <Field className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
      <FieldLabel>{label}</FieldLabel>
      <Select value={value || NONE} onValueChange={(next: string) => onChange(next === NONE ? '' : next)}>
        <SelectTrigger className="w-full sm:max-w-[280px]">
          <SelectValue placeholder="No column" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={NONE}>No column</SelectItem>
            {headers.map((header) => <SelectItem key={header} value={header}>{header}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
