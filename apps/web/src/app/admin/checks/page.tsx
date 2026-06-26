'use client';

import type { ComponentProps } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { downloadPdf } from '@/lib/download';
import { money, dateShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Confirm, useToast } from '@/components/ui';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';

type CheckState = 'needs_address' | 'ready_to_print' | 'printed' | 'mailed';

interface CheckItem {
  payoutId: string;
  membershipId: string;
  payeeName: string;
  totalCents: string;
  period: string;
  checkNumber: number | null;
  mailedAt: string | null;
  addressComplete: boolean;
  state: CheckState;
}
interface ChecksResp { items: CheckItem[]; counts: Record<CheckState, number>; }

const STATE_META: Record<CheckState, { label: string; cls: string; hint: string }> = {
  needs_address: { label: 'Needs address', cls: 'inactive', hint: 'Member has no mailing address — no check can be printed.' },
  ready_to_print: { label: 'Ready to print', cls: 'pending', hint: 'Paid and address on file — generate a check run to assign a number.' },
  printed: { label: 'Printed', cls: 'processing', hint: 'Check number assigned — download the PDF, print, and mail.' },
  mailed: { label: 'Mailed', cls: 'active', hint: 'Check has been mailed to the member.' },
};

export default function ChecksPage() {
  const [data, setData] = useState<ChecksResp | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<'run' | 'pdf' | 'mail' | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmMail, setConfirmMail] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(() => {
    setError('');
    api.get<ChecksResp>('/admin/checks')
      .then((d) => { setData(d); setSel(new Set()); })
      .catch((e) => setError(String((e as ApiError).message)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = data?.items ?? [];
  const ready = useMemo(() => items.filter((i) => i.state === 'ready_to_print'), [items]);
  const printed = useMemo(() => items.filter((i) => i.state === 'printed'), [items]);

  // secili id'ler belirli bir durumdaysa onu kullan; secim yoksa o durumdaki TUM uygunlar.
  function idsFor(state: CheckState, pool: CheckItem[]): string[] {
    const selectedInState = pool.filter((i) => sel.has(i.payoutId)).map((i) => i.payoutId);
    return selectedInState.length ? selectedInState : pool.map((i) => i.payoutId);
  }

  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSel((s) => (s.size === items.length ? new Set() : new Set(items.map((i) => i.payoutId))));
  }

  async function generateRun() {
    const payoutIds = idsFor('ready_to_print', ready);
    if (!payoutIds.length) return;
    setBusy(true); setAction('run');
    try {
      const r = await api.post<{ assignedCount: number; skipped: { reason: string }[] }>('/admin/checks/run', { payoutIds });
      showToast(`Assigned ${r.assignedCount} check number${r.assignedCount === 1 ? '' : 's'}${r.skipped.length ? ` · ${r.skipped.length} skipped (no address)` : ''}`);
      load();
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); setAction(null); }
  }

  async function downloadChecks() {
    const payoutIds = idsFor('printed', printed);
    if (!payoutIds.length) return;
    setBusy(true); setAction('pdf');
    try {
      await downloadPdf('/admin/checks/pdf', 'checks.pdf', { payoutIds });
      showToast('Check PDF downloaded');
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); setAction(null); }
  }

  async function markMailed() {
    const payoutIds = idsFor('printed', printed);
    if (!payoutIds.length) return;
    setBusy(true); setAction('mail');
    try {
      const r = await api.post<{ mailed: number }>('/admin/checks/mark-mailed', { payoutIds });
      showToast(`Marked ${r.mailed} check${r.mailed === 1 ? '' : 's'} as mailed`);
      load();
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); setAction(null); setConfirmMail(false); }
  }
  const mailTargetCount = idsFor('printed', printed).length;
  const runCount = idsFor('ready_to_print', ready).length;

  const counts = data?.counts;

  return (
    <div className="mx-auto max-w-[1160px]">
      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">Payouts</div>
      <h1 className="mt-1.5 font-display text-3xl font-extrabold tracking-tight text-foreground">Checks</h1>
      <p className="mt-1 text-sm text-muted-foreground">Print and mail commission checks. Money already moved when each payout was approved — this is the physical check run.</p>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={load}>Retry</Button>
          </AlertDescription>
        </Alert>
      )}

      {!data ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="shadow-sm">
                <CardContent className="p-3.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-2 h-7 w-10" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="mt-4 shadow-lg">
            <CardContent className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* durum sayaclari */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['needs_address', 'ready_to_print', 'printed', 'mailed'] as CheckState[]).map((st) => (
              <Card key={st} className="shadow-sm">
                <CardContent className="p-3.5">
                  <div className="text-[11px] text-muted-foreground">{STATE_META[st].label}</div>
                  <div className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground">{counts?.[st] ?? 0}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* eylem cubugu */}
          <Card className="mt-4 shadow-sm">
            <CardContent className="flex flex-wrap items-center gap-2.5 p-3">
              <span className="text-xs text-muted-foreground">
                {sel.size ? `${sel.size} selected` : 'No selection — actions apply to all eligible'}
              </span>
              <span className="flex-1" />
              <Button size="sm" onClick={generateRun} disabled={busy || ready.length === 0}>
                {action === 'run' ? 'Assigning…' : `Generate check run${ready.length ? ` (${runCount})` : ''}`}
              </Button>
              <Button size="sm" variant="outline" onClick={downloadChecks} disabled={busy || printed.length === 0}>
                {action === 'pdf' ? 'Preparing…' : <><span aria-hidden>⤓</span> Download PDF</>}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmMail(true)} disabled={busy || printed.length === 0}>
                {action === 'mail' ? 'Marking…' : <><span aria-hidden>✓</span> Mark mailed</>}
              </Button>
            </CardContent>
          </Card>

          {items.length === 0 ? (
            <Card className="mt-4 shadow-lg">
              <CardContent className="px-6 py-12 text-center">
                <div className="text-[15px] font-semibold text-foreground">No checks yet</div>
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  When a member&apos;s payout is approved, it appears here ready to print.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="mt-4 shadow-lg">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <Th className="w-[34px]">
                        <input type="checkbox" className="accent-primary" checked={sel.size === items.length && items.length > 0} onChange={toggleAll} aria-label="Select all" />
                      </Th>
                      <Th>Payee</Th>
                      <Th className="hidden sm:table-cell">Period</Th>
                      <Th>Check #</Th>
                      <Th className="text-right">Amount</Th>
                      <Th>Status</Th>
                      <Th className="hidden sm:table-cell">Mailed</Th>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((it) => {
                      const meta = STATE_META[it.state];
                      return (
                        <TableRow key={it.payoutId} data-state={sel.has(it.payoutId) ? 'selected' : undefined}>
                          <TableCell>
                            <input type="checkbox" className="accent-primary" checked={sel.has(it.payoutId)} onChange={() => toggle(it.payoutId)} aria-label={`Select ${it.payeeName}`} />
                          </TableCell>
                          <TableCell className="font-medium text-foreground">{it.payeeName}</TableCell>
                          <TableCell className="hidden text-muted-foreground sm:table-cell">{it.period}</TableCell>
                          <TableCell className="font-mono tabular-nums text-muted-foreground">{it.checkNumber ?? '—'}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-foreground">{money(it.totalCents)}</TableCell>
                          <TableCell>
                            <span className={cn('badge', meta.cls, 'text-[10px]')} title={meta.hint}>{meta.label}</span>
                          </TableCell>
                          <TableCell className="hidden text-[12px] text-muted-foreground/70 sm:table-cell">{it.mailedAt ? dateShort(it.mailedAt) : '—'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {confirmMail && (
        <Confirm
          title="Mark checks as mailed?"
          message={`This marks ${mailTargetCount} printed check${mailTargetCount === 1 ? '' : 's'} as mailed. This cannot be undone — only do it once the checks are physically in the mail.`}
          confirmLabel="Mark mailed"
          danger
          busy={busy}
          onConfirm={markMailed}
          onClose={() => setConfirmMail(false)}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* tablo basligi — payouts ile ayni: muted, uppercase, tracking-wide, 11px */
function Th({ className, ...props }: ComponentProps<typeof TableHead>) {
  return <TableHead className={cn('text-[11px] font-semibold uppercase tracking-wide text-muted-foreground', className)} {...props} />;
}
