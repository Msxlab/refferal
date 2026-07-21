'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, List, Network, RefreshCw, Search, ShieldCheck, UsersRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import {
  buildNetworkHierarchyModel,
  hierarchyNodeKey,
  type NetworkHierarchyModel,
} from '@/components/network-hierarchy/network-hierarchy.model';
import { NetworkHierarchyInspector } from '@/components/network-hierarchy/NetworkHierarchyInspector';
import { NetworkHierarchyList } from '@/components/network-hierarchy/NetworkHierarchyList';
import { NetworkHierarchyTree } from '@/components/network-hierarchy/NetworkHierarchyTree';
import {
  buildMemberNetworkHierarchyUrl,
  parseMemberNetworkHierarchyQuery,
} from '@/components/network-hierarchy/network-hierarchy.url';
import type {
  MemberDirectNode,
  MemberVisibleClusterNode,
  MemberVisibleNode,
  NetworkHierarchyNode,
  OpaqueMemberNodeRef,
} from '@/components/network-hierarchy/types';
import {
  type MemberNetworkContextPayload,
  MemberNetworkPayloadError,
  MemberNetworkSnapshotMismatchError,
  parseMemberBranchPage,
  parseMemberDirectSearchPage,
  parseMemberNetworkContext,
} from './member-network.adapter';
import styles from './member-network.module.css';

interface BranchContinuation {
  parentRef: OpaqueMemberNodeRef;
  cursor: OpaqueMemberNodeRef;
  tierLabel: 'Tier 1' | 'Tier 2' | 'Tier 3';
}

function isSnapshotExpired(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  if (typeof error.body !== 'object' || error.body === null) return true;
  const body = error.body as { code?: unknown };
  return body.code === undefined || body.code === 'NETWORK_SNAPSHOT_EXPIRED';
}

function errorMessage(error: unknown): string {
  if (error instanceof MemberNetworkPayloadError) return 'The network response did not meet this view’s privacy contract. Refresh to try again.';
  if (error instanceof ApiError) return error.message || 'The network could not be loaded.';
  return 'The network could not be loaded.';
}

function mergeVisibleNodes(
  current: readonly MemberVisibleNode[],
  incoming: readonly MemberVisibleNode[],
  removeKey?: string,
): MemberVisibleNode[] {
  const next = new Map<string, MemberVisibleNode>();
  for (const node of current) {
    if (hierarchyNodeKey(node) !== removeKey) next.set(hierarchyNodeKey(node), node);
  }
  for (const node of incoming) next.set(hierarchyNodeKey(node), node);
  return [...next.values()];
}

function mergeDirectNodes(
  current: readonly MemberDirectNode[],
  incoming: readonly MemberDirectNode[],
): MemberDirectNode[] {
  const next = new Map<OpaqueMemberNodeRef, MemberDirectNode>();
  for (const node of current) next.set(node.nodeRef, node);
  for (const node of incoming) next.set(node.nodeRef, node);
  return [...next.values()];
}

function memberNodeReference(node: MemberVisibleNode): OpaqueMemberNodeRef {
  return node.kind === 'cluster' ? node.clusterRef : node.nodeRef;
}

function continuationTierLabel(node: MemberVisibleNode): BranchContinuation['tierLabel'] {
  if (node.kind === 'direct') return 'Tier 2';
  if (node.kind === 'anonymous') return node.localTier === 2 ? 'Tier 3' : 'Tier 3';
  return node.localTier === 2 ? 'Tier 2' : 'Tier 3';
}

function isMemberVisibleClusterNode(node: NetworkHierarchyNode): node is MemberVisibleClusterNode {
  return node.kind === 'cluster' && 'parentRef' in node;
}

function StatusLine({ context }: { context: MemberNetworkContextPayload }) {
  const label = context.scope.completeWithinVisibleDepth ? 'Visible view is complete' : 'Visible view is partially loaded';
  return (
    <div className={styles.scopeStatus}>
      <span>{label}</span>
      <strong>{context.scope.loadedNodes} loaded</strong>
      <span aria-hidden="true">·</span>
      <strong>{context.scope.representedNodes} represented</strong>
    </div>
  );
}

