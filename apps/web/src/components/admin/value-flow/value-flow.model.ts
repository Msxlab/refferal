import type {
  BuildValueFlowInput,
  Cents,
  CommissionPlanApi,
  RecentSaleApi,
  ValueFlowAttentionItem,
  ValueFlowEdge,
  ValueFlowMember,
  ValueFlowNode,
  ValueFlowWorkspace,
} from './value-flow.types';

const INTEGER_CENTS = /^-?\d+$/;

export function normalizeCents(value: string | number | bigint): Cents {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('Cents number must be a safe integer');
    return BigInt(value).toString();
  }
  if (typeof value === 'bigint') return value.toString();

  const text = value.trim();
  if (!INTEGER_CENTS.test(text)) throw new TypeError('Cents value must contain integer cents');
  return BigInt(text).toString();
}

export function addCents(...values: Array<string | number | bigint>): Cents {
  return values.reduce<bigint>((total, value) => total + BigInt(normalizeCents(value)), 0n).toString();
}

function normalizeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function normalizeMember(node: BuildValueFlowInput['tree'][number]): ValueFlowMember {
  return {
    id: node.id,
    parentId: node.parentId,
    name: node.fullName,
    referralCode: node.referralCode,
    role: node.role,
    status: node.status,
    depth: node.depth,
    isTeamLeader: node.isTeamLeader,
    joinedAt: node.joinedAt,
    salesCount: normalizeCount(node.salesCount),
    revenueCents: normalizeCents(node.revenueCents),
    monthlyCommissionCents: normalizeCents(node.monthlyCommissionCents),
    settledOrPayableEarningsCents: normalizeCents(node.earningsCents),
    teamSize: normalizeCount(node.teamSize),
    subtreeRevenueCents: normalizeCents(node.subtreeRevenueCents),
  };
}

function aggregateMembers(members: ValueFlowMember[]) {
  return {
    members: members.length,
    sales: members.reduce((total, member) => total + member.salesCount, 0),
    revenueCents: addCents(...members.map((member) => member.revenueCents)),
  };
}

function selectActivePlan(input: BuildValueFlowInput): CommissionPlanApi | null {
  if (!input.plans) return null;
  const plan =
    input.plans.plans.find(({ id }) => id === input.plans?.activeId) ??
    input.plans.plans.find(({ active }) => active);
  if (!plan) return null;
  return {
    ...plan,
    levels: [...plan.levels].sort((a, b) => a.level - b.level),
  };
}

function ratioBps(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  const safeNumerator = BigInt(normalizeCount(numerator));
  const safeDenominator = BigInt(normalizeCount(denominator));
  if (safeDenominator === 0n) return null;
  const ratio = Number((safeNumerator * 10_000n) / safeDenominator);
  return Math.max(0, Math.min(10_000, ratio));
}

