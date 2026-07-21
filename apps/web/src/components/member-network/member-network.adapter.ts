import {
  parseAnonymousMemberInitials,
  parseOpaqueMemberNodeRef,
} from '../network-hierarchy/types';
import type {
  MemberAnonymousNode,
  MemberDirectNode,
  MemberNetworkContext,
  MemberNetworkScope,
  MemberPerformanceBand,
  MemberSelfNode,
  MemberSponsorNode,
  MemberVisibleClusterNode,
  MemberVisibleNode,
  NetworkStatus,
  OpaqueMemberNodeRef,
} from '../network-hierarchy/types';

type UnknownRecord = Record<string, unknown>;

const MEMBER_STATUSES = new Set<NetworkStatus>(['active', 'inactive']);
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const INTEGER_CENTS = /^-?\d+$/;
const FORBIDDEN_ANONYMOUS_FIELDS = new Set([
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

export class MemberNetworkPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberNetworkPayloadError';
  }
}

/** A cursor page from a newer search snapshot must never be merged with the first page. */
export class MemberNetworkSnapshotMismatchError extends MemberNetworkPayloadError {
  constructor() {
    super('The protected network search snapshot changed.');
    this.name = 'MemberNetworkSnapshotMismatchError';
  }
}

/** A runtime-validated branch keeps signed refs branded through the UI boundary. */
export interface MemberBranchPage<TNode extends MemberVisibleNode = MemberVisibleNode> {
  parentRef: OpaqueMemberNodeRef;
  items: TNode[];
  representedNodes: number;
  nextCursor: OpaqueMemberNodeRef | null;
  snapshotAt: string;
}

export interface MemberNetworkContextPayload extends Omit<MemberNetworkContext, 'initialPage'> {
  initialPage: MemberBranchPage;
}

export interface MemberDirectSearchPagePayload {
  items: MemberDirectNode[];
  nextCursor: OpaqueMemberNodeRef | null;
  snapshotAt: string;
}

function fail(path: string, message: string): never {
  throw new MemberNetworkPayloadError(`${path}: ${message}`);
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'expected an object');
  return value as UnknownRecord;
}

function exactlyKeys(value: UnknownRecord, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(path, `contains forbidden field ${key}`);
  }
}

function string(value: unknown, path: string, maxLength = 180): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) fail(path, 'expected a bounded non-empty string');
  return value;
}

function count(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(path, 'expected a non-negative safe integer');
  return value as number;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
  return value;
}

function status(value: unknown, path: string): NetworkStatus {
  if (typeof value !== 'string' || !MEMBER_STATUSES.has(value as NetworkStatus)) fail(path, 'expected an allowed member status');
  return value as NetworkStatus;
}

function opaqueReference(value: unknown, path: string): OpaqueMemberNodeRef {
  if (typeof value !== 'string') fail(path, 'expected an opaque member node reference');
  try {
    return parseOpaqueMemberNodeRef(value);
  } catch {
    fail(path, 'expected an opaque member node reference');
  }
}

function canonicalSnapshot(value: unknown, path: string): string {
  const snapshotAt = string(value, path, 40);
  const milliseconds = Date.parse(snapshotAt);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== snapshotAt) {
    fail(path, 'expected a canonical snapshot timestamp');
  }
  return snapshotAt;
}

function cents(value: unknown, path: string): string {
  const result = string(value, path, 64);
  if (!INTEGER_CENTS.test(result)) fail(path, 'expected integer cents');
  return result;
}

function performanceBand(value: unknown, path: string): MemberPerformanceBand {
  const candidate = record(value, path);
  if (candidate.suppressed === true) {
    exactlyKeys(candidate, ['suppressed', 'reason'], path);
    if (candidate.reason !== 'smallCohort' && candidate.reason !== 'noData') fail(`${path}.reason`, 'expected a suppression reason');
    return { suppressed: true, reason: candidate.reason };
  }
  exactlyKeys(candidate, ['suppressed', 'approvedSalesBand', 'volumeBand'], path);
  if (candidate.suppressed !== false) fail(`${path}.suppressed`, 'expected false');
  if (!['0', '1-4', '5-9', '10+'].includes(candidate.approvedSalesBand as string)) {
    fail(`${path}.approvedSalesBand`, 'expected an approved-sales band');
  }
  if (!['none', 'under1k', '1k-5k', '5k-10k', '10k+'].includes(candidate.volumeBand as string)) {
    fail(`${path}.volumeBand`, 'expected a volume band');
  }
  return {
    suppressed: false,
    approvedSalesBand: candidate.approvedSalesBand as Extract<MemberPerformanceBand, { suppressed: false }>['approvedSalesBand'],
    volumeBand: candidate.volumeBand as Extract<MemberPerformanceBand, { suppressed: false }>['volumeBand'],
  };
}

