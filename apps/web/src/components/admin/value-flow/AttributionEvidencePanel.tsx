'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CircleAlert, FileSearch, GitCommitHorizontal, UserRound } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError } from '@/lib/api';
import { bps, dateShort, ledgerTypeLabel, levelLabel, money } from '@/lib/format';
import { monthLabel } from './value-flow.format';
import { ensureValueFlowSurfaceHref, type ValueFlowHrefResolver, type ValueFlowInspectorTab } from './value-flow.url';
import type { ValueFlowMember, ValueFlowNode, ValueFlowWorkspace } from './value-flow.types';
import styles from './value-flow.module.css';

interface MemberDetail {
  profile: {
    id: string; fullName: string; email: string; referralCode: string; role: string; status: string;
    joinedAt: string; sponsor: { membershipId: string; name: string; code: string } | null;
  };
  stats: {
    directs: number;
    sales: { allTime: { count: number; cents: string }; thisMonth: { count: number; cents: string } };
    commission: { pendingCents: string; payableCents: string; processingCents: string; paidCents: string };
  };
  recentSales: { id: string; saleDate: string; amountCents: string; status: string }[];
  recentLedger: { id: string; saleId: string; level: number; type: string; status: string; amountCents: string; createdAt: string }[];
}

interface SaleDetail {
  id: string; amountCents: string; currency: string; status: string; saleDate: string;
  sellerName: string; sellerReferralCode: string; sellerEmail: string; customerRef?: string | null;
  externalRef?: string | null; approvedAt?: string | null; approvedByName?: string | null;
  createdAt: string;
  ledger: Array<{
    id: string; level: number; type: string; status: string; rateBpsUsed: number;
    amountCents: string; beneficiaryName: string; beneficiaryCode: string;
  }>;
}

interface Props {
  workspace: ValueFlowWorkspace;
  selectedId: string;
  tab: ValueFlowInspectorTab;
  canViewMemberDetails: boolean;
  canViewSaleDetails: boolean;
  resolveHref?: ValueFlowHrefResolver;
  onTabChange: (tab: ValueFlowInspectorTab) => void;
  onSelect: (id: string) => void;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className={styles.fact}><span>{label}</span><strong>{value}</strong></div>;
}

function DetailState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  if (loading) return <div className={styles.inspectorLoading}><Skeleton /><Skeleton /><Skeleton /></div>;
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>Evidence could not be loaded</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
      <Button type="button" variant="outline" size="sm" onClick={retry}>Retry</Button>
    </Alert>
  );
}

