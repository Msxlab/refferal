export type NetworkStatus = "active" | "inactive";

export interface SyntheticTenantRootNode {
  kind: "tenantRoot";
  label: string;
}

export interface AdminNodePerformance {
  currency: string;
  period: string;
  approvedSales: number;
  teamVolumeCents: string;
  commissionCents?: string;
}

export interface AdminMemberNode {
  kind: "member";
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
  performance?: AdminNodePerformance;
}

export interface AdminClusterNode {
  kind: "cluster";
  clusterRef: string;
  parentMembershipId: string | null;
  label: string;
  localTier: number;
  representedNodes: number;
  canExpand: true;
}

export type AdminNetworkNode = AdminMemberNode | AdminClusterNode;

export interface MemberSponsorNode {
  kind: "sponsor";
  displayName: string;
  initials: string;
  referralCode: string;
  status: NetworkStatus;
}

export interface MemberSelfNode {
  kind: "self";
  nodeRef: "self";
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
  kind: "direct";
  nodeRef: string;
  parentRef: "self";
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
  | { suppressed: true; reason: "smallCohort" | "noData" }
  | {
      suppressed: false;
      approvedSalesBand: "0" | "1-4" | "5-9" | "10+";
      volumeBand: "none" | "under1k" | "1k-5k" | "5k-10k" | "10k+";
    };

interface MemberAnonymousNodeBase {
  kind: "anonymous";
  nodeRef: string;
  parentRef: string;
  initials: string;
  status: NetworkStatus;
  performanceBand: MemberPerformanceBand;
}

export interface MemberAnonymousTier2Node extends MemberAnonymousNodeBase {
  localTier: 2;
  label: "Tier 2 member";
  visibleChildCount?: number;
  canExpand: boolean;
}

export interface MemberAnonymousTier3Node extends MemberAnonymousNodeBase {
  localTier: 3;
  label: "Tier 3 member";
  canExpand: false;
}

export type MemberAnonymousNode =
  MemberAnonymousTier2Node | MemberAnonymousTier3Node;
export type MemberVisibleNode = MemberDirectNode | MemberAnonymousNode;

export interface BranchPage<TNode> {
  parentRef: string;
  items: TNode[];
  representedNodes: number;
  nextCursor: string | null;
  snapshotAt: string;
}

export interface AdminNetworkScope {
  kind: "full" | "focused";
  loadedNodes: number;
  representedNodes: number;
  totalNodes: number;
  complete: boolean;
  collapsedBranches: number;
  snapshotAt: string;
  structuralCountsCoverage: "exact";
  metricsCoverage: "fullSubtree" | "loadedWindow";
}

export interface AdminNetworkCapabilities {
  viewIdentity: boolean;
  viewFinancials: boolean;
  openMember: boolean;
  focusBranch: boolean;
}

export interface AdminNetworkContext {
  root: SyntheticTenantRootNode;
  focus: AdminNetworkNode | null;
  ancestors: AdminNetworkNode[];
  initialPage: BranchPage<AdminNetworkNode>;
  scope: AdminNetworkScope;
  capabilities: AdminNetworkCapabilities;
}

export interface MemberNetworkScope {
  maxVisibleTier: 3;
  loadedNodes: number;
  representedNodes: number;
  completeWithinVisibleDepth: boolean;
  snapshotAt: string;
  structuralCountsCoverage: "visibleTiersExact";
  metricsCoverage: "visibleTiersExact" | "loadedWindow";
}

export interface MemberNetworkContext {
  sponsor: MemberSponsorNode | null;
  self: MemberSelfNode;
  initialPage: BranchPage<MemberVisibleNode>;
  scope: MemberNetworkScope;
}
