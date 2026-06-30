'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { downloadPdf } from '@/lib/download';
import { money, dateShort } from '@/lib/format';
import { Confirm, Loading, useToast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

type CheckState = 'needs_address' | 'ready_to_print' | 'printed' | 'mailed';
type BadgeVariant = 'default' | 'secondary' | 'success' | 'destructive' | 'pending' | 'payable';

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

// variant globals.css .badge paletiyle birebir: inactive→secondary(gri), pending/processing→pending(amber), active→success(yesil)
const STATE_META: Record<CheckState, { label: string; variant: BadgeVariant; hint: string }> = {
  needs_address: { label: 'Needs address', variant: 'secondary', hint: 'Member has no mailing address — no check can be printed.' },
  ready_to_print: { label: 'Ready to print', variant: 'pending', hint: 'Paid and address on file — generate a check run to assign a number.' },
  printed: { label: 'Printed', variant: 'pending', hint: 'Check number assigned — download the PDF, print, and mail.' },
  mailed: { label: 'Mailed', variant: 'success', hint: 'Check has been mailed to the member.' },
};

export function ChecksPageContent({ tenantName }: { tenantName: string }) {
  void tenantName;
  const [data, setData] = useState<ChecksResp | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmMail, setConfirmMail] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(() => {
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
    setBusy(true);
    try {
      const r = await api.post<{ assignedCount: number; skipped: { reason: string }[] }>('/admin/checks/run', { payoutIds });
      showToast(`Assigned ${r.assignedCount} check number${r.assignedCount === 1 ? '' : 's'}${r.skipped.length ? ` · ${r.skipped.length} skipped (no address)` : ''}`);
      load();
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function downloadChecks() {
    const payoutIds = idsFor('printed', printed);
    if (!payoutIds.length) return;
    setBusy(true);
    try {
      await downloadPdf('/admin/checks/pdf', 'checks.pdf', { payoutIds });
      showToast('Check PDF downloaded');
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  async function markMailed() {
    const payoutIds = idsFor('printed', printed);
    if (!payoutIds.length) return;
    setBusy(true);
    try {
      const r = await api.post<{ mailed: number }>('/admin/checks/mark-mailed', { payoutIds });
      showToast(`Marked ${r.mailed} check${r.mailed === 1 ? '' : 's'} as mailed`);
      load();
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); setConfirmMail(false); }
  }
  const mailTargetCount = idsFor('printed', printed).length;

  if (error) return <div className="error" style={{ margin: 24 }}>{error}</div>;
  if (!data) return <div style={{ padding: 24 }}><Loading rows={4} /></div>;

  const c = data.counts;

  return (
    <div>
      <div className="eyebrow fade-in">Payouts</div>
      <h1 className="h1 fade-in">Checks</h1>
      <p className="sub fade-in">Print and mail commission checks. Money already moved when each payout was approved — this is the physical check run.</p>

      {/* durum sayaclari */}
      <div className="kpi-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        {(['needs_address', 'ready_to_print', 'printed', 'mailed'] as CheckState[]).map((st) => (
          <Card key={st} className="p-3.5">
            <div className="faint" style={{ fontSize: 11 }}>{STATE_META[st].label}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{c[st]}</div>
          </Card>
        ))}
      </div>

      {/* eylem cubugu */}
      <Card style={{ padding: 12, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="faint" style={{ fontSize: 12 }}>
          {sel.size ? `${sel.size} selected` : 'No selection — actions apply to all eligible'}
        </span>
        <span style={{ flex: 1 }} />
        <Button onClick={generateRun} disabled={busy || ready.length === 0}>
          Generate check run{ready.length ? ` (${idsFor('ready_to_print', ready).length})` : ''}
        </Button>
        <Button variant="ghost" onClick={downloadChecks} disabled={busy || printed.length === 0}>⤓ Download PDF</Button>
        <Button variant="ghost" onClick={() => setConfirmMail(true)} disabled={busy || printed.length === 0}>✓ Mark mailed</Button>
      </Card>

      {items.length === 0 ? (
        <Card style={{ padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No checks yet</div>
          <p className="faint" style={{ fontSize: 13, marginTop: 6 }}>
            When a member&apos;s payout is approved, it appears here ready to print.
          </p>
        </Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={sel.size === items.length && items.length > 0} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th>Payee</th>
                <th>Period</th>
                <th>Check #</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
                <th>Mailed</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const meta = STATE_META[it.state];
                return (
                  <tr key={it.payoutId}>
                    <td><input type="checkbox" checked={sel.has(it.payoutId)} onChange={() => toggle(it.payoutId)} aria-label={`Select ${it.payeeName}`} /></td>
                    <td style={{ fontWeight: 600 }}>{it.payeeName}</td>
                    <td className="faint">{it.period}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace' }}>{it.checkNumber ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(it.totalCents)}</td>
                    <td><Badge variant={meta.variant} title={meta.hint} className="text-[9px]">{meta.label}</Badge></td>
                    <td className="faint" style={{ fontSize: 12 }}>{it.mailedAt ? dateShort(it.mailedAt) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
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
