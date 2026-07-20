import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Badge, Button, Card, ErrorText, Field, MutedText } from '@/components/ui';
import {
  memberNodeKey,
  memberParentKey,
  type AnonymousTierTwo,
  type ClusterNode,
  type DirectNode,
  type NetworkContext,
  type OpaqueReference,
  type PerformanceBand,
  type VisibleNode,
} from '@/lib/member-network';
import { alpha, radius, space, text, useTheme } from '@/theme';

export interface MemberNetworkContinuation {
  parentRef: OpaqueReference;
  cursor: OpaqueReference;
  tier: 1 | 2 | 3;
}

interface MemberNetworkOutlineProps {
  context: NetworkContext;
  nodes: readonly VisibleNode[];
  expandedKeys: ReadonlySet<string>;
  busyKeys: ReadonlySet<string>;
  rootContinuation: Pick<MemberNetworkContinuation, 'parentRef' | 'cursor'> | null;
  branchContinuations: Readonly<Record<string, MemberNetworkContinuation>>;
  searchDraft: string;
  searchResults: readonly DirectNode[];
  searchCursor: OpaqueReference | null;
  searching: boolean;
  searchError: string;
  onSearchDraftChange: (value: string) => void;
  onSearch: () => void;
  onLoadMoreSearch: () => void;
  onClearSearch: () => void;
  onToggleNode: (node: DirectNode | AnonymousTierTwo, key: string, childCount: number) => void;
  onLoadCluster: (node: ClusterNode, key: string) => void;
  onLoadContinuation: (
    parentKey: string,
    parentRef: OpaqueReference,
    cursor: OpaqueReference,
    continuationKey: string,
    tier: 1 | 2 | 3,
  ) => void;
}

function clusterTitle(node: ClusterNode): string {
  return `+${node.representedNodes} Tier ${node.localTier} ${node.representedNodes === 1 ? 'member' : 'members'}`;
}

function performanceLabel(band: PerformanceBand): string {
  if (band.suppressed) {
    return band.reason === 'smallCohort' ? 'Summary unavailable for a small group' : 'No performance summary';
  }
  const volume = {
    none: 'no volume',
    under1k: 'under 1k volume',
    '1k-5k': '1k-5k volume',
    '5k-10k': '5k-10k volume',
    '10k+': '10k+ volume',
  }[band.volumeBand];
  return `${band.approvedSalesBand} approved / ${volume}`;
}

