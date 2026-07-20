export type Cents = string;

export interface DashboardApi {
  month: string;
  currency: string;
  members: { total: number; active: number };
  thisMonth: {
    approvedSalesCount: number;
    revenueCents: Cents;
    commissionCents: Cents;
    effectiveRateBps: number;
  };
  outstandingPayableCents: Cents;
  liability: {
    pendingCents: Cents;
    payableCents: Cents;
    inPayoutCents: Cents;
  };
  topEarners: Array<{
    membershipId: string;
    fullName: string;
    referralCode: string;
    earnedCents: Cents;
  }>;
  pendingPayoutRequests: number;
}

export interface ReferralTreeNodeApi {
  id: string;
  parentId: string | null;
  fullName: string;
  referralCode: string;
  role: string;
  status: string;
  depth: number;
  isTeamLeader: boolean;
  joinedAt: string;
  salesCount: number;
  revenueCents: Cents;
  earningsCents: Cents;
  monthlyCommissionCents: Cents;
  teamSize: number;
  subtreeRevenueCents: Cents;
}

export interface CommissionPlanLevelApi {
  level: number;
  rateBps: number;
}

export interface CommissionPlanApi {
  id: string;
  name: string;
  poolRateBps: number;
  depth: number;
  fastStartBps: number;
  fastStartDays: number;
  matchingBps: number;
  version: number;
  effectiveFrom: string;
  active: boolean;
  levels: CommissionPlanLevelApi[];
}

export interface CommissionPlansApi {
  activeId: string | null;
  plans: CommissionPlanApi[];
}

export interface TodoApi {
  items: Array<{ key: string; label: string; count: number; href: string }>;
  total: number;
}

export interface NetworkHealthApi {
  month: string;
  totals: { members: number; active: number; inactive: number };
  noSaleActive: { count: number; total: number; pct: number };
  dormantClusters: Array<{
    leaderId: string;
    leaderName: string;
    referralCode: string;
    teamSize: number;
  }>;
}

export interface RecentSaleApi {
  id: string;
  amountCents: Cents;
  commissionCents: Cents;
  currency?: string;
  status: string;
  saleDate: string;
  sellerName: string;
  sellerReferralCode: string;
  customerRef?: string | null;
  externalRef?: string | null;
  approvedAt?: string | null;
}

export interface RecentSalesApi {
  total: number;
  page: number;
  pageSize: number;
  items: RecentSaleApi[];
}

export interface ValueFlowMember {
  id: string;
  parentId: string | null;
  name: string;
  referralCode: string;
  role: string;
  status: string;
  depth: number;
  isTeamLeader: boolean;
  joinedAt: string;
  salesCount: number;
  revenueCents: Cents;
  monthlyCommissionCents: Cents;
  settledOrPayableEarningsCents: Cents;
  teamSize: number;
  subtreeRevenueCents: Cents;
}

export type ValueFlowNodeKind = 'source' | 'stage' | 'rule' | 'liability';
export type ValueFlowTone = 'cobalt' | 'mint' | 'amber' | 'neutral';

export interface ValueFlowNode {
  id: string;
  kind: ValueFlowNodeKind;
  column: number;
  lane: number;
  eyebrow: string;
  title: string;
  detail: string;
  tone: ValueFlowTone;
  valueCents?: Cents;
  count?: number;
  rateBps?: number;
}

export interface ValueFlowEdge {
  id: string;
  source: string;
  target: string;
  kind: 'flow' | 'rule';
  label?: string;
}

export interface ValueFlowAttentionItem {
  id: string;
  kind: 'task' | 'signal';
  tone: 'critical' | 'warning' | 'neutral';
  title: string;
  detail: string;
  count: number;
  href: string;
  entityId?: string;
}

export interface ValueFlowWorkspace {
  asOf: { month: string; currency: string; source: 'tenant-dashboard' };
  treeScope: { rootMembershipId: string | null; complete: boolean };
  availability: {
    plans: boolean;
    todo: boolean;
    networkHealth: boolean;
    recentSales: boolean;
  };
  summary: {
    approvedSales: number;
    qualifiedRevenueCents: Cents;
    netCommissionCents: Cents;
    effectiveRateBps: number;
    traceCoverageBps: number | null;
    openTasks: number;
    liabilities: {
      pendingCents: Cents;
      payableCents: Cents;
      inPayoutCents: Cents;
    };
  };
  sources: {
    direct: { members: number; sales: number; revenueCents: Cents };
    extended: { members: number; sales: number; revenueCents: Cents };
  };
  members: ValueFlowMember[];
  activePlan: CommissionPlanApi | null;
  flow: { nodes: ValueFlowNode[]; edges: ValueFlowEdge[] };
  attention: ValueFlowAttentionItem[];
  recentSales: RecentSaleApi[];
}

export interface BuildValueFlowInput {
  dashboard: DashboardApi;
  tree: ReferralTreeNodeApi[];
  treeScope?: { rootMembershipId: string | null; complete: boolean };
  plans?: CommissionPlansApi | null;
  todo?: TodoApi | null;
  networkHealth?: NetworkHealthApi | null;
  recentSales?: RecentSalesApi | null;
}
