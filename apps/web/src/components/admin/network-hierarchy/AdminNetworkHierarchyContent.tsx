'use client';

import {
  AlertCircle,
  ChevronRight,
  CircleAlert,
  DatabaseZap,
  LoaderCircle,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NetworkHierarchyInspector } from '@/components/network-hierarchy/NetworkHierarchyInspector';
import { NetworkHierarchyList } from '@/components/network-hierarchy/NetworkHierarchyList';
import { NetworkHierarchyTree } from '@/components/network-hierarchy/NetworkHierarchyTree';
import {
  buildNetworkHierarchyModel,
  hierarchyNodeKey,
  hierarchyParentKey,
} from '@/components/network-hierarchy/network-hierarchy.model';
import {
  buildHierarchyFocusUrl,
  buildHierarchySelectionUrl,
  buildNetworkHierarchyUrl,
  buildWholeNetworkUrl,
  parseNetworkHierarchyQuery,
  type AdminNetworkHierarchyQueryState,
  type NetworkHierarchyLens,
  type NetworkHierarchyView,
} from '@/components/network-hierarchy/network-hierarchy.url';
import type {
  AdminHierarchyMemberNode,
  AdminHierarchyNode,
  AdminNetworkContext,
  BranchPage,
  NetworkHierarchyNode,
} from '@/components/network-hierarchy/types';
import { api, ApiError } from '@/lib/api';
import { ReferralValueFlowContent } from '@/components/admin/value-flow/ReferralValueFlowContent';
import { buildValueFlowUrl } from '@/components/admin/value-flow/value-flow.url';
import { AdminNetworkSearch } from './AdminNetworkSearch';
import { AdminNetworkToolbar } from './AdminNetworkToolbar';
import styles from './admin-network-hierarchy.module.css';

export interface AdminValueFlowCapabilities {
  dashboard: boolean;
  network: boolean;
  memberDetails: boolean;
  plans: boolean;
  recentSales: boolean;
  /** The explicit capability that permits the financial surface at all. */
  financials: boolean;
}

interface Props {
  tenantName: string;
  valueFlowCapabilities: AdminValueFlowCapabilities;
}

type NodePage = BranchPage<AdminHierarchyNode>;