function NetworkNodeRow({
  node,
  childrenByParent,
  expandedKeys,
  busyKeys,
  onToggleNode,
  onLoadCluster,
}: {
  node: VisibleNode;
  childrenByParent: ReadonlyMap<string, VisibleNode[]>;
  expandedKeys: ReadonlySet<string>;
  busyKeys: ReadonlySet<string>;
  onToggleNode: (node: DirectNode | AnonymousTierTwo, key: string, childCount: number) => void;
  onLoadCluster: (node: ClusterNode, key: string) => void;
}) {
  const { colors } = useTheme();
  const key = memberNodeKey(node);
  const children = childrenByParent.get(key) ?? [];
  const expanded = expandedKeys.has(key);
  const busy = busyKeys.has(key);
  const terminal = node.kind === 'anonymous' && node.localTier === 3;
  const expandable = !terminal && node.canExpand;
  const title = node.kind === 'direct' ? node.displayName : node.kind === 'anonymous' ? `${node.initials} / ${node.label}` : clusterTitle(node);
  const detail = node.kind === 'direct'
    ? `${node.visibleBranchCount} visible in this branch / ${node.performance.approvedSales} approved`
    : node.kind === 'anonymous'
      ? performanceLabel(node.performanceBand)
      : 'Open this exact visible-tier group';
  const status = node.kind === 'cluster' ? 'group' : node.status;
  const cardStyle = {
    borderWidth: 1,
    borderColor: node.kind === 'cluster' ? alpha(colors.amber, 0.48) : colors.border,
    borderRadius: radius.md,
    padding: space.s3,
    backgroundColor: node.kind === 'cluster' ? colors.warningSubtle : colors.panel2,
  } as const;
  const contents = (
    <View style={{ flexDirection: 'row', gap: space.s3, alignItems: 'center' }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: node.kind === 'cluster' ? alpha(colors.amber, 0.18) : alpha(colors.primary, 0.12),
        }}
      >
        <Text style={{ color: node.kind === 'cluster' ? colors.amber : colors.primary, fontSize: text.xs, fontWeight: '800' }}>
          {node.kind === 'cluster' ? '+' : node.initials}
        </Text>
      </View>
      <View style={{ minWidth: 0, flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: text.md, fontWeight: '700' }}>
          {title}
        </Text>
        <Text numberOfLines={2} style={{ color: colors.muted, fontSize: text.xs, marginTop: 2 }}>
          {detail}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Badge value={status} />
        {expandable ? (
          <Text style={{ color: colors.primary, fontSize: text.xs, fontWeight: '800' }}>
            {busy ? 'Loading' : expanded ? 'Hide' : 'Show'}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const nestedChildren = expanded && node.kind !== 'cluster' && children.length > 0 ? (
    <View style={{ marginLeft: space.s3, paddingLeft: space.s3, borderLeftWidth: 1, borderLeftColor: colors.border, gap: space.s2 }}>
      {children.map((child) => (
        <NetworkNodeRow
          key={memberNodeKey(child)}
          node={child}
          childrenByParent={childrenByParent}
          expandedKeys={expandedKeys}
          busyKeys={busyKeys}
          onToggleNode={onToggleNode}
          onLoadCluster={onLoadCluster}
        />
      ))}
    </View>
  ) : null;

  // Tier 3 is an explicit visual endpoint: no press handler or button semantics.
  if (terminal) {
    return (
      <View style={{ gap: space.s2 }}>
        <View accessibilityLabel={`${title}. ${detail}. Final visible level`} style={cardStyle}>
          {contents}
        </View>
      </View>
    );
  }

  if (!expandable) {
    return (
      <View style={{ gap: space.s2 }}>
        <View accessibilityLabel={`${title}. ${detail}`} style={cardStyle}>
          {contents}
        </View>
        {nestedChildren}
      </View>
    );
  }

  const onPress = node.kind === 'cluster'
    ? () => onLoadCluster(node, key)
    : () => onToggleNode(node, key, children.length);

  return (
    <View style={{ gap: space.s2 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${detail}. ${expanded ? 'Expanded' : 'Collapsed'}`}
        accessibilityState={{ expanded, busy }}
        disabled={busy}
        onPress={onPress}
        style={({ pressed }) => [cardStyle, { opacity: pressed ? 0.88 : 1 }]}
      >
        {contents}
      </Pressable>
      {nestedChildren}
    </View>
  );
}

export function MemberNetworkOutline({
  context,
  nodes,
  expandedKeys,
  busyKeys,
  rootContinuation,
  branchContinuations,
  searchDraft,
  searchResults,
  searchCursor,
  searching,
  searchError,
  onSearchDraftChange,
  onSearch,
  onLoadMoreSearch,
  onClearSearch,
  onToggleNode,
  onLoadCluster,
  onLoadContinuation,
}: MemberNetworkOutlineProps) {
  const { colors } = useTheme();
  const childrenByParent = useMemo(() => {
    const map = new Map<string, VisibleNode[]>();
    for (const node of nodes) {
      const parentKey = memberParentKey(node);
      const items = map.get(parentKey) ?? [];
      items.push(node);
      map.set(parentKey, items);
    }
    return map;
  }, [nodes]);
  const directChildren = childrenByParent.get('self') ?? [];

  return (
    <>
      <Card glow>
        <Text style={{ color: colors.primary, fontSize: text.xs, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' }}>
          Your position
        </Text>
        <View style={{ gap: space.s2, marginTop: space.s3 }}>
          <View style={{ padding: space.s3, borderRadius: radius.md, backgroundColor: colors.panel2 }}>
            <MutedText size={text.xs}>Your sponsor</MutedText>
            <Text style={{ color: colors.text, fontWeight: '700', marginTop: 2 }}>
              {context.sponsor?.displayName ?? 'No sponsor on record'}
            </Text>
            <MutedText size={text.xs}>{context.sponsor?.referralCode ?? 'Top of your visible line'}</MutedText>
          </View>
          <View style={{ width: 1, height: 18, marginLeft: space.s3, backgroundColor: colors.primary }} />
          <View
            style={{
              padding: space.s3,
              borderRadius: radius.md,
              backgroundColor: alpha(colors.primary, 0.1),
              borderWidth: 1,
              borderColor: alpha(colors.primary, 0.3),
            }}
          >
            <MutedText size={text.xs}>You are here</MutedText>
            <Text style={{ color: colors.text, fontWeight: '800', marginTop: 2 }}>{context.self.displayName}</Text>
            <MutedText size={text.xs}>{context.self.referralCode}</MutedText>
          </View>
        </View>
      </Card>

      <Card>
        <View style={{ gap: space.s2 }}>
          <View>
            <Text style={{ color: colors.text, fontWeight: '800' }}>Find a direct teammate</Text>
            <MutedText size={text.xs}>Search stays on this device and returns named Tier 1 teammates only.</MutedText>
          </View>
          <Field
            label="Search your direct teammates"
            value={searchDraft}
            onChangeText={(value) => onSearchDraftChange(value.slice(0, 120))}
            onSubmitEditing={onSearch}
            placeholder="Name or referral code"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <View style={{ flexDirection: 'row', gap: space.s2 }}>
            <View style={{ flex: 1 }}>
              <Button title={searching ? 'Searching...' : 'Search'} busy={searching} onPress={onSearch} variant="ghost" />
            </View>
            {searchDraft || searchResults.length > 0 || searchError ? (
              <View style={{ flex: 1 }}>
                <Button title="Clear" onPress={onClearSearch} variant="ghost" />
              </View>
            ) : null}
          </View>
          {searchError ? <ErrorText>{searchError}</ErrorText> : null}
          {searchResults.length > 0 ? (
            <View accessibilityLabel="Direct teammate matches" style={{ gap: space.s2, marginTop: space.s1 }}>
              {searchResults.map((member) => (
                <View
                  key={member.nodeRef}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.s3,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    padding: space.s3,
                    backgroundColor: colors.panel2,
                  }}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: alpha(colors.primary, 0.12),
                    }}
                  >
                    <Text style={{ color: colors.primary, fontSize: text.xs, fontWeight: '800' }}>{member.initials}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: text.sm, fontWeight: '700' }}>{member.displayName}</Text>
                    <MutedText size={text.xs}>{member.referralCode}</MutedText>
                  </View>
                  <Badge value={member.status} />
                </View>
              ))}
              {searchCursor ? (
                <Button
                  title={searching ? 'Searching...' : 'Load more direct teammates'}
                  busy={searching}
                  onPress={onLoadMoreSearch}
                  variant="ghost"
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s3, marginBottom: space.s3 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>Visible referral outline</Text>
            <MutedText size={text.xs}>
              {context.scope.loadedNodes} loaded / {context.scope.representedNodes} represented
            </MutedText>
          </View>
          <Badge value={context.scope.completeWithinVisibleDepth ? 'active' : 'pending'} />
        </View>
        <View style={{ padding: space.s3, borderRadius: radius.md, backgroundColor: colors.infoSubtle, marginBottom: space.s3 }}>
          <Text style={{ color: colors.primary, fontSize: text.sm, fontWeight: '700' }}>Protected visibility</Text>
          <Text style={{ color: colors.muted, fontSize: text.xs, marginTop: 3, lineHeight: 17 }}>
            Direct teammates are named. Deeper visible members use initials and summary bands only.
          </Text>
        </View>

        <View style={{ gap: space.s2 }}>
          <View
            style={{
              borderWidth: 1,
              borderColor: colors.primary,
              borderRadius: radius.md,
              padding: space.s3,
              backgroundColor: alpha(colors.primary, 0.08),
            }}
          >
            <Text style={{ color: colors.primary, fontSize: text.xs, fontWeight: '800' }}>YOU ARE HERE</Text>
            <Text style={{ color: colors.text, fontSize: text.md, fontWeight: '800', marginTop: 2 }}>{context.self.displayName}</Text>
            <MutedText size={text.xs}>
              {context.self.directCount} direct / {context.self.visibleDownlineCount} visible below
            </MutedText>
          </View>
          <View style={{ marginLeft: space.s3, paddingLeft: space.s3, borderLeftWidth: 1, borderLeftColor: colors.border, gap: space.s2 }}>
            {directChildren.length > 0 ? (
              directChildren.map((node) => (
                <NetworkNodeRow
                  key={memberNodeKey(node)}
                  node={node}
                  childrenByParent={childrenByParent}
                  expandedKeys={expandedKeys}
                  busyKeys={busyKeys}
                  onToggleNode={onToggleNode}
                  onLoadCluster={onLoadCluster}
                />
              ))
            ) : (
              <MutedText size={text.sm}>Invite your first teammate to begin this visible outline.</MutedText>
            )}
          </View>
        </View>

        {rootContinuation ? (
          <View style={{ marginTop: space.s3 }}>
            <Button
              title={busyKeys.has('root') ? 'Loading...' : 'Load more Tier 1 members'}
              busy={busyKeys.has('root')}
              onPress={() => onLoadContinuation('self', rootContinuation.parentRef, rootContinuation.cursor, 'root', 1)}
              variant="ghost"
            />
          </View>
        ) : null}
        {Object.entries(branchContinuations).map(([key, continuation]) => (
          <View key={key} style={{ marginTop: space.s2 }}>
            <Button
              title={busyKeys.has(key) ? 'Loading...' : `Load more Tier ${continuation.tier} members`}
              busy={busyKeys.has(key)}
              onPress={() => onLoadContinuation(key, continuation.parentRef, continuation.cursor, key, continuation.tier)}
              variant="ghost"
            />
          </View>
        ))}
      </Card>
    </>
  );
}
