export type NetworkStatus = 'active' | 'inactive';

declare const opaqueMemberNodeRefBrand: unique symbol;
declare const anonymousMemberInitialsBrand: unique symbol;

/**
 * A structurally canonical signed member reference. It is intentionally not a
 * membership UUID, referral code, or any other user-identifying value.
 */
export type OpaqueMemberNodeRef = string & {
  readonly [opaqueMemberNodeRefBrand]: 'OpaqueMemberNodeRef';
};

/** Exactly two NFC-normalized uppercase initials for a redacted member. */
export type AnonymousMemberInitials = string & {
  readonly [anonymousMemberInitialsBrand]: 'AnonymousMemberInitials';
};

const OPAQUE_MEMBER_NODE_REF_MAX_LENGTH = 2048;
const OPAQUE_MEMBER_NODE_REF = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const ANONYMOUS_MEMBER_INITIALS = /^\p{Lu}{2}$/u;

function isCanonicalBase64Url(value: string): boolean {
  if (value.length === 0 || value.length % 4 === 1) return false;
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const decoded = atob(padded);
    return btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === value;
  } catch {
    return false;
  }
}

export function isOpaqueMemberNodeRef(value: unknown): value is OpaqueMemberNodeRef {
  if (
    typeof value !== 'string' ||
    value.length > OPAQUE_MEMBER_NODE_REF_MAX_LENGTH ||
    !OPAQUE_MEMBER_NODE_REF.test(value)
  ) {
    return false;
  }
  const [payload, signature] = value.split('.');
  return isCanonicalBase64Url(payload) && isCanonicalBase64Url(signature);
}

export function parseOpaqueMemberNodeRef(value: string): OpaqueMemberNodeRef {
  if (!isOpaqueMemberNodeRef(value)) {
    throw new TypeError('invalid opaque member node reference');
  }
  return value;
}

export function isAnonymousMemberInitials(value: unknown): value is AnonymousMemberInitials {
  return typeof value === 'string' && value.normalize('NFC') === value && ANONYMOUS_MEMBER_INITIALS.test(value);
}

export function parseAnonymousMemberInitials(value: string): AnonymousMemberInitials {
  if (!isAnonymousMemberInitials(value)) {
    throw new TypeError('invalid anonymous member initials');
  }
  return value;
}

export interface AdminNodePerformance {
  currency: string;
  period: string;
  approvedSales: number;
  teamVolumeCents: string;
  commissionCents?: string | null;
}

export interface AdminHierarchyMemberNode {
  kind: 'member';
  membershipId: string;
  parentMembershipId: string | null;
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
  rank: string | null;
  globalTier: number;
  localTier: number;
  directCount: number;
  subtreeCount: number;
  canExpand: boolean;
  performance?: AdminNodePerformance | null;
}

export interface AdminHierarchyClusterNode {
  kind: 'cluster';
  clusterRef: string;
  parentMembershipId: string | null;
  label: string;
  localTier: number;
  representedNodes: number;
  canExpand: true;
}

export type AdminHierarchyNode = AdminHierarchyMemberNode | AdminHierarchyClusterNode;

export interface MemberSponsorNode {
  kind: 'sponsor';
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
}

export interface MemberSelfNode {
  kind: 'self';
  nodeRef: 'self';
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
  directCount: number;
  visibleDownlineCount: number;
  performance: {
    currency: string;
    period: string;
    visibleApprovedSales: number;
    visibleTeamVolumeCents: string;
  };
}

export interface MemberDirectNode {
  kind: 'direct';
  nodeRef: OpaqueMemberNodeRef;
  parentRef: 'self';
  localTier: 1;
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
  visibleDirectCount: number;
  visibleBranchCount: number;
  canExpand: boolean;
  performance: {
    currency: string;
    period: string;
    approvedSales: number;
    visibleBranchVolumeCents: string;
  };
}

export type MemberPerformanceBand =
  | { suppressed: true; reason: 'smallCohort' | 'noData' }
  | {
      suppressed: false;
      approvedSalesBand: '0' | '1-4' | '5-9' | '10+';
      volumeBand: 'none' | 'under1k' | '1k-5k' | '5k-10k' | '10k+';
    };

interface MemberAnonymousNodeBase {
  kind: 'anonymous';
  nodeRef: OpaqueMemberNodeRef;
  parentRef: OpaqueMemberNodeRef;
  initials: AnonymousMemberInitials;
  status: NetworkStatus;
  performanceBand: MemberPerformanceBand;
}

export interface MemberAnonymousTier2Node extends MemberAnonymousNodeBase {
  localTier: 2;
  label: 'Tier 2 member';
  visibleChildCount?: number;
  canExpand: boolean;
}

export interface MemberAnonymousTier3Node extends MemberAnonymousNodeBase {
  localTier: 3;
  label: 'Tier 3 member';
  canExpand: false;
}

export type MemberAnonymousNode = MemberAnonymousTier2Node | MemberAnonymousTier3Node;

/**
 * A privacy-safe continuation group. Its signed references are intentionally
 * opaque and it can only stand for one anonymous visible tier.
 */
export interface MemberVisibleClusterNode {
  kind: 'cluster';
  clusterRef: OpaqueMemberNodeRef;
  parentRef: OpaqueMemberNodeRef;
  localTier: 2 | 3;
  label: 'Tier 2 members' | 'Tier 3 members';
  representedNodes: number;
  canExpand: true;
}

export type MemberVisibleNode = MemberDirectNode | MemberAnonymousNode | MemberVisibleClusterNode;

export type NetworkHierarchyNode =
  | AdminHierarchyNode
  | MemberSelfNode
  | MemberDirectNode
  | MemberAnonymousNode
  | MemberVisibleClusterNode;

export interface BranchPage<TNode> {
  parentRef: string;
  items: TNode[];
  representedNodes: number;
  nextCursor: string | null;
  snapshotAt: string;
}

export interface AdminNetworkScope {
  kind: 'full' | 'focused';
  loadedNodes: number;
  representedNodes: number;
  totalNodes: number;
  complete: boolean;
  collapsedBranches: number;
  snapshotAt: string;
  structuralCountsCoverage: 'exact';
  metricsCoverage: 'fullSubtree' | 'loadedWindow';
}

export interface AdminNetworkCapabilities {
  viewIdentity: boolean;
  viewFinancials: boolean;
  openMember: boolean;
  focusBranch: boolean;
}

export interface SyntheticTenantRootNode {
  kind: 'tenantRoot';
  label: string;
}

export interface AdminNetworkContext {
  root: SyntheticTenantRootNode;
  focus: AdminHierarchyNode | null;
  ancestors: AdminHierarchyNode[];
  initialPage: BranchPage<AdminHierarchyNode>;
  scope: AdminNetworkScope;
  capabilities: AdminNetworkCapabilities;
}

export interface MemberNetworkScope {
  maxVisibleTier: 3;
  loadedNodes: number;
  representedNodes: number;
  completeWithinVisibleDepth: boolean;
  snapshotAt: string;
  structuralCountsCoverage: 'visibleTiersExact';
  metricsCoverage: 'visibleTiersExact' | 'loadedWindow';
}

export interface MemberNetworkContext {
  sponsor: MemberSponsorNode | null;
  self: MemberSelfNode;
  initialPage: BranchPage<MemberVisibleNode>;
  scope: MemberNetworkScope;
}
