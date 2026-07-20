import type {
  AdminHierarchyClusterNode,
  MemberAnonymousNode,
  MemberVisibleClusterNode,
  MemberPerformanceBand,
  NetworkHierarchyNode,
} from './types';

export interface NetworkHierarchyModel {
  readonly nodesByKey: ReadonlyMap<string, NetworkHierarchyNode>;
  readonly childrenByParent: ReadonlyMap<string | null, readonly string[]>;
  readonly parentByKey: ReadonlyMap<string, string | null>;
  readonly rootKeys: readonly string[];
}

export interface VisibleHierarchyRow {
  key: string;
  node: NetworkHierarchyNode;
  depth: number;
  parentKey: string | null;
  hasLoadedChildren: boolean;
  expandable: boolean;
  expanded: boolean;
}

export interface HierarchyNodePresentation {
  title: string;
  eyebrow: string;
  detail: string;
  performance: string | null;
  status: 'active' | 'inactive' | 'cluster';
}

export interface HierarchyPresentationOptions {
  /** Whether the current hierarchy lens may render any allowed performance facts. */
  showPerformance?: boolean;
  /** Exact financial amounts on admin member nodes are capability-gated. */
  viewFinancials?: boolean;
}

export function hierarchyNodeKey(node: NetworkHierarchyNode): string {
  switch (node.kind) {
    case 'member':
      return node.membershipId;
    case 'cluster':
      return `cluster:${node.clusterRef}`;
    case 'self':
      return node.nodeRef;
    case 'direct':
    case 'anonymous':
      return node.nodeRef;
  }
}

export function hierarchyParentKey(node: NetworkHierarchyNode): string | null {
  switch (node.kind) {
    case 'member':
      return node.parentMembershipId;
    case 'cluster':
      return 'parentMembershipId' in node ? node.parentMembershipId : node.parentRef;
    case 'self':
      return null;
    case 'direct':
    case 'anonymous':
      return node.parentRef;
  }
}

export function isTierThreeTerminal(node: NetworkHierarchyNode): boolean {
  return node.kind === 'anonymous' && node.localTier === 3;
}

export function isHierarchyNodeExpandable(node: NetworkHierarchyNode, hasLoadedChildren = false): boolean {
  if (isTierThreeTerminal(node)) return false;
  if (node.kind === 'self') return hasLoadedChildren || node.directCount > 0;
  return node.canExpand;
}

export function buildNetworkHierarchyModel(nodes: readonly NetworkHierarchyNode[]): NetworkHierarchyModel {
  const nodesByKey = new Map<string, NetworkHierarchyNode>();
  const parentByKey = new Map<string, string | null>();
  const childrenByParent = new Map<string | null, string[]>();

  for (const node of nodes) {
    const key = hierarchyNodeKey(node);
    if (nodesByKey.has(key)) throw new TypeError(`Duplicate hierarchy node key: ${key}`);
    nodesByKey.set(key, node);
    parentByKey.set(key, hierarchyParentKey(node));
  }

  for (const [key, parentKey] of parentByKey) {
    const parent = parentKey ? nodesByKey.get(parentKey) : undefined;
    if (parent && isTierThreeTerminal(parent)) {
      throw new TypeError('Tier 3 member nodes are terminal and cannot own children');
    }
    const normalizedParent = parentKey && nodesByKey.has(parentKey) ? parentKey : null;
    const children = childrenByParent.get(normalizedParent);
    if (children) children.push(key);
    else childrenByParent.set(normalizedParent, [key]);
  }

  return {
    nodesByKey,
    childrenByParent,
    parentByKey,
    rootKeys: childrenByParent.get(null) ?? [],
  };
}

export function flattenVisibleHierarchy(
  model: NetworkHierarchyModel,
  expandedKeys: ReadonlySet<string>,
): VisibleHierarchyRow[] {
  const rows: VisibleHierarchyRow[] = [];
  const visited = new Set<string>();

  const visit = (key: string, depth: number, parentKey: string | null) => {
    if (visited.has(key)) throw new TypeError(`Hierarchy cycle detected at ${key}`);
    visited.add(key);
    const node = model.nodesByKey.get(key);
    if (!node) return;
    const children = model.childrenByParent.get(key) ?? [];
    const expandable = isHierarchyNodeExpandable(node, children.length > 0);
    const expanded = expandable && expandedKeys.has(key);
    rows.push({
      key,
      node,
      depth,
      parentKey,
      hasLoadedChildren: children.length > 0,
      expandable,
      expanded,
    });
    if (expanded) {
      for (const childKey of children) visit(childKey, depth + 1, key);
    }
  };

  for (const rootKey of model.rootKeys) visit(rootKey, 0, null);
  return rows;
}