function buildFlowNodes(
  input: BuildValueFlowInput,
  activePlan: CommissionPlanApi | null,
  sources: ValueFlowWorkspace['sources'],
): ValueFlowNode[] {
  const nodes: ValueFlowNode[] = [
    {
      id: 'source:direct',
      kind: 'source',
      column: 0,
      lane: 0,
      eyebrow: 'Current month',
      title: 'Direct network',
      detail: 'Root and first-generation member sales',
      tone: 'cobalt',
      valueCents: sources.direct.revenueCents,
      count: sources.direct.sales,
    },
    {
      id: 'source:extended',
      kind: 'source',
      column: 0,
      lane: 1,
      eyebrow: 'Current month',
      title: 'Extended network',
      detail: 'Second generation and deeper member sales',
      tone: 'neutral',
      valueCents: sources.extended.revenueCents,
      count: sources.extended.sales,
    },
    {
      id: 'stage:qualified-sales',
      kind: 'stage',
      column: 1,
      lane: 0,
      eyebrow: input.dashboard.month,
      title: 'Qualified sales',
      detail: 'Approved sales in the tenant ledger',
      tone: 'cobalt',
      valueCents: normalizeCents(input.dashboard.thisMonth.revenueCents),
      count: normalizeCount(input.dashboard.thisMonth.approvedSalesCount),
    },
    {
      id: 'stage:net-commission',
      kind: 'stage',
      column: 2,
      lane: 0,
      eyebrow: input.dashboard.month,
      title: 'Net commissions',
      detail: 'Netted monthly summary across beneficiaries',
      tone: 'mint',
      valueCents: normalizeCents(input.dashboard.thisMonth.commissionCents),
    },
    {
      id: 'liability:pending',
      kind: 'liability',
      column: 3,
      lane: 0,
      eyebrow: 'Outstanding',
      title: 'Pending maturity',
      detail: 'Ledger value not yet payable',
      tone: 'amber',
      valueCents: normalizeCents(input.dashboard.liability.pendingCents),
    },
    {
      id: 'liability:payable',
      kind: 'liability',
      column: 3,
      lane: 1,
      eyebrow: 'Outstanding',
      title: 'Ready to pay',
      detail: 'Payable ledger balance',
      tone: 'mint',
      valueCents: normalizeCents(input.dashboard.liability.payableCents),
    },
    {
      id: 'liability:in-payout',
      kind: 'liability',
      column: 3,
      lane: 2,
      eyebrow: 'Outstanding',
      title: 'In payout',
      detail: 'Value assigned to an active payout',
      tone: 'cobalt',
      valueCents: normalizeCents(input.dashboard.liability.inPayoutCents),
    },
  ];

  if (!activePlan) return nodes;
  for (const [index, level] of activePlan.levels.entries()) {
    nodes.push({
      id: `rule:level-${level.level}`,
      kind: 'rule',
      column: 2,
      lane: index + 1,
      eyebrow: `Level ${level.level}`,
      title: `${level.rateBps / 100}% configured rate`,
      detail: `${activePlan.name} · version ${activePlan.version}`,
      tone: 'neutral',
      rateBps: level.rateBps,
    });
  }
  return nodes;
}

function buildFlowEdges(activePlan: CommissionPlanApi | null, treeComplete: boolean): ValueFlowEdge[] {
  const edges: ValueFlowEdge[] = [
    ...(treeComplete
      ? [
          { id: 'direct-to-sales', source: 'source:direct', target: 'stage:qualified-sales', kind: 'flow' as const },
          { id: 'extended-to-sales', source: 'source:extended', target: 'stage:qualified-sales', kind: 'flow' as const },
        ]
      : []),
    { id: 'sales-to-commission', source: 'stage:qualified-sales', target: 'stage:net-commission', kind: 'flow' },
  ];
  for (const level of activePlan?.levels ?? []) {
    edges.push({
      id: `commission-to-rule-${level.level}`,
      source: 'stage:net-commission',
      target: `rule:level-${level.level}`,
      kind: 'rule',
      label: `${level.rateBps / 100}%`,
    });
  }
  return edges;
}

const TODO_PRIORITY: Record<string, number> = {
  fraud_review: 0,
  payout_requests: 1,
  sales_approval: 2,
  checks_to_process: 3,
};

function taskTone(key: string): ValueFlowAttentionItem['tone'] {
  if (key === 'fraud_review') return 'critical';
  if (key === 'payout_requests' || key === 'sales_approval') return 'warning';
  return 'neutral';
}

