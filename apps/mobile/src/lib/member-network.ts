export type NetworkStatus = 'active' | 'inactive';
export type OpaqueReference = string & { readonly __opaqueMemberReference: unique symbol };

export interface SponsorNode {
  kind: 'sponsor';
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
}

export interface SelfNode {
  kind: 'self';
  nodeRef: 'self';
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
  directCount: number;
  visibleDownlineCount: number;
}

export interface DirectNode {
  kind: 'direct';
  nodeRef: OpaqueReference;
  parentRef: 'self';
  localTier: 1;
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
  visibleDirectCount: number;
  visibleBranchCount: number;
  canExpand: boolean;
  performance: { approvedSales: number };
}

export type PerformanceBand =
  | { suppressed: true; reason: 'smallCohort' | 'noData' }
  | {
      suppressed: false;
      approvedSalesBand: '0' | '1-4' | '5-9' | '10+';
      volumeBand: 'none' | 'under1k' | '1k-5k' | '5k-10k' | '10k+';
    };

export interface AnonymousTierTwo {
  kind: 'anonymous';
  nodeRef: OpaqueReference;
  parentRef: OpaqueReference;
  localTier: 2;
  initials: string;
  label: 'Tier 2 member';
  status: NetworkStatus;
  visibleChildCount: number;
  canExpand: boolean;
  performanceBand: PerformanceBand;
}

export interface AnonymousTierThree {
  kind: 'anonymous';
  nodeRef: OpaqueReference;
  parentRef: OpaqueReference;
  localTier: 3;
  initials: string;
  label: 'Tier 3 member';
  status: NetworkStatus;
  canExpand: false;
  performanceBand: PerformanceBand;
}

export interface ClusterNode {
  kind: 'cluster';
  clusterRef: OpaqueReference;
  parentRef: OpaqueReference;
  localTier: 2 | 3;
  label: 'Tier 2 members' | 'Tier 3 members';
  representedNodes: number;
  canExpand: true;
}

export type VisibleNode = DirectNode | AnonymousTierTwo | AnonymousTierThree | ClusterNode;

export interface BranchPage {
  parentRef: OpaqueReference;
  items: VisibleNode[];
  representedNodes: number;
  nextCursor: OpaqueReference | null;
  snapshotAt: string;
}

export interface NetworkContext {
  sponsor: SponsorNode | null;
  self: SelfNode;
  initialPage: BranchPage;
  scope: {
    maxVisibleTier: 3;
    loadedNodes: number;
    representedNodes: number;
    completeWithinVisibleDepth: boolean;
    snapshotAt: string;
  };
}

export class MemberNetworkPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberNetworkPayloadError';
  }
}

type JsonRecord = Record<string, unknown>;

const OPAQUE_REFERENCE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const UPPER_INITIALS = /^\p{Lu}{2}$/u;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const INTEGER_CENTS = /^-?\d+$/;
const FORBIDDEN_ANONYMOUS = new Set([
  'id',
  'membershipId',
  'userId',
  'displayName',
  'fullName',
  'email',
  'referralCode',
  'performance',
  'amountCents',
  'teamVolumeCents',
  'visibleBranchVolumeCents',
  'commission',
  'commissionCents',
  'balance',
]);

function invalid(path: string): never {
  throw new MemberNetworkPayloadError(`Invalid protected network response at ${path}.`);
}

function object(value: unknown, path: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path);
  return value as JsonRecord;
}

function only(value: JsonRecord, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid(path);
}

function requiredString(value: unknown, path: string, maxLength = 180): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) invalid(path);
  return value;
}

function safeCount(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0) invalid(path);
  return value;
}

function safeBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path);
  return value;
}

function status(value: unknown, path: string): NetworkStatus {
  if (value !== 'active' && value !== 'inactive') invalid(path);
  return value;
}

/**
 * React Native runtimes do not universally provide atob/btoa. The server
 * authorizes signed references; the client still checks their safe, opaque
 * envelope and additionally checks canonical encoding whenever codecs exist.
 */