function sponsor(value: unknown): MemberSponsorNode | null {
  if (value === null) return null;
  const candidate = record(value, 'sponsor');
  exactlyKeys(candidate, ['kind', 'displayName', 'initials', 'referralCode', 'status'], 'sponsor');
  if (candidate.kind !== 'sponsor') fail('sponsor.kind', 'expected sponsor');
  return {
    kind: 'sponsor',
    displayName: string(candidate.displayName, 'sponsor.displayName'),
    initials: string(candidate.initials, 'sponsor.initials', 12),
    referralCode: string(candidate.referralCode, 'sponsor.referralCode', 80),
    status: status(candidate.status, 'sponsor.status'),
  };
}

function self(value: unknown): MemberSelfNode {
  const candidate = record(value, 'self');
  exactlyKeys(
    candidate,
    ['kind', 'nodeRef', 'displayName', 'initials', 'referralCode', 'status', 'directCount', 'visibleDownlineCount', 'performance'],
    'self',
  );
  if (candidate.kind !== 'self' || candidate.nodeRef !== 'self') fail('self', 'expected self root');
  const rawPerformance = record(candidate.performance, 'self.performance');
  exactlyKeys(rawPerformance, ['currency', 'period', 'visibleApprovedSales', 'visibleTeamVolumeCents'], 'self.performance');
  return {
    kind: 'self',
    nodeRef: 'self',
    displayName: string(candidate.displayName, 'self.displayName'),
    initials: string(candidate.initials, 'self.initials', 12),
    referralCode: string(candidate.referralCode, 'self.referralCode', 80),
    status: status(candidate.status, 'self.status'),
    directCount: count(candidate.directCount, 'self.directCount'),
    visibleDownlineCount: count(candidate.visibleDownlineCount, 'self.visibleDownlineCount'),
    performance: {
      currency: string(rawPerformance.currency, 'self.performance.currency', 8),
      period: string(rawPerformance.period, 'self.performance.period', 7),
      visibleApprovedSales: count(rawPerformance.visibleApprovedSales, 'self.performance.visibleApprovedSales'),
      visibleTeamVolumeCents: cents(rawPerformance.visibleTeamVolumeCents, 'self.performance.visibleTeamVolumeCents'),
    },
  };
}

function direct(value: UnknownRecord, path: string): MemberDirectNode {
  exactlyKeys(
    value,
    [
      'kind',
      'nodeRef',
      'parentRef',
      'localTier',
      'displayName',
      'initials',
      'referralCode',
      'status',
      'visibleDirectCount',
      'visibleBranchCount',
      'canExpand',
      'performance',
    ],
    path,
  );
  if (value.parentRef !== 'self' || value.localTier !== 1) fail(path, 'Tier 1 direct nodes must be children of self');
  const rawPerformance = record(value.performance, `${path}.performance`);
  exactlyKeys(rawPerformance, ['currency', 'period', 'approvedSales', 'visibleBranchVolumeCents'], `${path}.performance`);
  const period = string(rawPerformance.period, `${path}.performance.period`, 7);
  if (!ISO_MONTH.test(period)) fail(`${path}.performance.period`, 'expected YYYY-MM');
  return {
    kind: 'direct',
    nodeRef: opaqueReference(value.nodeRef, `${path}.nodeRef`),
    parentRef: 'self',
    localTier: 1,
    displayName: string(value.displayName, `${path}.displayName`),
    initials: string(value.initials, `${path}.initials`, 12),
    referralCode: string(value.referralCode, `${path}.referralCode`, 80),
    status: status(value.status, `${path}.status`),
    visibleDirectCount: count(value.visibleDirectCount, `${path}.visibleDirectCount`),
    visibleBranchCount: count(value.visibleBranchCount, `${path}.visibleBranchCount`),
    canExpand: boolean(value.canExpand, `${path}.canExpand`),
    performance: {
      currency: string(rawPerformance.currency, `${path}.performance.currency`, 8),
      period,
      approvedSales: count(rawPerformance.approvedSales, `${path}.performance.approvedSales`),
      visibleBranchVolumeCents: cents(rawPerformance.visibleBranchVolumeCents, `${path}.performance.visibleBranchVolumeCents`),
    },
  };
}

