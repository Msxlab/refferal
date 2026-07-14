'use client';

import { type ReactNode, useCallback, useEffect, useReducer, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, HandCoins, LoaderCircle, WalletCards, type LucideIcon } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { initialPayoutActionState, payoutActionIsLocked, payoutActionReducer } from './payout-reconciliation';

interface LedgerItem {
  id: string;
  level: number;
  amountCents: string;
  type: string;
  status: string;
  createdAt: string;
}
interface Wallet {
  currency: string;
  payoutMinCents: string;
  payoutEligibility: {
    requestable: boolean;
    reason: string;
    message: string;
    activePayout: { id: string; status: 'requested' | 'processing' } | null;
  };
  balance: { pendingCents: string; payableCents: string; processingCents: string; paidCents: string };
  ledger: { total: number; items: LedgerItem[] };
}
interface PayoutReq {
  id: string;
  batchId: string | null;
  totalCents: string;
  currency?: string;
  status: string;
  period: string;
  processingStartedAt: string | null;
  paidAt: string | null;
  settledAt: string | null;
}

type WalletReloadResult = { status: 'success' } | { status: 'failed'; message: string };

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [history, setHistory] = useState<PayoutReq[]>([]);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  const [payoutAction, dispatchPayoutAction] = useReducer(payoutActionReducer, initialPayoutActionState);

  const load = useCallback(async (): Promise<WalletReloadResult> => {
    try {
      const [w, h] = await Promise.all([api.get<Wallet>('/app/wallet'), api.get<PayoutReq[]>('/app/payout-requests')]);
      setWallet(w);
      setHistory(h);
      return { status: 'success' };
    } catch (e) {
      return { status: 'failed', message: String((e as ApiError).message) };
    }
  }, []);

  useEffect(() => {
    void load().then((result) => {
      if (result.status === 'failed') setError(result.message);
    });
  }, [load]);

  async function requestPayout() {
    setBusy(true);
    setError('');
    dispatchPayoutAction({ type: 'submit-started' });
    try {
      await api.post('/app/payout-requests');
      showToast('Your payout request has been received.');
      dispatchPayoutAction({ type: 'submit-succeeded' });
      const reload = await load();
      dispatchPayoutAction(
        reload.status === 'success'
          ? { type: 'reload-succeeded' }
          : { type: 'reload-failed', message: reload.message },
      );
    } catch (e) {
      dispatchPayoutAction({ type: 'submit-failed' });
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  async function retryPayoutStatus() {
    setBusy(true);
    dispatchPayoutAction({ type: 'retry-started' });
    try {
      const reload = await load();
      if (reload.status === 'success') {
        setError('');
        dispatchPayoutAction({ type: 'reload-succeeded' });
      } else {
        dispatchPayoutAction({ type: 'reload-failed', message: reload.message });
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !wallet) {
    return (
      <Alert variant="destructive" className="fade-in">
        <AlertCircle />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!wallet) return <Loading />;
  const b = wallet.balance;
  const currency = wallet.currency;
  const activityCount = wallet.ledger.total;
  const payoutEligibility = wallet.payoutEligibility;
  const activePayout = payoutEligibility.activePayout;
  const activePayoutDetails = activePayout ? history.find((payout) => payout.id === activePayout.id) ?? null : null;
  const eligibilityNotice = payoutEligibilityNotice(payoutEligibility, activePayoutDetails, currency, wallet.payoutMinCents);
  const reconciliationMessage =
    payoutAction.status === 'awaiting-reconciliation' || payoutAction.status === 'checking'
      ? payoutAction.message
      : null;

  return (
    <div>
      <div className="eyebrow fade-in">{t('anav.wallet')}</div>
      <h1 className="h1 fade-in">Your Wallet</h1>
      <p className="sub fade-in">Track your payable balance and request a payout.</p>

      <Card className="fade-in delay-1">
        <CardHeader className="border-b">
          <div>
            <CardTitle>Balance breakdown</CardTitle>
            <CardDescription>Payable funds can be requested. Processing funds are reserved and cannot be requested again.</CardDescription>
          </div>
          <CardAction>
            <Button onClick={requestPayout} disabled={busy || payoutActionIsLocked(payoutAction) || !payoutEligibility.requestable}>
              <HandCoins data-icon="inline-start" />
              {t('me.requestPayout')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <BalanceTile
            label={`${t('me.payable')} now`}
            value={money(b.payableCents, currency)}
            hint="Ready for payout request"
            Icon={WalletCards}
          />
          <BalanceTile label={t('me.pending')} value={money(b.pendingCents, currency)} hint="Waiting on maturation rules" Icon={Clock3} />
          <BalanceTile label="Processing" value={money(b.processingCents, currency)} hint="Reserved for a transfer" Icon={LoaderCircle} />
          <BalanceTile label={t('me.paid')} value={money(b.paidCents, currency)} hint="Already processed" Icon={CheckCircle2} />
          {reconciliationMessage && (
            <Alert className="md:col-span-4" role="status" aria-live="polite" aria-atomic="true">
              {payoutAction.status === 'checking' ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
              <AlertDescription className="grid gap-3">
                <span>
                  Your payout request was received, but the latest wallet status could not be confirmed. {reconciliationMessage}{' '}
                  Payout requests remain locked until a status check succeeds.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={retryPayoutStatus}
                  disabled={payoutAction.status === 'checking'}
                >
                  {payoutAction.status === 'checking' ? <LoaderCircle className="animate-spin" /> : <Clock3 />}
                  {payoutAction.status === 'checking' ? 'Checking status...' : 'Retry status check'}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!payoutEligibility.requestable && (
            <Alert className="md:col-span-4">
              {payoutEligibility.reason === 'processing' ? <LoaderCircle className="animate-spin" /> : <Clock3 />}
              <AlertDescription>{eligibilityNotice}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" className="md:col-span-4">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4 fade-in delay-2 py-0">
        <CardHeader className="border-b">
          <CardTitle>{t('me.ledger')}</CardTitle>
          <CardDescription>{activityCount} ledger entries across pending, payable, processing and paid states.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Level</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {wallet.ledger.items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-muted-foreground">{dateShort(entry.createdAt)}</TableCell>
                  <TableCell>L{entry.level}</TableCell>
                  <TableCell className="text-muted-foreground">{entry.type}</TableCell>
                  <TableCell><StatusBadge status={entry.status} /></TableCell>
                  <TableCell className={cn('text-right font-semibold tabular-nums', entry.amountCents.startsWith('-') && 'text-destructive')}>{money(entry.amountCents, currency)}</TableCell>
                </TableRow>
              ))}
              {wallet.ledger.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center">
                    <div className="font-medium text-foreground">No wallet activity yet.</div>
                    <div className="mt-1 text-xs text-muted-foreground">Approved commissions will create ledger activity here.</div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-4 fade-in delay-3 py-0">
        <CardHeader className="border-b">
          <CardTitle>{t('me.payoutHistory')}</CardTitle>
          <CardDescription>Request status and payout run period.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
            <TableBody>
              {history.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.period}</TableCell>
                  <TableCell className="tabular-nums">{money(p.totalCents, p.currency ?? currency)}</TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{dateShort(p.settledAt ?? p.paidAt ?? p.processingStartedAt)}</TableCell>
                </TableRow>
              ))}
              {history.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center">
                    <div className="font-medium text-foreground">No payout requests yet.</div>
                    <div className="mt-1 text-xs text-muted-foreground">Request a payout when your payable balance is ready.</div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function BalanceTile({ label, value, hint, Icon }: { label: string; value: ReactNode; hint: string; Icon: LucideIcon }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <div className="mt-2 text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'paid' || status === 'approved' || status === 'payable' ? 'default' : status === 'rejected' || status === 'void' ? 'destructive' : 'secondary'}>{status}</Badge>;
}

function payoutEligibilityNotice(
  eligibility: Wallet['payoutEligibility'],
  activePayout: PayoutReq | null,
  currency: string,
  payoutMinCents: string,
): string {
  if (eligibility.reason === 'processing' && activePayout) {
    return `${money(activePayout.totalCents, activePayout.currency ?? currency)} is reserved for payout processing. It is not paid until settlement.`;
  }
  if (eligibility.reason === 'requested' && activePayout) {
    return `${money(activePayout.totalCents, activePayout.currency ?? currency)} already has an open payout request.`;
  }
  if (eligibility.reason === 'below_threshold') {
    return `${eligibility.message} Payout requests become available at ${money(payoutMinCents, currency)}.`;
  }
  return eligibility.message || 'Payout requests are unavailable right now. Please refresh and try again.';
}