function canonicalBase64Url(value: string): boolean {
  if (value.length === 0 || value.length % 4 === 1) return false;
  const decode = globalThis.atob;
  const encode = globalThis.btoa;
  if (typeof decode !== 'function' || typeof encode !== 'function') return true;

  try {
    const encoded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const decoded = decode(encoded);
    return encode(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === value;
  } catch {
    return false;
  }
}

function opaque(value: unknown, path: string): OpaqueReference {
  if (typeof value !== 'string' || value.length > 2048 || !OPAQUE_REFERENCE.test(value)) invalid(path);
  const [payload, signature] = value.split('.');
  if (!canonicalBase64Url(payload) || !canonicalBase64Url(signature)) invalid(path);
  return value as OpaqueReference;
}

function snapshot(value: unknown, path: string): string {
  const result = requiredString(value, path, 40);
  const milliseconds = Date.parse(result);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== result) invalid(path);
  return result;
}

function performanceBand(value: unknown, path: string): PerformanceBand {
  const candidate = object(value, path);
  if (candidate.suppressed === true) {
    only(candidate, ['suppressed', 'reason'], path);
    if (candidate.reason !== 'smallCohort' && candidate.reason !== 'noData') invalid(path);
    return { suppressed: true, reason: candidate.reason };
  }

  only(candidate, ['suppressed', 'approvedSalesBand', 'volumeBand'], path);
  if (candidate.suppressed !== false || !['0', '1-4', '5-9', '10+'].includes(candidate.approvedSalesBand as string)) invalid(path);
  if (!['none', 'under1k', '1k-5k', '5k-10k', '10k+'].includes(candidate.volumeBand as string)) invalid(path);
  return {
    suppressed: false,
    approvedSalesBand: candidate.approvedSalesBand as Extract<PerformanceBand, { suppressed: false }>['approvedSalesBand'],
    volumeBand: candidate.volumeBand as Extract<PerformanceBand, { suppressed: false }>['volumeBand'],
  };
}

function anonymousInitials(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.normalize('NFC') !== value || !UPPER_INITIALS.test(value)) invalid(path);
  return value;
}