function anonymous(value: UnknownRecord, path: string): MemberAnonymousNode {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_ANONYMOUS_FIELDS.has(key)) fail(path, `anonymous node contains forbidden field ${key}`);
  }
  const tier = value.localTier;
  if (tier === 2) {
    exactlyKeys(value, ['kind', 'nodeRef', 'parentRef', 'initials', 'status', 'performanceBand', 'localTier', 'label', 'visibleChildCount', 'canExpand'], path);
    if (value.label !== 'Tier 2 member') fail(`${path}.label`, 'expected Tier 2 member');
    return {
      kind: 'anonymous',
      nodeRef: opaqueReference(value.nodeRef, `${path}.nodeRef`),
      parentRef: opaqueReference(value.parentRef, `${path}.parentRef`),
      initials: parseAnonymousInitials(value.initials, `${path}.initials`),
      status: status(value.status, `${path}.status`),
      performanceBand: performanceBand(value.performanceBand, `${path}.performanceBand`),
      localTier: 2,
      label: 'Tier 2 member',
      visibleChildCount: count(value.visibleChildCount, `${path}.visibleChildCount`),
      canExpand: boolean(value.canExpand, `${path}.canExpand`),
    };
  }
  if (tier === 3) {
    exactlyKeys(value, ['kind', 'nodeRef', 'parentRef', 'initials', 'status', 'performanceBand', 'localTier', 'label', 'canExpand'], path);
    if (value.label !== 'Tier 3 member') fail(`${path}.label`, 'expected Tier 3 member');
    if (value.canExpand !== false) fail(path, 'Tier 3 must be terminal');
    return {
      kind: 'anonymous',
      nodeRef: opaqueReference(value.nodeRef, `${path}.nodeRef`),
      parentRef: opaqueReference(value.parentRef, `${path}.parentRef`),
      initials: parseAnonymousInitials(value.initials, `${path}.initials`),
      status: status(value.status, `${path}.status`),
      performanceBand: performanceBand(value.performanceBand, `${path}.performanceBand`),
      localTier: 3,
      label: 'Tier 3 member',
      canExpand: false,
    };
  }
  fail(`${path}.localTier`, 'expected local tier 2 or 3');
}

function parseAnonymousInitials(value: unknown, path: string) {
  if (typeof value !== 'string') fail(path, 'expected anonymous initials');
  try {
    return parseAnonymousMemberInitials(value);
  } catch {
    fail(path, 'expected anonymous initials');
  }
}

function cluster(value: UnknownRecord, path: string): MemberVisibleClusterNode {
  exactlyKeys(value, ['kind', 'clusterRef', 'parentRef', 'localTier', 'label', 'representedNodes', 'canExpand'], path);
  const tier = value.localTier;
  if (tier !== 2 && tier !== 3) fail(`${path}.localTier`, 'expected local tier 2 or 3');
  const expectedLabel = tier === 2 ? 'Tier 2 members' : 'Tier 3 members';
  if (value.label !== expectedLabel) fail(`${path}.label`, `expected ${expectedLabel}`);
  if (value.canExpand !== true) fail(`${path}.canExpand`, 'expected true');
  return {
    kind: 'cluster',
    clusterRef: opaqueReference(value.clusterRef, `${path}.clusterRef`),
    parentRef: opaqueReference(value.parentRef, `${path}.parentRef`),
    localTier: tier,
    label: expectedLabel,
    representedNodes: count(value.representedNodes, `${path}.representedNodes`),
    canExpand: true,
  };
}

export function parseMemberVisibleNode(value: unknown, path = 'node'): MemberVisibleNode {
  const candidate = record(value, path);
  if (candidate.kind === 'direct') return direct(candidate, path);
  if (candidate.kind === 'anonymous') return anonymous(candidate, path);
  if (candidate.kind === 'cluster') return cluster(candidate, path);
  fail(`${path}.kind`, 'expected direct, anonymous, or cluster node');
}

