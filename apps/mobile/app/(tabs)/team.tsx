import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { MemberNetworkOutline, type MemberNetworkContinuation } from '@/components/MemberNetworkOutline';
import { Button, Card, ErrorText, MutedText, Title } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  MemberNetworkPayloadError,
  mergeMemberVisibleNodes,
  parseMemberBranchPage,
  parseMemberNetworkContext,
  type AnonymousTierTwo,
  type ClusterNode,
  type NetworkContext,
  type OpaqueReference,
  type VisibleNode,
} from '@/lib/member-network';
import { space, useTheme } from '@/theme';

function isSnapshotExpired(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  if (typeof error.body !== 'object' || error.body === null) return true;
  const body = error.body as { code?: unknown };
  return body.code === undefined || body.code === 'NETWORK_SNAPSHOT_EXPIRED';
}

function errorMessage(error: unknown): string {
  if (error instanceof MemberNetworkPayloadError) return 'The network response did not meet this view\'s privacy contract.';
  if (error instanceof ApiError) return error.message || 'Your protected network could not be loaded.';
  return 'Your protected network could not be loaded.';
}

export default function TeamScreen() {
  const { colors } = useTheme();
  const [context, setContext] = useState<NetworkContext | null>(null);
  const [nodes, setNodes] = useState<VisibleNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['self']));
  const [rootContinuation, setRootContinuation] = useState<Pick<MemberNetworkContinuation, 'parentRef' | 'cursor'> | null>(null);
  const [branchContinuations, setBranchContinuations] = useState<Record<string, MemberNetworkContinuation>>({});
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const snapshotGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++snapshotGeneration.current;
    setBusy(new Set());
    setError('');
    try {
      const next = parseMemberNetworkContext(await api.get<unknown>('/app/team/tree'));
      if (snapshotGeneration.current !== generation) return;
      setContext(next);
      setNodes(next.initialPage.items);
      setExpanded(new Set(['self']));
      setRootContinuation(
        next.initialPage.nextCursor
          ? { parentRef: next.initialPage.parentRef, cursor: next.initialPage.nextCursor }
          : null,
      );
      setBranchContinuations({});
    } catch (reason) {
      if (snapshotGeneration.current === generation) setError(errorMessage(reason));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadBranch = useCallback(
    async (
      parentKey: string,
      parentRef: OpaqueReference,
      cursor: OpaqueReference | null,
      continuationKey: string,
      tier: 1 | 2 | 3,
      removeKey?: string,
    ) => {
      if (!context || busy.has(continuationKey)) return;
      const generation = snapshotGeneration.current;
      const activeSnapshot = context.scope.snapshotAt;
      setBusy((current) => new Set(current).add(continuationKey));

      try {
        const params = new URLSearchParams({ parentRef, snapshotAt: activeSnapshot });
        if (cursor) params.set('cursor', cursor);
        const page = parseMemberBranchPage(
          await api.get<unknown>(`/app/team/tree/children?${params.toString()}`),
          activeSnapshot,
        );
        if (snapshotGeneration.current !== generation) return;

        setNodes((current) => mergeMemberVisibleNodes(current, page.items, removeKey));
        setExpanded((current) => new Set(current).add(parentKey));
        const continuation = page.nextCursor ? { parentRef: page.parentRef, cursor: page.nextCursor, tier } : null;
        if (continuationKey === 'root') {
          setRootContinuation(continuation ? { parentRef: continuation.parentRef, cursor: continuation.cursor } : null);
        } else {
          setBranchContinuations((current) => {
            const next = { ...current };
            if (continuation) next[continuationKey] = continuation;
            else delete next[continuationKey];
            return next;
          });
        }
      } catch (reason) {
        if (isSnapshotExpired(reason) && snapshotGeneration.current === generation) {
          await load();
        } else if (snapshotGeneration.current === generation) {
          setError(errorMessage(reason));
        }
      } finally {
        if (snapshotGeneration.current === generation) {
          setBusy((current) => {
            const next = new Set(current);
            next.delete(continuationKey);
            return next;
          });
        }
      }
    },
    [busy, context, load],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const onToggleNode = useCallback(
    (node: AnonymousTierTwo | Extract<VisibleNode, { kind: 'direct' }>, key: string, childCount: number) => {
      const wasExpanded = expanded.has(key);
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      if (!wasExpanded && node.canExpand && childCount === 0) {
        const childTier: 2 | 3 = node.localTier === 1 ? 2 : 3;
        void loadBranch(key, node.nodeRef, null, key, childTier);
      }
    },
    [expanded, loadBranch],
  );

  const onLoadCluster = useCallback(
    (node: ClusterNode, key: string) => {
      void loadBranch(node.parentRef, node.parentRef, node.clusterRef, key, node.localTier, key);
    },
    [loadBranch],
  );

  const onLoadContinuation = useCallback(
    (
      parentKey: string,
      parentRef: OpaqueReference,
      cursor: OpaqueReference,
      continuationKey: string,
      tier: 1 | 2 | 3,
    ) => {
      void loadBranch(parentKey, parentRef, cursor, continuationKey, tier);
    },
    [loadBranch],
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      contentContainerStyle={{ padding: space.s4, paddingTop: space.s8, paddingBottom: space.s8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Title
        eyebrow="Member Focus Tree"
        title="My network"
        sub={context ? 'Your sponsor, your place, and the first three visible levels.' : 'Your protected referral outline'}
      />
      {context ? (
        <>
          <MemberNetworkOutline
            context={context}
            nodes={nodes}
            expandedKeys={expanded}
            busyKeys={busy}
            rootContinuation={rootContinuation}
            branchContinuations={branchContinuations}
            onToggleNode={onToggleNode}
            onLoadCluster={onLoadCluster}
            onLoadContinuation={onLoadContinuation}
          />
          {error ? (
            <Card>
              <ErrorText>{error}</ErrorText>
              <Button title="Refresh network" onPress={onRefresh} variant="ghost" />
            </Card>
          ) : null}
        </>
      ) : (
        <Card>{error ? <ErrorText>{error}</ErrorText> : <MutedText>Loading your protected network...</MutedText>}</Card>
      )}
    </ScrollView>
  );
}