export function parseMemberVisibleNode(value: unknown, path: string): VisibleNode {
  const candidate = object(value, path);
  if (candidate.kind === 'direct') {
    only(
      candidate,
      ['kind', 'nodeRef', 'parentRef', 'localTier', 'displayName', 'initials', 'referralCode', 'status', 'visibleDirectCount', 'visibleBranchCount', 'canExpand', 'performance'],
      path,
    );
    if (candidate.parentRef !== 'self' || candidate.localTier !== 1) invalid(path);
    const performance = object(candidate.performance, `${path}.performance`);
    only(performance, ['currency', 'period', 'approvedSales', 'visibleBranchVolumeCents'], `${path}.performance`);
    if (!INTEGER_CENTS.test(requiredString(performance.visibleBranchVolumeCents, `${path}.performance.visibleBranchVolumeCents`, 64))) invalid(path);
    return {
      kind: 'direct',
      nodeRef: opaque(candidate.nodeRef, `${path}.nodeRef`),
      parentRef: 'self',
      localTier: 1,
      displayName: requiredString(candidate.displayName, `${path}.displayName`),
      initials: requiredString(candidate.initials, `${path}.initials`, 12),
      referralCode: requiredString(candidate.referralCode, `${path}.referralCode`, 80),
      status: status(candidate.status, `${path}.status`),
      visibleDirectCount: safeCount(candidate.visibleDirectCount, `${path}.visibleDirectCount`),
      visibleBranchCount: safeCount(candidate.visibleBranchCount, `${path}.visibleBranchCount`),
      canExpand: safeBoolean(candidate.canExpand, `${path}.canExpand`),
      performance: { approvedSales: safeCount(performance.approvedSales, `${path}.performance.approvedSales`) },
    };
  }

  if (candidate.kind === 'anonymous') {
    if (Object.keys(candidate).some((key) => FORBIDDEN_ANONYMOUS.has(key))) invalid(path);
    if (candidate.localTier === 2) {
      only(candidate, ['kind', 'nodeRef', 'parentRef', 'localTier', 'initials', 'label', 'status', 'visibleChildCount', 'canExpand', 'performanceBand'], path);
      if (candidate.label !== 'Tier 2 member') invalid(path);
      return {
        kind: 'anonymous',
        nodeRef: opaque(candidate.nodeRef, `${path}.nodeRef`),
        parentRef: opaque(candidate.parentRef, `${path}.parentRef`),
        localTier: 2,
        initials: anonymousInitials(candidate.initials, `${path}.initials`),
        label: 'Tier 2 member',
        status: status(candidate.status, `${path}.status`),
        visibleChildCount: safeCount(candidate.visibleChildCount, `${path}.visibleChildCount`),
        canExpand: safeBoolean(candidate.canExpand, `${path}.canExpand`),
        performanceBand: performanceBand(candidate.performanceBand, `${path}.performanceBand`),
      };
    }
    if (candidate.localTier === 3) {
      only(candidate, ['kind', 'nodeRef', 'parentRef', 'localTier', 'initials', 'label', 'status', 'canExpand', 'performanceBand'], path);
      if (candidate.label !== 'Tier 3 member' || candidate.canExpand !== false) invalid(path);
      return {
        kind: 'anonymous',
        nodeRef: opaque(candidate.nodeRef, `${path}.nodeRef`),
        parentRef: opaque(candidate.parentRef, `${path}.parentRef`),
        localTier: 3,
        initials: anonymousInitials(candidate.initials, `${path}.initials`),
        label: 'Tier 3 member',
        status: status(candidate.status, `${path}.status`),
        canExpand: false,
        performanceBand: performanceBand(candidate.performanceBand, `${path}.performanceBand`),
      };
    }
    invalid(path);
  }

  if (candidate.kind === 'cluster') {
    only(candidate, ['kind', 'clusterRef', 'parentRef', 'localTier', 'label', 'representedNodes', 'canExpand'], path);
    const localTier = candidate.localTier;
    if (localTier !== 2 && localTier !== 3) invalid(path);
    const label = localTier === 2 ? 'Tier 2 members' : 'Tier 3 members';
    if (candidate.label !== label || candidate.canExpand !== true) invalid(path);
    return {
      kind: 'cluster',
      clusterRef: opaque(candidate.clusterRef, `${path}.clusterRef`),
      parentRef: opaque(candidate.parentRef, `${path}.parentRef`),
      localTier,
      label,
      representedNodes: safeCount(candidate.representedNodes, `${path}.representedNodes`),
      canExpand: true,
    };
  }

  invalid(path);
}

function parsePage(value: unknown, path: string, expectedSnapshot?: string): BranchPage {
  const candidate = object(value, path);
  only(candidate, ['parentRef', 'items', 'representedNodes', 'nextCursor', 'snapshotAt'], path);
  if (!Array.isArray(candidate.items)) invalid(`${path}.items`);
  const pageSnapshot = snapshot(candidate.snapshotAt, `${path}.snapshotAt`);
  if (expectedSnapshot && expectedSnapshot !== pageSnapshot) invalid(`${path}.snapshotAt`);
  return {
    parentRef: opaque(candidate.parentRef, `${path}.parentRef`),
    items: candidate.items.map((item, index) => parseMemberVisibleNode(item, `${path}.items[${index}]`)),
    representedNodes: safeCount(candidate.representedNodes, `${path}.representedNodes`),
    nextCursor: candidate.nextCursor === null ? null : opaque(candidate.nextCursor, `${path}.nextCursor`),
    snapshotAt: pageSnapshot,
  };
}

