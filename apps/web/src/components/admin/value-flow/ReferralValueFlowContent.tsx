'use client';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, GitBranch, List, Network, RefreshCw, Search, WalletCards } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { bps, money } from '@/lib/format';
import { api, ApiError } from '@/lib/api';
import { AttributionEvidencePanel } from './AttributionEvidencePanel';
import { ReferralHierarchyTable } from './ReferralHierarchyTable';
import { ValueFlowAttention } from './ValueFlowAttention';
import { ValueFlowCanvasSkeleton, ValueFlowSkeleton } from './ValueFlowSkeleton';
import { loadValueFlowSources, RequiredValueFlowSourceError } from './value-flow.loader';
import { buildValueFlowWorkspace } from './value-flow.model';
import { monthLabel } from './value-flow.format';
import { buildValueFlowUrl, parseValueFlowQuery, type ValueFlowQueryState } from './value-flow.url';
import type { ValueFlowWorkspace } from './value-flow.types';
import styles from './value-flow.module.css';

const ReferralValueFlowCanvas = dynamic(() => import('./ReferralValueFlowCanvas'), {
  ssr: false,
  loading: () => <ValueFlowCanvasSkeleton />,
});

interface Props {
  tenantName: string;
  capabilities: {
    dashboard: boolean;
    network: boolean;
    memberDetails: boolean;
    plans: boolean;
    recentSales: boolean;
  };
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function ReferralValueFlowContent({ tenantName, capabilities }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseValueFlowQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  const [workspace, setWorkspace] = useState<ValueFlowWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [optionalFailures, setOptionalFailures] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const generation = useRef(0);
  const desktopInspectorRef = useRef<HTMLElement>(null);
  const isCompact = useMediaQuery('(max-width: 1360px)');
  const prefersTableView = useMediaQuery('(max-width: 1180px)');
  const [searchDraft, setSearchDraft] = useState(query.search);
  const hasCoreAccess = capabilities.dashboard && capabilities.network;

  const updateQuery = useCallback((next: Partial<ValueFlowQueryState>) => {
    router.replace(buildValueFlowUrl(new URLSearchParams(searchParams.toString()), next), { scroll: false });
  }, [router, searchParams]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);
  const selectMember = useCallback((id: string) => {
    updateQuery({ selected: `member:${id}`, search: searchDraft });
    if (isCompact === false) {
      window.requestAnimationFrame(() => desktopInspectorRef.current?.focus());
    }
  }, [isCompact, searchDraft, updateQuery]);

  useEffect(() => setSearchDraft(query.search), [query.search]);

  useEffect(() => {
    if (searchDraft === query.search) return;
    const timer = window.setTimeout(() => updateQuery({ search: searchDraft }), 220);
    return () => window.clearTimeout(timer);
  }, [query.search, searchDraft, updateQuery]);

  useEffect(() => {
    if (!hasCoreAccess) {
      setLoading(false);
      return;
    }
    const requestGeneration = ++generation.current;
    setLoading(true);
    setError('');
    loadValueFlowSources((path) => api.get(path), {
      onCore: (sources) => {
        if (requestGeneration !== generation.current) return;
        setWorkspace(buildValueFlowWorkspace(sources));
        setOptionalFailures([]);
        setLoading(false);
      },
      includePlans: capabilities.plans,
      includeRecentSales: capabilities.recentSales,
    })
      .then((sources) => {
        if (requestGeneration !== generation.current) return;
        setWorkspace(buildValueFlowWorkspace({
          dashboard: sources.dashboard,
          tree: sources.tree,
          treeScope: sources.treeScope,
          plans: sources.plans,
          todo: sources.todo,
          networkHealth: sources.networkHealth,
          recentSales: sources.recentSales,
        }));
        setOptionalFailures(sources.optionalFailures);
      })
      .catch((reason: unknown) => {
        if (requestGeneration !== generation.current) return;
        if (reason instanceof RequiredValueFlowSourceError) {
          setError(`Required data could not be loaded: ${reason.sources.join(' and ')}.`);
        } else {
          setError(reason instanceof ApiError ? reason.message : 'The referral value flow could not be loaded.');
        }
      })
      .finally(() => { if (requestGeneration === generation.current) setLoading(false); });
    return () => { generation.current += 1; };
  }, [capabilities.plans, capabilities.recentSales, hasCoreAccess, reloadKey]);

  if (!hasCoreAccess) {
    return (
      <div className={styles.page}>
        <div className={styles.errorState}>
          <AlertCircle aria-hidden="true" />
          <h1>Value flow access is required</h1>
          <p>This financial network view requires both dashboard and referral-network access.</p>
        </div>
      </div>
    );
  }

  if (loading && !workspace) return <ValueFlowSkeleton />;
  if (!workspace) {
    return (
      <div className={styles.page}>
        <div className={styles.errorState}>
          <AlertCircle aria-hidden="true" />
          <h1>Referral value flow is unavailable</h1>
          <p>{error || 'Required dashboard and hierarchy data are missing.'}</p>
          <Button type="button" onClick={retry}><RefreshCw />Retry</Button>
        </div>
      </div>
    );
  }

  const defaultSelection = 'stage:qualified-sales';
  const selectedId = query.selected ?? defaultSelection;
  const activeView = prefersTableView === true && !searchParams.has('view') ? 'table' : query.view;
  const evidencePeriod = monthLabel(workspace.asOf.month);
  const searchLabel = activeView === 'network' ? 'Search value-flow nodes' : 'Search members, referral codes, roles, or status';
  const attentionComplete = workspace.availability.todo && workspace.availability.networkHealth;
  const attentionAvailable = workspace.availability.todo || workspace.availability.networkHealth;
  const expectedNoSaleCount = workspace.availability.networkHealth
    ? workspace.attention.find((item) => item.id === 'signal:no-sale-active')?.count ?? 0
    : null;
  const unavailableLabels: Record<string, string> = {
    networkHealth: 'network health', todo: 'tasks', plans: 'plan rates', recentSales: 'recent sale evidence',
  };

  return (
    <div className={styles.page}>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {loading ? 'Refreshing value-flow data.' : `Value flow updated for ${evidencePeriod}.`}
      </span>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>{tenantName} · live ledger view<span className={styles.compactPeriod}> · {evidencePeriod}</span></span>
          <h1>Referral value flow</h1>
          <p>Trace approved sales through configured commission rules while keeping all-time liabilities distinct.</p>
        </div>
        <div className={styles.periodChip}><span>Evidence period</span><strong>{evidencePeriod}</strong></div>
      </header>

      <section className={styles.metricGrid} aria-label="Current-month value-flow summary">
        <Metric icon={GitBranch} label="Approved sales" value={String(workspace.summary.approvedSales)} detail="Current month" />
        <Metric icon={WalletCards} label="Qualified revenue" value={money(workspace.summary.qualifiedRevenueCents, workspace.asOf.currency)} detail="Approved ledger sales" />
        <Metric icon={Network} label="Net commissions" value={money(workspace.summary.netCommissionCents, workspace.asOf.currency)} detail={`${bps(workspace.summary.effectiveRateBps)} effective rate`} />
        <Metric icon={AlertCircle} label="Open signals" value={attentionComplete ? String(workspace.attention.length) : attentionAvailable ? `${workspace.attention.length}+` : 'Unavailable'} detail={attentionComplete ? 'Tasks and health checks' : attentionAvailable ? 'Partial source coverage' : 'Sources unavailable'} />
      </section>

      {error && (
        <Alert className={styles.partialWarning}>
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Showing the last loaded value flow</AlertTitle>
          <AlertDescription>Fresh required data could not be loaded: {error}</AlertDescription>
          <Button type="button" variant="outline" size="sm" onClick={retry}><RefreshCw />Retry</Button>
        </Alert>
      )}

      {optionalFailures.length > 0 && (
        <Alert className={styles.partialWarning}>
          <AlertCircle />
          <AlertTitle>Core value flow is ready</AlertTitle>
          <AlertDescription>Some supporting evidence is unavailable: {optionalFailures.map((source) => unavailableLabels[source] ?? source).join(', ')}.</AlertDescription>
          <Button type="button" variant="outline" size="sm" onClick={retry}><RefreshCw />Retry</Button>
        </Alert>
      )}

      {workspace.networkHealthScope && !workspace.networkHealthScope.complete && (
        <Alert className={styles.partialWarning}>
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Network health scan is partial</AlertTitle>
          <AlertDescription>
            Scanned {workspace.networkHealthScope.scannedLeaders} of {workspace.networkHealthScope.totalLeaders} leaders and showing {workspace.networkHealthScope.returnedDormant} of {workspace.networkHealthScope.matchedDormantInScan} dormant matches found in that scan.
          </AlertDescription>
        </Alert>
      )}

      {!workspace.treeScope.complete && (
        <Alert className={styles.partialWarning}>
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Hierarchy snapshot limited to {workspace.members.length} of {workspace.treeScope.total} members</AlertTitle>
          <AlertDescription>Search and table results cover only this bounded snapshot, which is intentionally not connected to tenant-wide sales.</AlertDescription>
        </Alert>
      )}

      {workspace.treeScope.complete && !workspace.summary.traceReconciled && (
        <Alert className={styles.partialWarning}>
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Network snapshot shown as context</AlertTitle>
          <AlertDescription>The hierarchy sale count or revenue does not reconcile to the frozen tenant summary, so source cards are intentionally not connected to Qualified sales.</AlertDescription>
        </Alert>
      )}

      <div className={styles.toolbar}>
        <div className={styles.viewSwitch} role="group" aria-label="Value-flow view">
          <Button type="button" variant={activeView === 'network' ? 'default' : 'ghost'} onClick={() => updateQuery({ view: 'network', signal: null, search: searchDraft })} aria-pressed={activeView === 'network'}><Network aria-hidden="true" />Network</Button>
          <Button type="button" variant={activeView === 'table' ? 'default' : 'ghost'} onClick={() => updateQuery({ view: 'table', search: searchDraft })} aria-pressed={activeView === 'table'}><List aria-hidden="true" />Table</Button>
        </div>
        <label className={styles.searchField}>
          <Search aria-hidden="true" />
          <span className="sr-only">{searchLabel}</span>
          <Input
            type="search"
            name="value-flow-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value.slice(0, 120))}
            placeholder={activeView === 'network' ? 'Search value-flow nodes…' : 'Search members or codes…'}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <Button type="button" variant="outline" onClick={retry} disabled={loading}><RefreshCw aria-hidden="true" className={loading ? styles.spinning : undefined} />{loading ? 'Refreshing…' : 'Refresh'}</Button>
      </div>

      <div className={styles.workspaceGrid}>
        <section className={styles.primaryPanel} aria-label="Referral value-flow workspace">
          {activeView === 'network' ? (
            <ReferralValueFlowCanvas workspace={workspace} selectedId={selectedId} search={searchDraft} onSelect={(id) => updateQuery({ selected: id, search: searchDraft })} />
          ) : (
            <ReferralHierarchyTable members={workspace.members} currency={workspace.asOf.currency} search={searchDraft} selectedId={query.selected} signal={query.signal} scope={workspace.treeScope} expectedNoSaleCount={expectedNoSaleCount} onSelect={selectMember} />
          )}
        </section>
        {isCompact === false && (
          <aside ref={desktopInspectorRef} tabIndex={-1} className={styles.desktopInspector} aria-label="Attribution evidence">
            {activeView === 'table' && <a className={styles.inspectorReturn} href="#value-flow-hierarchy-table">Return to hierarchy table</a>}
            <AttributionEvidencePanel workspace={workspace} selectedId={selectedId} tab={query.tab} canViewMemberDetails={capabilities.memberDetails} canViewSaleDetails={capabilities.recentSales} onTabChange={(tab) => updateQuery({ tab, search: searchDraft })} onSelect={(id) => updateQuery({ selected: id, search: searchDraft })} />
          </aside>
        )}
      </div>

      <ValueFlowAttention items={workspace.attention} sources={{ todo: workspace.availability.todo, networkHealth: workspace.availability.networkHealth }} />

      <Sheet open={isCompact === true && query.selected !== null} onOpenChange={(open) => { if (!open) updateQuery({ selected: null, search: searchDraft }); }}>
        <SheetContent side="bottom" className={styles.mobileInspector}>
          <SheetHeader className="sr-only"><SheetTitle>Attribution evidence</SheetTitle><SheetDescription>Verified referral and ledger details for the selected item.</SheetDescription></SheetHeader>
          <AttributionEvidencePanel workspace={workspace} selectedId={selectedId} tab={query.tab} canViewMemberDetails={capabilities.memberDetails} canViewSaleDetails={capabilities.recentSales} onTabChange={(tab) => updateQuery({ tab, search: searchDraft })} onSelect={(id) => updateQuery({ selected: id, search: searchDraft })} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof GitBranch; label: string; value: string; detail: string }) {
  return <article className={styles.metric}><span className={styles.metricIcon} aria-hidden="true"><Icon /></span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}