function page(value: unknown, path: string, expectedSnapshotAt?: string): MemberBranchPage {
  const candidate = record(value, path);
  exactlyKeys(candidate, ['parentRef', 'items', 'representedNodes', 'nextCursor', 'snapshotAt'], path);
  if (!Array.isArray(candidate.items)) fail(`${path}.items`, 'expected an array');
  const snapshotAt = canonicalSnapshot(candidate.snapshotAt, `${path}.snapshotAt`);
  if (expectedSnapshotAt && snapshotAt !== expectedSnapshotAt) fail(`${path}.snapshotAt`, 'must match the active snapshot');
  return {
    parentRef: opaqueReference(candidate.parentRef, `${path}.parentRef`),
    items: candidate.items.map((item, index) => parseMemberVisibleNode(item, `${path}.items[${index}]`)),
    representedNodes: count(candidate.representedNodes, `${path}.representedNodes`),
    nextCursor: optionalCursor(candidate.nextCursor, `${path}.nextCursor`),
    snapshotAt,
  };
}

function optionalCursor(value: unknown, path: string): OpaqueMemberNodeRef | null {
  if (value === null) return null;
  return opaqueReference(value, path);
}

function scope(value: unknown, snapshotAt: string): MemberNetworkScope {
  const candidate = record(value, 'scope');
  exactlyKeys(
    candidate,
    ['maxVisibleTier', 'loadedNodes', 'representedNodes', 'completeWithinVisibleDepth', 'snapshotAt', 'structuralCountsCoverage', 'metricsCoverage'],
    'scope',
  );
  if (candidate.maxVisibleTier !== 3) fail('scope.maxVisibleTier', 'expected local depth 3');
  if (canonicalSnapshot(candidate.snapshotAt, 'scope.snapshotAt') !== snapshotAt) fail('scope.snapshotAt', 'must match the active snapshot');
  if (candidate.structuralCountsCoverage !== 'visibleTiersExact') fail('scope.structuralCountsCoverage', 'expected visible-tier coverage');
  if (candidate.metricsCoverage !== 'visibleTiersExact' && candidate.metricsCoverage !== 'loadedWindow') {
    fail('scope.metricsCoverage', 'expected an allowed coverage label');
  }
  return {
    maxVisibleTier: 3,
    loadedNodes: count(candidate.loadedNodes, 'scope.loadedNodes'),
    representedNodes: count(candidate.representedNodes, 'scope.representedNodes'),
    completeWithinVisibleDepth: boolean(candidate.completeWithinVisibleDepth, 'scope.completeWithinVisibleDepth'),
    snapshotAt,
    structuralCountsCoverage: 'visibleTiersExact',
    metricsCoverage: candidate.metricsCoverage,
  };
}

/** Decode untrusted member hierarchy JSON before it can reach a component tree. */
export function parseMemberNetworkContext(value: unknown): MemberNetworkContextPayload {
  const candidate = record(value, 'context');
  exactlyKeys(candidate, ['sponsor', 'self', 'initialPage', 'scope'], 'context');
  const initialPage = page(candidate.initialPage, 'initialPage');
  return {
    sponsor: sponsor(candidate.sponsor),
    self: self(candidate.self),
    initialPage,
    scope: scope(candidate.scope, initialPage.snapshotAt),
  };
}

/** Decode a branch response under the snapshot held by the current member workspace. */
export function parseMemberBranchPage(value: unknown, snapshotAt: string): MemberBranchPage {
  return page(value, 'branch', snapshotAt);
}

/** Search may return named Tier 1 records only; clusters and anonymous entries are rejected. */
export function parseMemberDirectSearchPage(
  value: unknown,
  expectedSnapshotAt?: string,
): MemberDirectSearchPagePayload {
  const candidate = record(value, 'directSearch');
  exactlyKeys(candidate, ['items', 'nextCursor', 'snapshotAt'], 'directSearch');
  if (!Array.isArray(candidate.items)) fail('directSearch.items', 'expected an array');
  const snapshotAt = canonicalSnapshot(candidate.snapshotAt, 'directSearch.snapshotAt');
  if (expectedSnapshotAt && snapshotAt !== expectedSnapshotAt) {
    throw new MemberNetworkSnapshotMismatchError();
  }
  const items: MemberDirectNode[] = [];
  for (const [index, item] of candidate.items.entries()) {
    const parsed = parseMemberVisibleNode(item, `directSearch.items[${index}]`);
    if (parsed.kind !== 'direct') fail('directSearch.items', 'search can return only Tier 1 direct members');
    items.push(parsed);
  }
  return { items, nextCursor: optionalCursor(candidate.nextCursor, 'directSearch.nextCursor'), snapshotAt };
}