export function parseMemberNetworkContext(value: unknown): NetworkContext {
  const candidate = object(value, 'context');
  only(candidate, ['sponsor', 'self', 'initialPage', 'scope'], 'context');
  const rawSelf = object(candidate.self, 'self');
  only(rawSelf, ['kind', 'nodeRef', 'displayName', 'initials', 'referralCode', 'status', 'directCount', 'visibleDownlineCount', 'performance'], 'self');
  if (rawSelf.kind !== 'self' || rawSelf.nodeRef !== 'self') invalid('self');
  const selfPerformance = object(rawSelf.performance, 'self.performance');
  only(selfPerformance, ['currency', 'period', 'visibleApprovedSales', 'visibleTeamVolumeCents'], 'self.performance');
  requiredString(selfPerformance.currency, 'self.performance.currency', 8);
  if (!ISO_MONTH.test(requiredString(selfPerformance.period, 'self.performance.period', 7))) invalid('self.performance.period');
  safeCount(selfPerformance.visibleApprovedSales, 'self.performance.visibleApprovedSales');
  if (!INTEGER_CENTS.test(requiredString(selfPerformance.visibleTeamVolumeCents, 'self.performance.visibleTeamVolumeCents', 64))) {
    invalid('self.performance.visibleTeamVolumeCents');
  }
  const rawSponsor = candidate.sponsor === null ? null : object(candidate.sponsor, 'sponsor');
  if (rawSponsor) only(rawSponsor, ['kind', 'displayName', 'initials', 'referralCode', 'status'], 'sponsor');
  if (rawSponsor && rawSponsor.kind !== 'sponsor') invalid('sponsor');
  const initialPage = parsePage(candidate.initialPage, 'initialPage');
  const rawScope = object(candidate.scope, 'scope');
  only(rawScope, ['maxVisibleTier', 'loadedNodes', 'representedNodes', 'completeWithinVisibleDepth', 'snapshotAt', 'structuralCountsCoverage', 'metricsCoverage'], 'scope');
  if (rawScope.maxVisibleTier !== 3 || snapshot(rawScope.snapshotAt, 'scope.snapshotAt') !== initialPage.snapshotAt) invalid('scope');
  if (rawScope.structuralCountsCoverage !== 'visibleTiersExact' || (rawScope.metricsCoverage !== 'visibleTiersExact' && rawScope.metricsCoverage !== 'loadedWindow')) invalid('scope');
  return {
    sponsor: rawSponsor
      ? {
          kind: 'sponsor',
          displayName: requiredString(rawSponsor.displayName, 'sponsor.displayName'),
          initials: requiredString(rawSponsor.initials, 'sponsor.initials', 12),
          referralCode: requiredString(rawSponsor.referralCode, 'sponsor.referralCode', 80),
          status: status(rawSponsor.status, 'sponsor.status'),
        }
      : null,
    self: {
      kind: 'self',
      nodeRef: 'self',
      displayName: requiredString(rawSelf.displayName, 'self.displayName'),
      initials: requiredString(rawSelf.initials, 'self.initials', 12),
      referralCode: requiredString(rawSelf.referralCode, 'self.referralCode', 80),
      status: status(rawSelf.status, 'self.status'),
      directCount: safeCount(rawSelf.directCount, 'self.directCount'),
      visibleDownlineCount: safeCount(rawSelf.visibleDownlineCount, 'self.visibleDownlineCount'),
    },
    initialPage,
    scope: {
      maxVisibleTier: 3,
      loadedNodes: safeCount(rawScope.loadedNodes, 'scope.loadedNodes'),
      representedNodes: safeCount(rawScope.representedNodes, 'scope.representedNodes'),
      completeWithinVisibleDepth: safeBoolean(rawScope.completeWithinVisibleDepth, 'scope.completeWithinVisibleDepth'),
      snapshotAt: initialPage.snapshotAt,
    },
  };
}

export function parseMemberBranchPage(value: unknown, expectedSnapshot: string): BranchPage {
  return parsePage(value, 'branch', expectedSnapshot);
}

export function memberNodeKey(node: VisibleNode | SelfNode): string {
  if (node.kind === 'self') return 'self';
  return node.kind === 'cluster' ? `cluster:${node.clusterRef}` : node.nodeRef;
}

export function memberParentKey(node: VisibleNode): string {
  return node.kind === 'direct' ? 'self' : node.parentRef;
}

export function mergeMemberVisibleNodes(
  current: readonly VisibleNode[],
  incoming: readonly VisibleNode[],
  removeKey?: string,
): VisibleNode[] {
  const merged = new Map<string, VisibleNode>();
  for (const node of current) {
    if (memberNodeKey(node) !== removeKey) merged.set(memberNodeKey(node), node);
  }
  for (const node of incoming) merged.set(memberNodeKey(node), node);
  return [...merged.values()];
}