function SponsorSignal({ context }: { context: MemberNetworkContextPayload }) {
  return (
    <section className={styles.signalRail} aria-label="Your network position">
      {context.sponsor ? (
        <article className={styles.signalStop}>
          <span className={styles.signalLabel}>Your sponsor</span>
          <strong>{context.sponsor.displayName}</strong>
          <small>{context.sponsor.referralCode}</small>
        </article>
      ) : (
        <article className={styles.signalStop}>
          <span className={styles.signalLabel}>Your sponsor</span>
          <strong>No sponsor on record</strong>
          <small>This is the top of your visible line.</small>
        </article>
      )}
      <span className={styles.signalConnector} aria-hidden="true" />
      <article className={`${styles.signalStop} ${styles.signalSelf}`}>
        <span className={styles.signalLabel}>You are here</span>
        <strong>{context.self.displayName}</strong>
        <small>{context.self.referralCode}</small>
      </article>
    </section>
  );
}

function TreeSkeleton() {
  return (
    <section className={styles.loadingState} aria-live="polite" aria-label="Loading your network">
      <span className={styles.loadingRail} />
      <span className={styles.loadingCard} />
      <span className={styles.loadingCard} />
      <span className={styles.loadingCard} />
    </section>
  );
}

/** Member-only Focus Tree. Selection, search, and expansion remain local to the browser. */
export function MemberNetworkTreeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = useMemo(
    () => parseMemberNetworkHierarchyQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [context, setContext] = useState<MemberNetworkContextPayload | null>(null);
  const [nodes, setNodes] = useState<MemberVisibleNode[]>([]);
  const [rootContinuation, setRootContinuation] = useState<BranchContinuation | null>(null);
  const [branchContinuations, setBranchContinuations] = useState<Record<string, BranchContinuation>>({});
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set(['self']));
  const [selectedKey, setSelectedKey] = useState<string | null>('self');
  const [searchSelection, setSearchSelection] = useState<MemberDirectNode | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedSearchQuery, setAppliedSearchQuery] = useState<string | null>(null);
  const [searchSnapshotAt, setSearchSnapshotAt] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<MemberDirectNode[]>([]);
  const [searchCursor, setSearchCursor] = useState<OpaqueMemberNodeRef | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestGeneration = useRef(0);
  const searchRequestGeneration = useRef(0);

  const updateQuery = useCallback(
    (next: Partial<typeof query>) => {
      router.replace(buildMemberNetworkHierarchyUrl(new URLSearchParams(searchParams.toString()), next), { scroll: false });
    },
    [query, router, searchParams],
  );

  useEffect(() => {
    const raw = searchParams.toString();
    const currentUrl = raw ? `/app/team?${raw}` : '/app/team';
    const canonicalUrl = buildMemberNetworkHierarchyUrl(new URLSearchParams(raw), {});
    if (canonicalUrl !== currentUrl) router.replace(canonicalUrl, { scroll: false });
  }, [router, searchParams]);

  useEffect(() => {
    let mounted = true;
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError('');
    api
      .get<unknown>('/app/team/tree')
      .then((payload) => {
        const next = parseMemberNetworkContext(payload);
        if (!mounted || requestGeneration.current !== generation) return;
        setContext(next);
        setNodes(next.initialPage.items);
        setRootContinuation(
          next.initialPage.nextCursor
            ? { parentRef: next.initialPage.parentRef, cursor: next.initialPage.nextCursor, tierLabel: 'Tier 1' }
            : null,
        );
        setBranchContinuations({});
        setExpandedKeys(new Set(['self']));
        setSelectedKey('self');
        setSearchSelection(null);
      })
      .catch((reason: unknown) => {
        if (!mounted || requestGeneration.current !== generation) return;
        setError(errorMessage(reason));
      })
      .finally(() => {
        if (mounted && requestGeneration.current === generation) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [reloadVersion]);

  const model = useMemo<NetworkHierarchyModel | null>(() => {
    if (!context) return null;
    return buildNetworkHierarchyModel([context.self, ...nodes]);
  }, [context, nodes]);

  const selectedNode: NetworkHierarchyNode | null = useMemo(() => {
    if (searchSelection) return searchSelection;
    return selectedKey && model ? model.nodesByKey.get(selectedKey) ?? null : null;
  }, [model, searchSelection, selectedKey]);

  const invalidateDirectSearch = useCallback((clearDraft = false) => {
    searchRequestGeneration.current += 1;
    if (clearDraft) setSearchDraft('');
    setSearchResults([]);
    setSearchCursor(null);
    setAppliedSearchQuery(null);
    setSearchSnapshotAt(null);
    setSearchError('');
    setSearchSelection(null);
    setSearching(false);
  }, []);

  const refreshSnapshot = useCallback(() => {
    requestGeneration.current += 1;
    invalidateDirectSearch();
    setBusyKeys(new Set());
    setReloadVersion((version) => version + 1);
  }, [invalidateDirectSearch]);

  const loadBranch = useCallback(
    async ({
      parentKey,
      parentRef,
      cursor,
      continuationKey,
      tierLabel,
      removeKey,
    }: {
      parentKey: string;
      parentRef: OpaqueMemberNodeRef;
      cursor: OpaqueMemberNodeRef | null;
      continuationKey: string;
      tierLabel: BranchContinuation['tierLabel'];
      removeKey?: string;
    }) => {
      if (!context || busyKeys.has(continuationKey)) return;
      const generation = requestGeneration.current;
      const activeSnapshot = context.scope.snapshotAt;
      setBusyKeys((current) => new Set(current).add(continuationKey));
      try {
        const params = new URLSearchParams({ parentRef, snapshotAt: activeSnapshot });
        if (cursor) params.set('cursor', cursor);
        const raw = await api.get<unknown>(`/app/team/tree/children?${params.toString()}`);
        const page = parseMemberBranchPage(raw, activeSnapshot);
        if (requestGeneration.current !== generation) return;
        setNodes((current) => mergeVisibleNodes(current, page.items, removeKey));
        setExpandedKeys((current) => new Set(current).add(parentKey));
        const continuation = page.nextCursor
          ? { parentRef: page.parentRef, cursor: page.nextCursor, tierLabel }
          : null;
        if (continuationKey === 'root') setRootContinuation(continuation);
        else {
          setBranchContinuations((current) => {
            const next = { ...current };
            if (continuation) next[continuationKey] = continuation;
            else delete next[continuationKey];
            return next;
          });
        }
      } catch (reason) {
        if (requestGeneration.current !== generation) return;
        if (isSnapshotExpired(reason)) {
          refreshSnapshot();
          return;
        }
        setError(errorMessage(reason));
      } finally {
        if (requestGeneration.current !== generation) return;
        setBusyKeys((current) => {
          const next = new Set(current);
          next.delete(continuationKey);
          return next;
        });
      }
    },
    [busyKeys, context, refreshSnapshot],
  );

  const toggleNode = useCallback(
    (node: NetworkHierarchyNode, key: string, expanded: boolean) => {
      if (node.kind === 'cluster') {
        if (!isMemberVisibleClusterNode(node)) return;
        const cluster = node;
        void loadBranch({
          parentKey: cluster.parentRef,
          parentRef: cluster.parentRef,
          cursor: cluster.clusterRef,
          continuationKey: hierarchyNodeKey(cluster),
          tierLabel: continuationTierLabel(cluster),
          removeKey: hierarchyNodeKey(cluster),
        });
        return;
      }
      if (node.kind === 'member' || node.kind === 'self') {
        setExpandedKeys((current) => {
          const next = new Set(current);
          if (expanded) next.add(key);
          else next.delete(key);
          return next;
        });
        return;
      }
      setExpandedKeys((current) => {
        const next = new Set(current);
        if (expanded) next.add(key);
        else next.delete(key);
        return next;
      });
      if (expanded && node.canExpand && model && (model.childrenByParent.get(key)?.length ?? 0) === 0) {
        void loadBranch({
          parentKey: key,
          parentRef: memberNodeReference(node),
          cursor: null,
          continuationKey: key,
          tierLabel: continuationTierLabel(node),
        });
      }
    },
    [loadBranch, model],
  );

  const selectNode = useCallback((node: NetworkHierarchyNode, key: string) => {
    setSearchSelection(null);
    setSelectedKey(key);
  }, []);

  const updateSearchDraft = useCallback((value: string) => {
    invalidateDirectSearch();
    setSearchDraft(value);
  }, [invalidateDirectSearch]);

  const submitSearch = useCallback(
    async (cursor: OpaqueMemberNodeRef | null = null) => {
      const queryText = searchDraft.trim();
      if (queryText.length < 2) {
        setSearchError('Enter at least two characters to find a direct teammate.');
        return;
      }
      const expectedSnapshot = cursor ? searchSnapshotAt ?? undefined : undefined;
      if (cursor && (!expectedSnapshot || appliedSearchQuery !== queryText)) {
        invalidateDirectSearch();
        return;
      }
      setSearching(true);
      setSearchError('');
      const generation = requestGeneration.current;
      const searchGeneration = ++searchRequestGeneration.current;
      try {
        const raw = await api.post<unknown>('/app/team/tree/direct-search', cursor ? { query: queryText, cursor } : { query: queryText });
        const page = parseMemberDirectSearchPage(raw, expectedSnapshot);
        if (requestGeneration.current !== generation || searchRequestGeneration.current !== searchGeneration) return;
        if (cursor) {
          setSearchResults((current) => mergeDirectNodes(current, page.items));
        } else {
          setSearchResults(page.items);
          setAppliedSearchQuery(queryText);
          setSearchSnapshotAt(page.snapshotAt);
        }
        setSearchCursor(page.nextCursor);
      } catch (reason) {
        if (requestGeneration.current !== generation || searchRequestGeneration.current !== searchGeneration) return;
        if (isSnapshotExpired(reason) || reason instanceof MemberNetworkSnapshotMismatchError) {
          refreshSnapshot();
          return;
        }
        setSearchError(errorMessage(reason));
      } finally {
        if (requestGeneration.current === generation && searchRequestGeneration.current === searchGeneration) setSearching(false);
      }
    },
    [appliedSearchQuery, invalidateDirectSearch, refreshSnapshot, searchDraft, searchSnapshotAt],
  );

  if (loading && !context) return <TreeSkeleton />;
  if (!context || !model) {
    return (
      <section className={styles.fatalState} role="alert">
        <AlertCircle aria-hidden="true" />
        <span className={styles.fatalEyebrow}>Network unavailable</span>
        <h1>Your protected network view is unavailable</h1>
        <p>{error || 'Refresh to load the current network snapshot.'}</p>
        <button type="button" className={styles.retryButton} onClick={refreshSnapshot}>
          <RefreshCw aria-hidden="true" />
          Refresh network
        </button>
      </section>
    );
  }

  const activeView = query.view;
  const activeLens = query.lens;
  const visibleContinuations = Object.entries(branchContinuations);

  return (
    <div className={styles.page} data-lens={activeLens}>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {loading ? 'Refreshing your network.' : 'Your network view is up to date.'}
      </span>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Member Focus Tree</span>
          <h1>My network</h1>
          <p>Follow your sponsor, your own position, and the first three visible levels without exposing deeper member identities.</p>
        </div>
        <div className={styles.visibilityBadge}>
          <ShieldCheck aria-hidden="true" />
          <span>Visible through Tier 3</span>
        </div>
      </header>

      <SponsorSignal context={context} />

      <section className={styles.privacyNotice} aria-label="Network privacy policy">
        <ShieldCheck aria-hidden="true" />
        <p><strong>Private by design.</strong> Your direct teammates are named; deeper visible teammates are shown only with initials and summary bands.</p>
      </section>

      <section className={styles.toolbar} aria-label="Network controls">
        <div className={styles.segmented} role="group" aria-label="Network view">
          <button type="button" data-active={activeView === 'tree' || undefined} onClick={() => updateQuery({ view: 'tree' })} aria-pressed={activeView === 'tree'}>
            <Network aria-hidden="true" />
            Tree
          </button>
          <button type="button" data-active={activeView === 'list' || undefined} onClick={() => updateQuery({ view: 'list' })} aria-pressed={activeView === 'list'}>
            <List aria-hidden="true" />
            List
          </button>
        </div>
        <div className={styles.segmented} role="group" aria-label="Network lens">
          <button type="button" data-active={activeLens === 'people' || undefined} onClick={() => updateQuery({ lens: 'people' })} aria-pressed={activeLens === 'people'}>
            <UsersRound aria-hidden="true" />
            People
          </button>
          <button type="button" data-active={activeLens === 'performance' || undefined} onClick={() => updateQuery({ lens: 'performance' })} aria-pressed={activeLens === 'performance'}>
            <ShieldCheck aria-hidden="true" />
            Performance
          </button>
        </div>
        <Button type="button" variant="outline" onClick={refreshSnapshot} disabled={loading} className={styles.refreshButton}>
          <RefreshCw aria-hidden="true" className={loading ? styles.spinning : undefined} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </section>

      <section className={styles.searchPanel} aria-label="Search direct teammates">
        <form
          className={styles.searchForm}
          onSubmit={(event) => {
            event.preventDefault();
            void submitSearch();
          }}
        >
          <Search aria-hidden="true" />
          <label className="sr-only" htmlFor="member-network-search">Search your direct teammates</label>
          <Input
            id="member-network-search"
            type="search"
            value={searchDraft}
            onChange={(event) => updateSearchDraft(event.target.value.slice(0, 120))}
            placeholder="Search your direct teammates"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="outline" disabled={searching}>{searching ? 'Searching…' : 'Search'}</Button>
          {searchResults.length > 0 || searchError ? (
            <button
              type="button"
              className={styles.clearSearch}
              aria-label="Clear direct teammate search"
              onClick={() => invalidateDirectSearch(true)}
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </form>
        {searchError ? <p className={styles.searchError} role="status">{searchError}</p> : null}
        {searchResults.length > 0 ? (
          <div className={styles.searchResults} aria-label="Direct teammate matches">
            {searchResults.map((node) => (
              <button
                type="button"
                key={node.nodeRef}
                onClick={() => {
                  setSearchSelection(node);
                  setSelectedKey(null);
                }}
              >
                <span>{node.initials}</span>
                <strong>{node.displayName}</strong>
                <small>{node.referralCode}</small>
              </button>
            ))}
            {searchCursor ? (
              <Button type="button" variant="outline" onClick={() => void submitSearch(searchCursor)} disabled={searching}>
                Load more direct teammates
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className={styles.workspaceHeader}>
        <div>
          <span className={styles.eyebrow}>{activeLens === 'performance' ? 'Safe performance bands' : 'People hierarchy'}</span>
          <h2>{activeView === 'tree' ? 'Your visible referral line' : 'Your visible referral list'}</h2>
        </div>
        <StatusLine context={context} />
      </div>

      {error ? (
        <div className={styles.inlineError} role="status">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={refreshSnapshot}>Retry</button>
        </div>
      ) : null}

      <div className={styles.workspaceGrid}>
        <section className={styles.treePanel} aria-label="Your referral hierarchy">
          {activeView === 'tree' ? (
            <NetworkHierarchyTree
              model={model}
              expandedKeys={expandedKeys}
              selectedKey={selectedKey}
              showPerformance={activeLens === 'performance'}
              onSelect={selectNode}
              onToggle={toggleNode}
              ariaLabel="Your referral hierarchy"
              emptyLabel="Invite your first teammate to begin this visible network."
              idPrefix="member-network-tree"
            />
          ) : (
            <NetworkHierarchyList
              model={model}
              expandedKeys={expandedKeys}
              selectedKey={selectedKey}
              showPerformance={activeLens === 'performance'}
              onSelect={selectNode}
              onToggle={toggleNode}
              ariaLabel="Your referral hierarchy list"
              emptyLabel="Invite your first teammate to begin this visible network."
              idPrefix="member-network-list"
            />
          )}

          {rootContinuation ? (
            <div className={styles.loadMoreRow}>
              <p>More named direct teammates are available in this protected view.</p>
              <Button
                type="button"
                variant="outline"
                disabled={busyKeys.has('root')}
                onClick={() =>
                  void loadBranch({
                    parentKey: 'self',
                    parentRef: rootContinuation.parentRef,
                    cursor: rootContinuation.cursor,
                    continuationKey: 'root',
                    tierLabel: 'Tier 1',
                  })
                }
              >
                {busyKeys.has('root') ? 'Loading…' : 'Load more Tier 1 members'}
              </Button>
            </div>
          ) : null}

          {visibleContinuations.length > 0 ? (
            <div className={styles.branchContinuations} aria-label="Continue visible branches">
              {visibleContinuations.map(([key, continuation]) => (
                <Button
                  type="button"
                  variant="outline"
                  key={key}
                  disabled={busyKeys.has(key)}
                  onClick={() =>
                    void loadBranch({
                      parentKey: key,
                      parentRef: continuation.parentRef,
                      cursor: continuation.cursor,
                      continuationKey: key,
                      tierLabel: continuation.tierLabel,
                    })
                  }
                >
                  {busyKeys.has(key) ? 'Loading…' : `Load more ${continuation.tierLabel} members`}
                </Button>
              ))}
            </div>
          ) : null}
        </section>

        <NetworkHierarchyInspector
          selected={selectedNode}
          showPerformance={activeLens === 'performance'}
          onClose={() => {
            setSelectedKey(null);
            setSearchSelection(null);
          }}
        />
      </div>

      <footer className={styles.footerNote}>
        <span>Need to grow your named first level?</span>
        <Link href="/app/invite">Invite a teammate</Link>
      </footer>
    </div>
  );
}