function pathWithQuery(path: string, values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function asMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

function isSnapshotExpired(reason: unknown): boolean {
  if (!(reason instanceof ApiError)) return false;
  const body = reason.body;
  const code =
    body && typeof body === 'object' && 'code' in body
      ? (body as { code?: unknown }).code
      : undefined;
  return code === 'NETWORK_SNAPSHOT_EXPIRED' || reason.message.includes('NETWORK_SNAPSHOT_EXPIRED');
}

function uniqueNodes(nodes: readonly AdminHierarchyNode[]): AdminHierarchyNode[] {
  const byKey = new Map<string, AdminHierarchyNode>();
  for (const node of nodes) byKey.set(hierarchyNodeKey(node), node);
  return [...byKey.values()];
}

function mergeNodes(current: readonly AdminHierarchyNode[], incoming: readonly AdminHierarchyNode[]): AdminHierarchyNode[] {
  return uniqueNodes([...current, ...incoming]);
}

function expandedParents(nodes: readonly AdminHierarchyNode[]): Set<string> {
  const available = new Set(nodes.map(hierarchyNodeKey));
  const expanded = new Set<string>();
  for (const node of nodes) {
    const parent = hierarchyParentKey(node);
    if (parent && available.has(parent)) expanded.add(parent);
  }
  return expanded;
}

function seedContextNodes(context: AdminNetworkContext): AdminHierarchyNode[] {
  return uniqueNodes([
    ...(context.focus ? [context.focus] : []),
    ...context.initialPage.items,
  ]);
}

function LineageSignalRail({
  context,
  selected,
}: {
  context: AdminNetworkContext;
  selected: NetworkHierarchyNode | null;
}) {
  const ancestry = context.ancestors.filter((node): node is AdminHierarchyMemberNode => node.kind === 'member');
  const localRoot = context.focus?.kind === 'member' ? context.focus : null;
  const selectedLabel = selected?.kind === 'member' ? selected.displayName : null;

  return (
    <aside className={styles.lineageRail} aria-label="Current network lineage">
      <div className={styles.railHeader}>
        <span>Lineage signal</span>
        <small>Current orientation</small>
      </div>
      <ol className={styles.lineageSteps}>
        <li>
          <span className={styles.signalDot} aria-hidden="true" />
          <div>
            <strong>Company root</strong>
            <small>{context.root.label}</small>
          </div>
        </li>
        {ancestry.map((member) => (
          <li key={member.membershipId}>
            <span className={styles.signalDot} aria-hidden="true" />
            <div>
              <strong>{member.displayName}</strong>
              <small>Global Tier {member.globalTier}</small>
            </div>
          </li>
        ))}
        <li data-local-root={localRoot ? 'true' : undefined}>
          <span className={styles.signalDot} aria-hidden="true" />
          <div>
            <strong>{localRoot?.displayName ?? 'Whole network'}</strong>
            <small>{localRoot ? 'Local Tier 1 root' : 'No local branch focus'}</small>
          </div>
        </li>
        {selectedLabel && selectedLabel !== localRoot?.displayName ? (
          <li className={styles.selectedSignal}>
            <span className={styles.signalDot} aria-hidden="true" />
            <div>
              <strong>{selectedLabel}</strong>
              <small>Selected person</small>
            </div>
          </li>
        ) : null}
      </ol>
    </aside>
  );
}

function NetworkCockpit({ tenantName, query }: { tenantName: string; query: AdminNetworkHierarchyQueryState }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [context, setContext] = useState<AdminNetworkContext | null>(null);
  const [treeNodes, setTreeNodes] = useState<AdminHierarchyNode[]>([]);
  const [listNodes, setListNodes] = useState<AdminHierarchyNode[]>([]);
  const [listCursor, setListCursor] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchSelection, setSearchSelection] = useState<AdminHierarchyMemberNode | null>(null);
  const [transientSelection, setTransientSelection] = useState<NetworkHierarchyNode | null>(null);
  const contextGeneration = useRef(0);
  const initialListRequest = useRef<string | null>(null);

  const currentParams = useCallback(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const focusId = query.scope === 'focused' ? query.focus ?? undefined : undefined;

  const loadContext = useCallback(async () => {
    const generation = ++contextGeneration.current;
    setLoading(true);
    setError('');
    setContext(null);
    setListNodes([]);
    setListCursor(null);
    setLoadingList(false);
    initialListRequest.current = null;
    try {
      const response = await api.get<AdminNetworkContext>(
        pathWithQuery('/admin/members/network-context', {
          scope: query.scope,
          ...(focusId ? { focusId } : {}),
          depth: '3',
        }),
      );
      if (generation !== contextGeneration.current) return;
      const seeded = seedContextNodes(response);
      setContext(response);
      setTreeNodes(seeded);
      setListNodes([]);
      setListCursor(null);
      setExpandedKeys(expandedParents(seeded));
      setPendingKeys(new Set());
    } catch (reason) {
      if (generation !== contextGeneration.current) return;
      setContext(null);
      setTreeNodes([]);
      setError(asMessage(reason, 'The network hierarchy could not be loaded.'));
    } finally {
      if (generation === contextGeneration.current) setLoading(false);
    }
  }, [focusId, query.scope]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (searchSelection && query.selected !== searchSelection.membershipId) setSearchSelection(null);
    // Only react to a URL selection change. A search click sets local state just
    // before router.push, so including the local value here would clear it early.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.selected]);

  const reloadExpiredSnapshot = useCallback(() => {
    setNotice('The saved network snapshot expired, so this branch was safely reloaded.');
    void loadContext();
  }, [loadContext]);

  const loadListPage = useCallback(
    async (cursor?: string) => {
      if (!context || loadingList) return;
      const generation = contextGeneration.current;
      setLoadingList(true);
      setError('');
      try {
        const page = await api.get<BranchPage<AdminHierarchyMemberNode>>(
          pathWithQuery('/admin/members/network-list', {
            scope: query.scope,
            ...(focusId ? { focusId } : {}),
            snapshotAt: context.scope.snapshotAt,
            ...(cursor ? { cursor } : {}),
          }),
        );
        if (generation !== contextGeneration.current) return;
        setListNodes((current) => {
          const base = cursor ? current : context.focus ? [context.focus] : [];
          return mergeNodes(base, page.items);
        });
        setListCursor(page.nextCursor);
      } catch (reason) {
        if (generation !== contextGeneration.current) return;
        if (isSnapshotExpired(reason)) {
          reloadExpiredSnapshot();
          return;
        }
        setError(asMessage(reason, 'The network list could not be loaded.'));
      } finally {
        if (generation === contextGeneration.current) setLoadingList(false);
      }
    },
    [context, focusId, loadingList, query.scope, reloadExpiredSnapshot],
  );

  useEffect(() => {
    if (query.view !== 'list' || !context) return;
    const requestKey = `${context.scope.snapshotAt}:${query.scope}:${focusId ?? ''}`;
    if (initialListRequest.current === requestKey) return;
    initialListRequest.current = requestKey;
    void loadListPage();
  }, [context?.scope.snapshotAt, focusId, loadListPage, query.scope, query.view]);

  useEffect(() => {
    if (context && !context.capabilities.viewFinancials && query.lens === 'performance') {
      router.replace(buildNetworkHierarchyUrl(currentParams(), { lens: 'people' }), { scroll: false });
    }
  }, [context, currentParams, query.lens, router]);

  const activeNodes = query.view === 'list' ? listNodes : treeNodes;
  const model = useMemo(() => buildNetworkHierarchyModel(activeNodes), [activeNodes]);
  const allKnownNodes = useMemo(() => mergeNodes(treeNodes, listNodes), [listNodes, treeNodes]);
  const selectedKey = query.selected ?? (transientSelection ? hierarchyNodeKey(transientSelection) : null);
  const selectedNode = useMemo(() => {
    if (searchSelection && searchSelection.membershipId === query.selected) return searchSelection;
    if (transientSelection && hierarchyNodeKey(transientSelection) === selectedKey) return transientSelection;
    return selectedKey ? allKnownNodes.find((node) => hierarchyNodeKey(node) === selectedKey) ?? null : null;
  }, [allKnownNodes, query.selected, searchSelection, selectedKey, transientSelection]);

  const updateView = useCallback(
    (view: NetworkHierarchyView) => {
      router.push(buildNetworkHierarchyUrl(currentParams(), { view }), { scroll: false });
    },
    [currentParams, router],
  );

  const updateLens = useCallback(
    (lens: NetworkHierarchyLens) => {
      router.push(buildNetworkHierarchyUrl(currentParams(), { lens }), { scroll: false });
    },
    [currentParams, router],
  );

  const selectNode = useCallback(
    (node: NetworkHierarchyNode, key: string) => {
      if (node.kind !== 'member') {
        setTransientSelection(node);
        setSearchSelection(null);
        return;
      }
      setTransientSelection(null);
      setSearchSelection(null);
      router.push(buildHierarchySelectionUrl(currentParams(), key), { scroll: false });
    },
    [currentParams, router],
  );

  const selectSearchResult = useCallback(
    (member: AdminHierarchyMemberNode) => {
      setTransientSelection(null);
      setSearchSelection(member);
      router.push(buildHierarchySelectionUrl(currentParams(), member.membershipId), { scroll: false });
    },
    [currentParams, router],
  );

  const toggleNode = useCallback(
    async (node: NetworkHierarchyNode, key: string, expanded: boolean) => {
      if (!expanded) {
        setExpandedKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        return;
      }
      if (!context || node.kind === 'self' || node.kind === 'direct' || node.kind === 'anonymous') return;

      const parentKey = hierarchyParentKey(node);
      const hasLoadedChildren = (model.childrenByParent.get(key)?.length ?? 0) > 0;
      if (hasLoadedChildren) {
        setExpandedKeys((current) => new Set(current).add(key));
        return;
      }
      if (pendingKeys.has(key)) return;
      const generation = contextGeneration.current;
      setPendingKeys((current) => new Set(current).add(key));
      try {
        const page = await api.get<NodePage>(
          node.kind === 'cluster'
            ? pathWithQuery('/admin/members/network-cluster-children', {
                parentRef: parentKey ?? 'tenant-root',
                ...(focusId ? { focusId } : {}),
                clusterRef: node.clusterRef,
                snapshotAt: context.scope.snapshotAt,
              })
            : pathWithQuery('/admin/members/network-children', {
                parentRef: node.membershipId,
                ...(focusId ? { focusId } : {}),
                snapshotAt: context.scope.snapshotAt,
              }),
        );
        if (generation !== contextGeneration.current) return;
        const mergeBranchPage = (current: readonly AdminHierarchyNode[]) => {
          const withoutExpandedCluster = node.kind === 'cluster'
            ? current.filter((candidate) => hierarchyNodeKey(candidate) !== key)
            : current;
          return mergeNodes(withoutExpandedCluster, page.items);
        };
        setTreeNodes(mergeBranchPage);
        setListNodes((current) => (current.length > 0 ? mergeBranchPage(current) : current));
        setExpandedKeys((current) => {
          const next = new Set(current);
          if (node.kind === 'cluster') {
            if (parentKey) next.add(parentKey);
          } else {
            next.add(key);
          }
          return next;
        });
      } catch (reason) {
        if (generation !== contextGeneration.current) return;
        if (isSnapshotExpired(reason)) {
          reloadExpiredSnapshot();
          return;
        }
        setError(asMessage(reason, 'This branch could not be expanded.'));
      } finally {
        if (generation === contextGeneration.current) {
          setPendingKeys((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        }
      }
    },
    [context, focusId, model.childrenByParent, pendingKeys, reloadExpiredSnapshot],
  );

  const closeInspector = useCallback(() => {
    setSearchSelection(null);
    setTransientSelection(null);
    if (query.selected) router.push(buildHierarchySelectionUrl(currentParams(), null), { scroll: false });
  }, [currentParams, query.selected, router]);

  const focusBranch = useCallback(
    (membershipId: string) => {
      router.push(buildHierarchyFocusUrl(currentParams(), membershipId), { scroll: false });
    },
    [currentParams, router],
  );

  const wholeNetwork = useCallback(() => {
    router.push(buildWholeNetworkUrl(currentParams()), { scroll: false });
  }, [currentParams, router]);

  const openMember = useCallback(
    (membershipId: string) => {
      router.push(`/admin/members?member=${encodeURIComponent(membershipId)}`);
    },
    [router],
  );

  if (loading && !context) {
    return (
      <main className={styles.loadingPage} aria-busy="true">
        <LoaderCircle className={styles.spinner} aria-hidden="true" />
        <p>Preparing the network hierarchy…</p>
      </main>
    );
  }

  if (!context) {
    return (
      <main className={styles.failurePage}>
        <AlertCircle aria-hidden="true" />
        <h1>Network hierarchy is unavailable</h1>
        <p>{error || 'The network context could not be loaded.'}</p>
        <button type="button" className={styles.retryButton} onClick={() => void loadContext()}>
          <RefreshCw aria-hidden="true" />
          Try again
        </button>
      </main>
    );
  }

  const showTreePerformance = context.capabilities.viewFinancials && query.lens === 'performance';
  const loadedMembers = activeNodes.filter((node) => node.kind === 'member').length || context.scope.loadedNodes;
  const collapsedBranches = treeNodes.filter((node) => node.kind === 'cluster').length;
  const loadedLabel = `Loaded ${loadedMembers} of ${context.scope.totalNodes}`;
  const collapsedLabel = `${collapsedBranches} collapsed ${collapsedBranches === 1 ? 'branch' : 'branches'}`;

  return (
    <main className={styles.cockpitPage}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.overline}>Network control room</span>
          <h1>{tenantName} referral hierarchy</h1>
          <p>Orient around a person, inspect their branch, then deliberately set a new local Tier 1 root.</p>
        </div>
        <div className={styles.snapshotStatus} aria-label="Network snapshot status">
          <DatabaseZap aria-hidden="true" />
          <span>Snapshot held for this investigation</span>
        </div>
      </header>

      <AdminNetworkToolbar
        scope={query.scope}
        view={query.view}
        lens={query.lens}
        canViewFinancials={context.capabilities.viewFinancials}
        onWholeNetwork={wholeNetwork}
        onViewChange={updateView}
        onLensChange={updateLens}
        onOpenValueFlow={context.capabilities.viewFinancials ? () => router.push(buildValueFlowUrl(currentParams(), {}), { scroll: false }) : undefined}
      />

      {notice ? (
        <div className={styles.notice} role="status">
          <CircleAlert aria-hidden="true" />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice">×</button>
        </div>
      ) : null}
      {error ? (
        <div className={styles.inlineError} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}>Dismiss</button>
        </div>
      ) : null}

      <div className={styles.cockpitGrid}>
        <div className={styles.utilityColumn}>
          <AdminNetworkSearch onSelect={selectSearchResult} />
          <LineageSignalRail context={context} selected={selectedNode} />
        </div>

        <section className={styles.workspace} aria-label="Referral network workspace">
          <div className={styles.workspaceHeader}>
            <div>
              <span className={styles.workspaceLabel}>{query.view === 'tree' ? 'Branch hierarchy' : 'Member list'}</span>
              <h2>{query.scope === 'focused' ? 'Focused Tier 1 branch' : 'Whole company network'}</h2>
            </div>
            <div className={styles.scopeFacts}>
              <span><strong>{loadedLabel}</strong> members</span>
              <span>{collapsedLabel}</span>
              <span>{context.scope.complete ? 'Complete snapshot' : 'Expandable snapshot'}</span>
            </div>
          </div>

          <div className={styles.canvas} data-view={query.view} data-pending={pendingKeys.size > 0 || undefined}>
            {query.view === 'tree' ? (
              <NetworkHierarchyTree
                model={model}
                expandedKeys={expandedKeys}
                selectedKey={selectedKey}
                viewFinancials={showTreePerformance}
                onSelect={selectNode}
                onToggle={toggleNode}
                ariaLabel="Admin referral network tree"
                idPrefix="admin-network-tree"
              />
            ) : loadingList && listNodes.length === 0 ? (
              <div className={styles.listLoading}><LoaderCircle className={styles.spinner} aria-hidden="true" />Loading the member list…</div>
            ) : (
              <NetworkHierarchyList
                model={model}
                expandedKeys={expandedKeys}
                selectedKey={selectedKey}
                viewFinancials={showTreePerformance}
                onSelect={selectNode}
                onToggle={toggleNode}
                ariaLabel="Admin referral network list"
                idPrefix="admin-network-list"
              />
            )}
          </div>

          {query.view === 'list' && listCursor ? (
            <div className={styles.listPagination}>
              <button type="button" disabled={loadingList} onClick={() => void loadListPage(listCursor)}>
                {loadingList ? 'Loading…' : 'Load more members'}
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </section>

        <NetworkHierarchyInspector
          selected={selectedNode}
          viewFinancials={showTreePerformance}
          onClose={closeInspector}
          onFocus={context.capabilities.focusBranch ? focusBranch : undefined}
          onOpenMember={context.capabilities.openMember ? openMember : undefined}
        />
      </div>

      <footer className={styles.footnote}>
        <UsersRound aria-hidden="true" />
        Exact branch and tier counts are supplied by the server. Expand a group only when you need its people.
      </footer>
    </main>
  );
}

/**
 * The hierarchy is the safe default. Value Flow remains an explicitly chosen,
 * permission-gated financial surface so it cannot accidentally become the
 * admin's default network orientation screen.
 */
export function AdminNetworkHierarchyContent({ tenantName, valueFlowCapabilities }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramString = searchParams.toString();
  const query = useMemo(
    () => parseNetworkHierarchyQuery(new URLSearchParams(paramString)),
    [paramString],
  );
  const requestedSurface = useMemo(
    () => new URLSearchParams(paramString).get('surface'),
    [paramString],
  );

  useEffect(() => {
    const shouldCanonicalizeHierarchy =
      query.surface === 'hierarchy' && requestedSurface !== 'hierarchy';
    if (
      (query.surface === 'value-flow' && !valueFlowCapabilities.financials) ||
      shouldCanonicalizeHierarchy
    ) {
      router.replace(buildNetworkHierarchyUrl(new URLSearchParams(paramString)), { scroll: false });
    }
  }, [paramString, query.surface, requestedSurface, router, valueFlowCapabilities.financials]);

  if (query.surface === 'value-flow' && valueFlowCapabilities.financials) {
    return (
      <ReferralValueFlowContent
        tenantName={tenantName}
        capabilities={{
          dashboard: valueFlowCapabilities.dashboard,
          network: valueFlowCapabilities.network,
          memberDetails: valueFlowCapabilities.memberDetails,
          plans: valueFlowCapabilities.plans,
          recentSales: valueFlowCapabilities.recentSales,
        }}
      />
    );
  }

  return <NetworkCockpit tenantName={tenantName} query={query} />;
}
