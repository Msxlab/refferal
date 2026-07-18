'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Download, Play, RotateCcw, ShieldAlert, X } from 'lucide-react';
import { api, ApiError, getCsv } from '@/lib/api';
import { Confirm, Loading, Modal, useToast } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';

interface PayableMember {
  membershipId: string;
  referralCode: string;
  fullName: string;
  netCents: string;
}

interface PayableList {
  payoutMinCents: string;
  currency: string;
  members: PayableMember[];
}

type PayoutStatus = 'requested' | 'processing' | 'paid' | 'rejected' | 'failed';

interface PayoutItem {
  id: string;
  batchId: string | null;
  membershipId: string;
  referralCode: string;
  fullName: string;
  totalCents: string;
  method: string;
  status: PayoutStatus;
  period: string;
  processingStartedAt: string | null;
  paidAt: string | null;
  settledAt: string | null;
  settlementReference: string | null;
  rejectionReason: string | null;
  failureReason: string | null;
}

interface PayoutList {
  total: number;
  page: number;
  pageSize: number;
  items: PayoutItem[];
}

interface BatchStartResult {
  id: string | null;
  status: 'processing' | null;
  period: string;
  method: string;
  processingCount: number;
  skippedCount: number;
  processing: Array<{
    membershipId: string;
    payoutId: string;
    totalCents: string;
    entryCount: number;
  }>;
}

interface RequestedPayoutStartResult {
  processing: boolean;
  batchId?: string;
  payoutId?: string;
  totalCents?: string;
  entryCount?: number;
  reason?: string;
  netCents?: string;
}

interface PayoutBatch {
  id: string;
  period: string;
  method: string;
  payouts: PayoutItem[];
  totalCents: string;
  processingStartedAt: string | null;
  settlementReference: string | null;
  failureReason: string | null;
}

interface ReserveConfirmation {
  membershipIds: string[];
  totalCents?: string;
  label: string;
  period?: string;
  recalculatesAmount?: boolean;
}

const MAX_BATCH_MEMBERS = 100;
const PAYOUT_PAGE_SIZE = 100;