export function AttributionEvidencePanel({
  workspace,
  selectedId,
  tab,
  canViewMemberDetails,
  canViewSaleDetails,
  resolveHref = ensureValueFlowSurfaceHref,
  onTabChange,
  onSelect,
}: Props) {
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const node = workspace.flow.nodes.find(({ id }) => id === selectedId) ?? null;
  const memberId = selectedId.startsWith('member:') ? selectedId.slice('member:'.length) : null;
  const saleId = selectedId.startsWith('sale:') ? selectedId.slice('sale:'.length) : null;
  const memberSummary = memberId ? workspace.members.find(({ id }) => id === memberId) ?? null : null;
  const detailRestricted = (memberId !== null && !canViewMemberDetails) || (saleId !== null && !canViewSaleDetails);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!memberId && !saleId) { setMember(null); setSale(null); setError(''); return; }
    if (detailRestricted) {
      setMember(null);
      setSale(null);
      setError('');
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    setMember(null);
    setSale(null);
    const path = memberId ? `/admin/members/${encodeURIComponent(memberId)}` : `/admin/sales/${encodeURIComponent(saleId ?? '')}`;
    api.get<MemberDetail | SaleDetail>(path)
      .then((detail) => {
        if (!active) return;
        if (memberId) setMember(detail as MemberDetail);
        else setSale(detail as SaleDetail);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof ApiError ? reason.message : 'The evidence service did not respond.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, detailRestricted, memberId, saleId]);

  const title = node?.title ?? memberSummary?.name ?? member?.profile.fullName ?? sale?.sellerName ?? 'Attribution evidence';
  const subtitle = node?.eyebrow === workspace.asOf.month
    ? monthLabel(workspace.asOf.month)
    : node?.eyebrow ?? memberSummary?.referralCode ?? member?.profile.referralCode ?? (sale ? `Sale ${sale.id.slice(0, 8)}` : 'Verified source detail');

  return (
    <div className={styles.inspectorInner}>
      <header className={styles.inspectorHeader}>
        <span className={styles.inspectorIcon} aria-hidden="true">{memberId ? <UserRound /> : saleId ? <FileSearch /> : <GitCommitHorizontal />}</span>
        <div><span>{subtitle}</span><h2>{title}</h2></div>
      </header>
      <Tabs value={tab} onValueChange={(value) => onTabChange(value as ValueFlowInspectorTab)}>
        <TabsList className={styles.inspectorTabs} aria-label="Evidence views">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="activity">Evidence</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className={styles.inspectorBody}>
          <DetailState loading={loading} error={error} retry={retry} />
          {node && <NodeSummary node={node} workspace={workspace} onSelect={onSelect} />}
          {memberSummary && !member && !loading && !error && <MemberFallback member={memberSummary} currency={workspace.asOf.currency} />}
          {detailRestricted && <p className={styles.accountingNote}>Additional record-level evidence is restricted for this role; the bounded snapshot summary remains available.</p>}
          {member && <MemberSummary detail={member} currency={workspace.asOf.currency} onSelect={onSelect} />}
          {sale && <SaleSummary detail={sale} resolveHref={resolveHref} />}
        </TabsContent>
        <TabsContent value="activity" className={styles.inspectorBody}>
          <DetailState loading={loading} error={error} retry={retry} />
          {member && <MemberActivity detail={member} currency={workspace.asOf.currency} onSelect={onSelect} />}
          {sale && <SaleLedger detail={sale} />}
          {detailRestricted && <p className={styles.inspectorLead}>Record-level evidence is restricted for this role.</p>}
          {node?.id === 'stage:qualified-sales' ? (
            <LatestApprovedEvidence workspace={workspace} onSelect={onSelect} />
          ) : node ? (
            <NodeEvidenceNotice node={node} />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NodeSummary({ node, workspace, onSelect }: { node: ValueFlowNode; workspace: ValueFlowWorkspace; onSelect: (id: string) => void }) {
  const rate = node.rateBps === undefined ? null : bps(node.rateBps);
  return (
    <>
      <p className={styles.inspectorLead}>{node.detail}</p>
      <div className={styles.factGrid}>
        {node.valueCents !== undefined && <Fact label={node.kind === 'liability' ? 'Outstanding balance' : 'Current-month value'} value={money(node.valueCents, workspace.asOf.currency)} />}
        {node.count !== undefined && <Fact label="Approved sales" value={String(node.count)} />}
        {rate && <Fact label="Configured tier rate" value={rate} />}
        <Fact label="Evidence period" value={node.kind === 'liability' ? 'All time' : monthLabel(workspace.asOf.month)} />
      </div>
      {node.kind === 'liability' && <p className={styles.accountingNote}>This balance is an all-time ledger liability. It is intentionally not connected to the current-month flow.</p>}
      {node.kind === 'rule' && <p className={styles.accountingNote}>This is the active plan configuration, not an attributed payout amount.</p>}
      {node.id === 'stage:qualified-sales' && <LatestApprovedEvidence workspace={workspace} onSelect={onSelect} compact />}
    </>
  );
}

function MemberFallback({ member, currency }: { member: ValueFlowMember; currency: string }) {
  return <div className={styles.factGrid}><Fact label="Monthly revenue" value={money(member.revenueCents, currency)} /><Fact label="Monthly commission" value={money(member.monthlyCommissionCents, currency)} /></div>;
}

function MemberSummary({ detail, currency, onSelect }: { detail: MemberDetail; currency: string; onSelect: (id: string) => void }) {
  return (
    <>
      <div className={styles.factGrid}>
        <Fact label="Current-month sales" value={`${detail.stats.sales.thisMonth.count} · ${money(detail.stats.sales.thisMonth.cents, currency)}`} />
        <Fact label="Direct referrals" value={String(detail.stats.directs)} />
        <Fact label="Pending" value={money(detail.stats.commission.pendingCents, currency)} />
        <Fact label="Payable" value={money(detail.stats.commission.payableCents, currency)} />
        <Fact label="In payout" value={money(detail.stats.commission.processingCents, currency)} />
      </div>
      <Fact label="Sponsor" value={detail.profile.sponsor ? `${detail.profile.sponsor.name} · ${detail.profile.sponsor.code}` : 'Root member'} />
      <p className={styles.inspectorFootnote}>Joined {dateShort(detail.profile.joinedAt)} · {detail.profile.email}</p>
      {detail.recentSales[0] && <Button type="button" variant="outline" onClick={() => onSelect(`sale:${detail.recentSales[0].id}`)}>Inspect latest sale</Button>}
    </>
  );
}

function MemberActivity({ detail, currency, onSelect }: { detail: MemberDetail; currency: string; onSelect: (id: string) => void }) {
  if (detail.recentLedger.length === 0) return <p className={styles.inspectorLead}>No recent ledger evidence is available for this member.</p>;
  return <div className={styles.evidenceList}>{detail.recentLedger.map((line) => <button type="button" key={line.id} onClick={() => onSelect(`sale:${line.saleId}`)}><span><strong>{ledgerTypeLabel(line.type)} · {levelLabel(line.level)}</strong><small>{dateShort(line.createdAt)} · {line.status}</small></span><b>{money(line.amountCents, currency)}</b></button>)}</div>;
}

function SaleSummary({ detail, resolveHref }: { detail: SaleDetail; resolveHref: ValueFlowHrefResolver }) {
  return (
    <>
      <div className={styles.factGrid}><Fact label="Sale amount" value={money(detail.amountCents, detail.currency)} /><Fact label="Status" value={detail.status} /><Fact label="Sale date" value={dateShort(detail.saleDate)} /><Fact label="Approved" value={dateShort(detail.approvedAt ?? null)} /></div>
      <Fact label="Seller" value={`${detail.sellerName} · ${detail.sellerReferralCode}`} />
      <Fact label="Customer reference" value={detail.customerRef || 'Not recorded'} />
      <Fact label="External reference" value={detail.externalRef || 'Not recorded'} />
      <Button asChild variant="outline"><Link href={resolveHref('/admin/sales')}>Open sales register <ArrowUpRight aria-hidden="true" /></Link></Button>
    </>
  );
}

function SaleLedger({ detail }: { detail: SaleDetail }) {
  if (detail.ledger.length === 0) return <p className={styles.inspectorLead}>No commission ledger entries are attached to this sale.</p>;
  return <div className={styles.evidenceList}>{detail.ledger.map((line) => <div key={line.id}><span><strong>{line.beneficiaryName}</strong><small>{line.beneficiaryCode} · {ledgerTypeLabel(line.type)} · {levelLabel(line.level)} · {bps(line.rateBpsUsed)} · {line.status}</small></span><b data-negative={line.type === 'reversal' || undefined}>{money(line.amountCents, detail.currency)}</b></div>)}</div>;
}

function NodeEvidenceNotice({ node }: { node: ValueFlowNode }) {
  if (node.kind === 'liability') return <p className={styles.inspectorLead}>Open a member or sale to inspect ledger evidence. This all-time balance is not backed by the latest-sale list.</p>;
  if (node.kind === 'rule') return <p className={styles.inspectorLead}>This node is backed by the active plan configuration. It does not represent a sale or payout record.</p>;
  return <p className={styles.inspectorLead}>Select Qualified sales, a member, or a sale to inspect record-level evidence.</p>;
}

function LatestApprovedEvidence({ workspace, onSelect, compact = false }: { workspace: ValueFlowWorkspace; onSelect: (id: string) => void; compact?: boolean }) {
  if (!workspace.availability.recentSales) return <p className={styles.inspectorLead}>Recent sale evidence is temporarily unavailable.</p>;
  if (workspace.recentSales.length === 0) return <p className={styles.inspectorLead}>No approved sale evidence is available for this period.</p>;
  const items = compact ? workspace.recentSales.slice(0, 3) : workspace.recentSales;
  return (
    <section className={styles.latestEvidence} aria-label="Latest approved sale evidence">
      <p className={styles.inspectorFootnote}>Period-authoritative approvals for {monthLabel(workspace.asOf.month)}, using the same frozen summary month as the aggregate.</p>
      <div className={styles.evidenceList}>{items.map((sale) => <button type="button" key={sale.id} onClick={() => onSelect(`sale:${sale.id}`)}><span><strong>{sale.sellerName}</strong><small>{dateShort(sale.saleDate)} · {sale.externalRef || 'No external reference'}</small></span><b>{money(sale.amountCents, sale.currency ?? workspace.asOf.currency)}</b></button>)}</div>
    </section>
  );
}