function buildAttention(input: BuildValueFlowInput): ValueFlowAttentionItem[] {
  const tasks = (input.todo?.items ?? [])
    .filter(({ count }) => count > 0)
    .map<ValueFlowAttentionItem>((item) => ({
      id: `task:${item.key}`,
      kind: 'task',
      tone: taskTone(item.key),
      title: item.label,
      detail: 'Server-provided operational task',
      count: item.count,
      href: item.href,
    }))
    .sort((a, b) => {
      const aKey = a.id.slice('task:'.length);
      const bKey = b.id.slice('task:'.length);
      return (TODO_PRIORITY[aKey] ?? 99) - (TODO_PRIORITY[bKey] ?? 99) || a.id.localeCompare(b.id);
    });

  const signals: ValueFlowAttentionItem[] = [];
  const noSale = input.networkHealth?.noSaleActive;
  if (noSale && noSale.count > 0) {
    signals.push({
      id: 'signal:no-sale-active',
      kind: 'signal',
      tone: 'warning',
      title: 'Active members with no approved sale',
      detail: `${noSale.pct}% of active members in ${input.networkHealth?.month ?? input.dashboard.month}`,
      count: noSale.count,
      href: '/admin/tree?view=table&signal=no-sale',
    });
  }
  for (const cluster of input.networkHealth?.dormantClusters ?? []) {
    signals.push({
      id: `signal:dormant:${cluster.leaderId}`,
      kind: 'signal',
      tone: 'neutral',
      title: `${cluster.leaderName} network is dormant`,
      detail: `${cluster.referralCode} · ${cluster.teamSize} member${cluster.teamSize === 1 ? '' : 's'} in the cluster`,
      count: cluster.teamSize,
      href: `/admin/tree?view=table&selected=member:${encodeURIComponent(cluster.leaderId)}`,
      entityId: cluster.leaderId,
    });
  }
  return [...tasks, ...signals];
}

function normalizeRecentSales(input: BuildValueFlowInput): RecentSaleApi[] {
  return (input.recentSales?.items ?? []).map((sale) => ({
    ...sale,
    amountCents: normalizeCents(sale.amountCents),
    commissionCents: normalizeCents(sale.commissionCents),
  }));
}

export function buildValueFlowWorkspace(input: BuildValueFlowInput): ValueFlowWorkspace {
  const members = input.tree.map(normalizeMember);
  const minimumDepth = members.length > 0 ? Math.min(...members.map(({ depth }) => depth)) : 0;
  const directMembers = members.filter(({ depth }) => depth <= minimumDepth + 1);
  const extendedMembers = members.filter(({ depth }) => depth > minimumDepth + 1);
  const sources = {
    direct: aggregateMembers(directMembers),
    extended: aggregateMembers(extendedMembers),
  };
  const activePlan = selectActivePlan(input);
  const tracedSales = sources.direct.sales + sources.extended.sales;
  const treeScope = input.treeScope ?? { rootMembershipId: null, complete: true };

  return {
    asOf: {
      month: input.dashboard.month,
      currency: input.dashboard.currency,
      source: 'tenant-dashboard',
    },
    treeScope,
    availability: {
      plans: input.plans != null,
      todo: input.todo != null,
      networkHealth: input.networkHealth != null,
      recentSales: input.recentSales != null,
    },
    summary: {
      approvedSales: normalizeCount(input.dashboard.thisMonth.approvedSalesCount),
      qualifiedRevenueCents: normalizeCents(input.dashboard.thisMonth.revenueCents),
      netCommissionCents: normalizeCents(input.dashboard.thisMonth.commissionCents),
      effectiveRateBps: input.dashboard.thisMonth.effectiveRateBps,
      traceCoverageBps: ratioBps(tracedSales, input.dashboard.thisMonth.approvedSalesCount),
      openTasks: normalizeCount(input.todo?.total ?? 0),
      liabilities: {
        pendingCents: normalizeCents(input.dashboard.liability.pendingCents),
        payableCents: normalizeCents(input.dashboard.liability.payableCents),
        inPayoutCents: normalizeCents(input.dashboard.liability.inPayoutCents),
      },
    },
    sources,
    members,
    activePlan,
    flow: {
      nodes: buildFlowNodes(input, activePlan, sources),
      edges: buildFlowEdges(activePlan, treeScope.complete),
    },
    attention: buildAttention(input),
    recentSales: normalizeRecentSales(input),
  };
}