export default function PayoutsPage() {
  const [payable, setPayable] = useState<PayableList | null>(null);
  const [requests, setRequests] = useState<PayoutItem[] | null>(null);
  const [processing, setProcessing] = useState<PayoutItem[] | null>(null);
  const [failed, setFailed] = useState<PayoutItem[] | null>(null);
  const [history, setHistory] = useState<PayoutItem[] | null>(null);
  const [selectedMembershipIds, setSelectedMembershipIds] = useState<Set<string>>(new Set());
  const [exportPeriod, setExportPeriod] = useState(currentMonth());
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  const [reserveConfirmation, setReserveConfirmation] = useState<ReserveConfirmation | null>(null);
  const [requestToStart, setRequestToStart] = useState<PayoutItem | null>(null);
  const [requestToReject, setRequestToReject] = useState<PayoutItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [batchToSettle, setBatchToSettle] = useState<PayoutBatch | null>(null);
  const [settlementReference, setSettlementReference] = useState('');
  const [settlementEvidence, setSettlementEvidence] = useState('');
  const [batchToFail, setBatchToFail] = useState<PayoutBatch | null>(null);
  const [failureReason, setFailureReason] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextPayable, nextRequests, nextProcessing, nextFailed, nextHistory] = await Promise.all([
        api.get<PayableList>('/admin/payouts/payable'),
        listAllPayouts('requested'),
        listAllPayouts('processing'),
        listAllPayouts('failed'),
        api.get<PayoutList>(`/admin/payouts?page=1&pageSize=${PAYOUT_PAGE_SIZE}`),
      ]);
      setPayable(nextPayable);
      setRequests(nextRequests);
      setProcessing(nextProcessing);
      setFailed(nextFailed);
      setHistory(nextHistory.items);
      setSelectedMembershipIds((previous) => {
        const eligible = new Set(nextPayable.members.map((member) => member.membershipId));
        return new Set([...previous].filter((membershipId) => eligible.has(membershipId)));
      });
    } catch (cause) {
      setError(String((cause as ApiError).message));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currency = payable?.currency ?? 'USD';
  const payableMembers = payable?.members ?? [];
  const selectedMembers = useMemo(
    () => payableMembers.filter((member) => selectedMembershipIds.has(member.membershipId)),
    [payableMembers, selectedMembershipIds],
  );
  const selectedTotalCents = useMemo(
    () => sumCents(selectedMembers.map((member) => member.netCents)),
    [selectedMembers],
  );
  const requestedTotalCents = useMemo(
    () => sumCents((requests ?? []).map((request) => request.totalCents)),
    [requests],
  );
  const processingBatches = useMemo(() => batchesWithStatus(processing ?? [], 'processing'), [processing]);
  const failedBatches = useMemo(() => batchesWithStatus(failed ?? [], 'failed'), [failed]);
  const allEligibleSelected =
    payableMembers.length > 0 && payableMembers.every((member) => selectedMembershipIds.has(member.membershipId));

  function toggleMember(membershipId: string) {
    setSelectedMembershipIds((previous) => {
      const next = new Set(previous);
      if (next.has(membershipId)) next.delete(membershipId);
      else next.add(membershipId);
      return next;
    });
  }

  function toggleAllEligible() {
    if (payableMembers.length > MAX_BATCH_MEMBERS) {
      setError(`Select ${MAX_BATCH_MEMBERS} or fewer eligible members for one payout batch.`);
      return;
    }
    setSelectedMembershipIds(allEligibleSelected ? new Set() : new Set(payableMembers.map((member) => member.membershipId)));
  }

  function confirmReserve(
    membershipIds: string[],
    totalCents: string | undefined,
    label: string,
    period?: string,
    recalculatesAmount = false,
  ) {
    if (membershipIds.length === 0) return;
    if (membershipIds.length > MAX_BATCH_MEMBERS) {
      setError(`A payout batch may contain at most ${MAX_BATCH_MEMBERS} members.`);
      return;
    }
    setError('');
    setReserveConfirmation({ membershipIds, totalCents, label, period, recalculatesAmount });
  }

  async function reserveBatch() {
    if (!reserveConfirmation) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.post<BatchStartResult>('/admin/payouts/batches', {
        membershipIds: reserveConfirmation.membershipIds,
        method: 'csv',
        ...(reserveConfirmation.period ? { period: reserveConfirmation.period } : {}),
      });
      if (result.id) {
        const reservedTotalCents = sumCents(result.processing.map((payout) => payout.totalCents));
        showToast(
          `${result.processingCount} payout${result.processingCount === 1 ? '' : 's'} (${money(reservedTotalCents, currency)}) moved to processing. Settle only after transfer evidence is recorded.`,
        );
      } else {
        showToast(`No payouts were reserved. ${result.skippedCount} member${result.skippedCount === 1 ? '' : 's'} were skipped.`);
      }
      setReserveConfirmation(null);
      await load();
    } catch (cause) {
      setError(String((cause as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  async function startRequestedPayout() {
    if (!requestToStart) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.post<RequestedPayoutStartResult>(`/admin/payouts/${requestToStart.id}/approve`, { method: 'csv' });
      if (result.processing) {
        showToast(`${requestToStart.fullName}'s request is now processing. It is not paid until the batch is settled.`);
      } else {
        showToast(`Request was not reserved: ${result.reason ?? 'nothing payable'}.`);
      }
      setRequestToStart(null);
      await load();
    } catch (cause) {
      setError(String((cause as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  async function rejectRequestedPayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestToReject || !rejectReason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post<{ ok: true }>(`/admin/payouts/${requestToReject.id}/reject`, { reason: rejectReason.trim() });
      showToast('Payout request rejected. Funds remain payable until a future request or batch reservation.');
      closeRejectModal();
      await load();
    } catch (cause) {
      setError(String((cause as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  async function settleBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batchToSettle || !settlementReference.trim() || !settlementEvidence.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.post<{ settled: boolean; alreadySettled: boolean; payoutCount: number }>(
        `/admin/payouts/batches/${batchToSettle.id}/settle`,
        { settlementReference: settlementReference.trim(), settlementEvidence: settlementEvidence.trim() },
      );
      showToast(
        result.alreadySettled
          ? 'This batch was already settled.'
          : `${result.payoutCount} payout${result.payoutCount === 1 ? '' : 's'} marked paid after settlement evidence was recorded.`,
      );
      closeSettlementModal();
      await load();
    } catch (cause) {
      setError(String((cause as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  async function failBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batchToFail || !failureReason.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.post<{ failed: boolean; alreadyFailed: boolean; payoutCount: number }>(
        `/admin/payouts/batches/${batchToFail.id}/fail`,
        { reason: failureReason.trim() },
      );
      showToast(
        result.alreadyFailed
          ? 'This batch was already released.'
          : `${result.payoutCount} payout${result.payoutCount === 1 ? '' : 's'} released back to payable.`,
      );
      closeFailureModal();
      await load();
    } catch (cause) {
      setError(String((cause as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv(path: string, filename: string) {
    setError('');
    try {
      const csv = await getCsv(path);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setError(String((cause as ApiError).message));
    }
  }

  function exportHistoricalCsv() {
    if (!/^\d{4}-\d{2}$/.test(exportPeriod)) {
      setError('Choose a valid YYYY-MM period before exporting settled payouts.');
      return;
    }
    void downloadCsv(`/admin/payouts/export.csv?period=${encodeURIComponent(exportPeriod)}`, `payouts-${exportPeriod}.csv`);
  }

  function closeSettlementModal() {
    setBatchToSettle(null);
    setSettlementReference('');
    setSettlementEvidence('');
  }

  function closeFailureModal() {
    setBatchToFail(null);
    setFailureReason('');
  }

  function closeRejectModal() {
    setRequestToReject(null);
    setRejectReason('');
  }

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.payouts')}</div>
      <h1 className="h1 fade-in">Payout management</h1>
      <p className="sub fade-in">Reserve payable funds, use the immutable bank file, then settle only with transfer evidence.</p>

      {error && (
        <Alert variant="destructive" className="mb-4 fade-in">
          <AlertCircle />
          <AlertTitle>Payout action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mb-4 grid gap-4 fade-in delay-1 md:grid-cols-3">
        <FinanceStep
          step="1"
          label="Reserve"
          value={selectedMembers.length ? String(selectedMembers.length) : '-'}
          hint={selectedMembers.length ? money(selectedTotalCents, currency) : 'Select payable members'}
        />
        <FinanceStep
          step="2"
          label="Process"
          value={String(processingBatches.length)}
          hint={processingBatches.length ? 'Export immutable bank CSV' : 'No bank file in flight'}
        />
        <FinanceStep
          step="3"
          label="Settle"
          value={requests ? String(requests.length) : '-'}
          hint={requests ? `${money(requestedTotalCents, currency)} requested` : 'Loading requests'}
        />
      </div>

      <Card className="mb-4 fade-in delay-2 py-0">
        <CardHeader className="border-b">
          <div>
            <CardTitle>Reserve payable funds</CardTitle>
            <CardDescription>
              Select up to {MAX_BATCH_MEMBERS} members. Reserving moves ledger rows to processing; it never marks a payout paid.
            </CardDescription>
          </div>
          <CardAction>
            <Button
              type="button"
              onClick={() => confirmReserve(selectedMembers.map((member) => member.membershipId), selectedTotalCents, 'selected payable members')}
              disabled={busy || selectedMembers.length === 0 || selectedMembers.length > MAX_BATCH_MEMBERS}
            >
              <Play data-icon="inline-start" />
              Reserve selected
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          {payable && payable.members.length > MAX_BATCH_MEMBERS && (
            <Alert className="m-4">
              <ShieldAlert />
              <AlertDescription>
                There are {payable.members.length} eligible members. Select no more than {MAX_BATCH_MEMBERS} for each settlement batch.
              </AlertDescription>
            </Alert>
          )}
          {!payable ? (
            <div className="p-4"><Loading rows={3} /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allEligibleSelected}
                      onCheckedChange={toggleAllEligible}
                      aria-label="Select all eligible members"
                    />
                  </TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead className="text-right">Payable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payable.members.map((member) => {
                  const checked = selectedMembershipIds.has(member.membershipId);
                  return (
                    <TableRow key={member.membershipId} data-state={checked ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleMember(member.membershipId)}
                          aria-label={`Select ${member.fullName} for payout processing`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{member.fullName}</TableCell>
                      <TableCell className="text-muted-foreground">{member.referralCode}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{money(member.netCents, currency)}</TableCell>
                    </TableRow>
                  );
                })}
                {payable.members.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center">
                      <div className="font-medium text-foreground">No members are above the payout threshold.</div>
                      <div className="mt-1 text-xs text-muted-foreground">Funds remain payable until the threshold is reached.</div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4 fade-in delay-2 py-0">
        <CardHeader className="border-b">
          <div>
            <CardTitle>Processing batches</CardTitle>
            <CardDescription>Download the immutable instruction file, complete the transfer, then record reference and evidence.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!processing ? (
            <div className="p-4"><Loading rows={2} /></div>
          ) : processingBatches.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No payout batches are processing.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processingBatches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell>
                      <div className="font-medium">{batch.payouts.length} payout{batch.payouts.length === 1 ? '' : 's'}</div>
                      <div className="font-mono text-xs text-muted-foreground">{shortId(batch.id)}</div>
                    </TableCell>
                    <TableCell>{batch.period}</TableCell>
                    <TableCell className="text-muted-foreground">{batch.method}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(batch.totalCents, currency)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void downloadCsv(`/admin/payouts/batches/${batch.id}/export.csv`, `payout-batch-${batch.period}-${shortId(batch.id)}.csv`)}
                          disabled={busy}
                        >
                          <Download data-icon="inline-start" />
                          Bank CSV
                        </Button>
                        <Button type="button" size="sm" onClick={() => setBatchToSettle(batch)} disabled={busy}>
                          <Check data-icon="inline-start" />
                          Settle
                        </Button>
                        <Button type="button" size="sm" variant="destructive" onClick={() => setBatchToFail(batch)} disabled={busy}>
                          <X data-icon="inline-start" />
                          Release
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4 fade-in delay-2 py-0">
        <CardHeader className="border-b">
          <div>
            <CardTitle>Requested payouts</CardTitle>
            <CardDescription>Starting a request reserves it in a processing batch; it does not settle the transfer.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!requests ? (
            <div className="p-4"><Loading rows={2} /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <div className="font-medium">{request.fullName}</div>
                      <div className="text-sm text-muted-foreground">{request.referralCode}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">{money(request.totalCents, currency)}</TableCell>
                    <TableCell>{request.period}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" size="sm" onClick={() => setRequestToStart(request)} disabled={busy}>
                          <Play data-icon="inline-start" />
                          Start processing
                        </Button>
                        <Button type="button" size="sm" variant="destructive" onClick={() => setRequestToReject(request)} disabled={busy}>
                          <X data-icon="inline-start" />
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {requests.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center">
                      <div className="font-medium text-foreground">No open payout requests.</div>
                      <div className="mt-1 text-xs text-muted-foreground">Member requests appear here before they are reserved or rejected.</div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {failedBatches.length > 0 && (
        <Card className="mb-4 fade-in delay-3 py-0">
          <CardHeader className="border-b">
            <div>
              <CardTitle>Released batches</CardTitle>
              <CardDescription>These transfers were not settled. Their ledger rows are payable again and can be reserved into a new batch.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Release reason</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedBatches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-mono text-xs">{shortId(batch.id)}</TableCell>
                    <TableCell>{batch.period}</TableCell>
                    <TableCell className="max-w-[360px] whitespace-normal text-muted-foreground">{batch.failureReason ?? 'No reason recorded'}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(batch.totalCents, currency)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          confirmReserve(
                            batch.payouts.map((payout) => payout.membershipId),
                            undefined,
                            'released batch members',
                            batch.period,
                            true,
                          )
                        }
                        disabled={busy}
                      >
                        <RotateCcw data-icon="inline-start" />
                        Reserve again
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4 fade-in delay-3">
        <CardHeader>
          <div>
            <CardTitle>Historical settled export</CardTitle>
            <CardDescription>Export paid records for one bounded settlement period. Processing batches use their own immutable CSV above.</CardDescription>
          </div>
          <CardAction className="flex items-end gap-2">
            <Field className="w-[150px] gap-1">
              <FieldLabel htmlFor="historical-payout-period">Period</FieldLabel>
              <Input
                id="historical-payout-period"
                type="month"
                value={exportPeriod}
                onChange={(event) => setExportPeriod(event.target.value)}
              />
            </Field>
            <Button type="button" variant="outline" onClick={exportHistoricalCsv} disabled={busy || !exportPeriod}>
              <Download data-icon="inline-start" />
              Export paid CSV
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      <Card className="fade-in delay-3 py-0">
        <CardHeader className="border-b">
          <div>
            <CardTitle>{t('payouts.history')}</CardTitle>
            <CardDescription>Recent payout records, processing state and settlement outcome.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!history ? (
            <div className="p-4"><Loading rows={2} /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((payout) => (
                  <TableRow key={payout.id}>
                    <TableCell>
                      <div className="font-medium">{payout.fullName}</div>
                      <div className="text-sm text-muted-foreground">{payout.referralCode}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">{money(payout.totalCents, currency)}</TableCell>
                    <TableCell><StatusBadge status={payout.status} /></TableCell>
                    <TableCell>{payout.period}</TableCell>
                    <TableCell className="max-w-[260px] whitespace-normal text-xs text-muted-foreground">
                      {payout.settlementReference ?? payout.failureReason ?? payout.rejectionReason ?? '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateShort(payout.settledAt ?? payout.paidAt ?? payout.processingStartedAt)}
                    </TableCell>
                  </TableRow>
                ))}
                {history.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center">
                      <div className="font-medium text-foreground">No payouts yet.</div>
                      <div className="mt-1 text-xs text-muted-foreground">Reserved and settled payouts will create an audit trail here.</div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {reserveConfirmation && (
        <Confirm
          title="Reserve payout batch"
          message={
            reserveConfirmation.recalculatesAmount
              ? `${reserveConfirmation.label} will be re-evaluated against their current payable ledger rows. The amount is recalculated when reservation occurs and will not reuse the previous batch total. This does not mark funds paid; download the immutable batch CSV and settle only after transfer evidence is available.`
              : `${reserveConfirmation.label} currently total ${money(reserveConfirmation.totalCents ?? '0', currency)}. Available ledger rows are verified when reservation occurs. This does not mark funds paid; download the immutable batch CSV and settle only after transfer evidence is available.`
          }
          confirmLabel="Reserve for processing"
          busy={busy}
          onConfirm={reserveBatch}
          onClose={() => setReserveConfirmation(null)}
        />
      )}

      {requestToStart && (
        <Confirm
          title="Start payout processing"
          message={`${requestToStart.fullName}'s request for ${money(requestToStart.totalCents, currency)} will be reserved into a processing batch. It will remain unpaid until the transfer is settled with reference and evidence.`}
          confirmLabel="Start processing"
          busy={busy}
          onConfirm={startRequestedPayout}
          onClose={() => setRequestToStart(null)}
        />
      )}

      {requestToReject && (
        <Modal title="Reject payout request" onClose={closeRejectModal}>
          <form className="grid w-[min(460px,88vw)] gap-4" onSubmit={rejectRequestedPayout}>
            <p className="m-0 text-sm text-muted-foreground">
              Record why {requestToReject.fullName}'s {money(requestToReject.totalCents, currency)} request is being rejected. Their payable funds are not removed.
            </p>
            <Field>
              <FieldLabel htmlFor="payout-rejection-reason">Reason</FieldLabel>
              <Textarea
                id="payout-rejection-reason"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                required
                maxLength={500}
                placeholder="Explain what the member needs to resolve"
              />
            </Field>
            {error && <ActionError message={error} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeRejectModal} disabled={busy}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={busy || !rejectReason.trim()}>Reject request</Button>
            </div>
          </form>
        </Modal>
      )}

      {batchToSettle && (
        <Modal title="Settle payout batch" onClose={closeSettlementModal}>
          <form className="grid w-[min(520px,88vw)] gap-4" onSubmit={settleBatch}>
            <p className="m-0 text-sm text-muted-foreground">
              This marks {batchToSettle.payouts.length} payout{batchToSettle.payouts.length === 1 ? '' : 's'} as paid. Record the bank or provider reference and evidence first.
            </p>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="settlement-reference">Settlement reference</FieldLabel>
                <Input
                  id="settlement-reference"
                  value={settlementReference}
                  onChange={(event) => setSettlementReference(event.target.value)}
                  required
                  maxLength={240}
                  placeholder="Bank confirmation or provider transfer ID"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="settlement-evidence">Settlement evidence</FieldLabel>
                <Textarea
                  id="settlement-evidence"
                  value={settlementEvidence}
                  onChange={(event) => setSettlementEvidence(event.target.value)}
                  required
                  maxLength={2000}
                  placeholder="Receipt URL, reconciliation note, or evidence location"
                />
                <FieldDescription>Both fields are required before funds can be marked paid.</FieldDescription>
              </Field>
            </FieldGroup>
            {error && <ActionError message={error} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeSettlementModal} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || !settlementReference.trim() || !settlementEvidence.trim()}>
                <Check data-icon="inline-start" />
                Record settlement
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {batchToFail && (
        <Modal title="Release processing batch" onClose={closeFailureModal}>
          <form className="grid w-[min(500px,88vw)] gap-4" onSubmit={failBatch}>
            <p className="m-0 text-sm text-muted-foreground">
              Use this only when the transfer was not settled. The batch will be marked failed and its ledger rows will return to payable for a later retry.
            </p>
            <Field>
              <FieldLabel htmlFor="payout-release-reason">Release reason</FieldLabel>
              <Textarea
                id="payout-release-reason"
                value={failureReason}
                onChange={(event) => setFailureReason(event.target.value)}
                required
                maxLength={500}
                placeholder="Why this batch was not settled"
              />
            </Field>
            {error && <ActionError message={error} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeFailureModal} disabled={busy}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={busy || !failureReason.trim()}>
                <X data-icon="inline-start" />
                Release funds
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function FinanceStep({ step, label, value, hint }: { step: string; label: string; value: string; hint: string }) {
  return (
    <Card size="sm">
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">{step}</span>
          <Badge variant="outline">{label}</Badge>
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: PayoutStatus }) {
  const variant = status === 'paid' ? 'default' : status === 'failed' || status === 'rejected' ? 'destructive' : 'secondary';
  return <Badge variant={variant}>{status}</Badge>;
}

function ActionError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function batchesWithStatus(items: PayoutItem[], status: 'processing' | 'failed'): PayoutBatch[] {
  const groups = new Map<string, PayoutItem[]>();
  for (const payout of items) {
    if (payout.status !== status || !payout.batchId) continue;
    const existing = groups.get(payout.batchId) ?? [];
    existing.push(payout);
    groups.set(payout.batchId, existing);
  }
  return [...groups.entries()]
    .map(([id, payouts]) => ({
      id,
      period: payouts[0].period,
      method: payouts[0].method,
      payouts,
      totalCents: sumCents(payouts.map((payout) => payout.totalCents)),
      processingStartedAt: payouts[0].processingStartedAt,
      settlementReference: payouts[0].settlementReference,
      failureReason: payouts.find((payout) => payout.failureReason)?.failureReason ?? null,
    }))
    .sort((left, right) => (right.processingStartedAt ?? '').localeCompare(left.processingStartedAt ?? ''));
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

function shortId(value: string): string {
  return value.slice(0, 8);
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function listAllPayouts(status: PayoutStatus): Promise<PayoutItem[]> {
  const first = await api.get<PayoutList>(payoutListPath(status, 1));
  const byId = new Map(first.items.map((payout) => [payout.id, payout]));
  const pageCount = Math.ceil(first.total / first.pageSize);

  for (let page = 2; page <= pageCount; page += 1) {
    const next = await api.get<PayoutList>(payoutListPath(status, page));
    for (const payout of next.items) byId.set(payout.id, payout);
  }

  return [...byId.values()];
}

function payoutListPath(status: PayoutStatus, page: number): string {
  return `/admin/payouts?status=${encodeURIComponent(status)}&page=${page}&pageSize=${PAYOUT_PAGE_SIZE}`;
}