export function exactTierClusterLabel(representedNodes: number, localTier: number): string {
  const count = Number.isSafeInteger(representedNodes) && representedNodes > 0 ? representedNodes : 0;
  const tier = Number.isSafeInteger(localTier) && localTier > 0 ? localTier : 1;
  return `+${count} Tier ${tier} ${count === 1 ? 'member' : 'members'}`;
}

export function displayClusterLabel(node: AdminHierarchyClusterNode | MemberVisibleClusterNode): string {
  return exactTierClusterLabel(node.representedNodes, node.localTier);
}

export function performanceBandLabel(band: MemberPerformanceBand): string {
  if (band.suppressed) return band.reason === 'smallCohort' ? 'Not enough data' : 'No performance data';
  type VisiblePerformanceBand = Extract<MemberPerformanceBand, { suppressed: false }>;
  const volume: Record<VisiblePerformanceBand['volumeBand'], string> = {
    none: 'No volume',
    under1k: 'Under 1k volume',
    '1k-5k': '1k–5k volume',
    '5k-10k': '5k–10k volume',
    '10k+': '10k+ volume',
  };
  return `${band.approvedSalesBand} approved sales · ${volume[band.volumeBand]}`;
}

export function formatHierarchyMoney(cents: string | number | bigint | null | undefined, currency = 'USD'): string {
  let raw: string;
  if (typeof cents === 'bigint') raw = cents.toString();
  else if (typeof cents === 'number' && Number.isSafeInteger(cents)) raw = String(cents);
  else if (typeof cents === 'string' && /^-?\d+$/.test(cents.trim())) raw = cents.trim();
  else return 'Not available';

  const negative = raw.startsWith('-');
  const absolute = (negative ? raw.slice(1) : raw).replace(/^0+(?=\d)/, '') || '0';
  const whole = absolute.length > 2 ? absolute.slice(0, -2) : '0';
  const fraction = absolute.slice(-2).padStart(2, '0');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  try {
    const rendered = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .formatToParts(0)
      .map((part) => (part.type === 'integer' ? grouped : part.type === 'fraction' ? fraction : part.value))
      .join('');
    return negative ? `-${rendered}` : rendered;
  } catch {
    return `${negative ? '-' : ''}${currency} ${grouped}.${fraction}`;
  }
}

export function hierarchyNodePresentation(
  node: NetworkHierarchyNode,
  { showPerformance = true, viewFinancials = false }: HierarchyPresentationOptions = {},
): HierarchyNodePresentation {
  switch (node.kind) {
    case 'cluster':
      return {
        title: displayClusterLabel(node),
        eyebrow: `Tier ${node.localTier} cluster`,
        detail: 'Open this group to load the represented branch members.',
        performance: null,
        status: 'cluster',
      };
    case 'member':
      return {
        title: node.displayName,
        eyebrow: `Local Tier ${node.localTier} · Global Tier ${node.globalTier}`,
        detail: `${node.referralCode} · ${node.directCount} direct · ${node.subtreeCount} in subtree`,
        performance:
          showPerformance && viewFinancials && node.performance
            ? `${node.performance.approvedSales} approved · ${formatHierarchyMoney(node.performance.teamVolumeCents, node.performance.currency)} team volume`
            : null,
        status: node.status,
      };
    case 'self':
      return {
        title: node.displayName,
        eyebrow: 'You',
        detail: `${node.referralCode} · ${node.directCount} direct · ${node.visibleDownlineCount} visible`,
        performance: showPerformance && node.performance
          ? `${node.performance.visibleApprovedSales} approved · ${formatHierarchyMoney(node.performance.visibleTeamVolumeCents, node.performance.currency)} visible volume`
          : null,
        status: node.status,
      };
    case 'direct':
      return {
        title: node.displayName,
        eyebrow: 'Tier 1 member',
        detail: `${node.referralCode} · ${node.visibleDirectCount} visible direct · ${node.visibleBranchCount} visible branch`,
        performance: showPerformance && node.performance
          ? `${node.performance.approvedSales} approved · ${formatHierarchyMoney(node.performance.visibleBranchVolumeCents, node.performance.currency)} visible branch volume`
          : null,
        status: node.status,
      };
    case 'anonymous':
      return {
        title: `${node.initials} · ${node.label}`,
        eyebrow: `Tier ${node.localTier} · Anonymous`,
        detail: node.localTier === 3 ? 'Visible-depth limit' : `${node.visibleChildCount ?? 0} visible children`,
        performance: showPerformance ? performanceBandLabel(node.performanceBand) : null,
        status: node.status,
      };
  }
}

export function isAnonymousMemberNode(node: NetworkHierarchyNode): node is MemberAnonymousNode {
  return node.kind === 'anonymous';
}
