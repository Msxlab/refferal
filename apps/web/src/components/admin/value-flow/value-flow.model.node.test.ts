import assert from 'node:assert/strict';
import { test } from 'node:test';

// Node's native TypeScript runner requires an explicit extension.
// @ts-expect-error TypeScript app imports omit extensions, while this file runs directly in Node.
import { addCents, buildValueFlowWorkspace, normalizeCents } from './value-flow.model.ts';

const dashboard = {
  month: '2026-07',
  currency: 'USD',
  members: { total: 3, active: 3 },
  thisMonth: {
    approvedSalesCount: 4,
    revenueCents: '900719925474101000',
    commissionCents: '125000',
    effectiveRateBps: 175,
  },
  outstandingPayableCents: '50000',
  liability: {
    pendingCents: '40000',
    payableCents: '50000',
    inPayoutCents: '35000',
  },
  topEarners: [],
  pendingPayoutRequests: 1,
};

const tree = [
  {
    id: 'root',
    parentId: null,
    fullName: 'Avery Stone',
    referralCode: 'ROOT01',
    role: 'tenant_owner',
    status: 'active',
    depth: 0,
    isTeamLeader: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    salesCount: 1,
    revenueCents: '1000',
    earningsCents: '900719925474099350',
    monthlyCommissionCents: '70000',
    teamSize: 2,
    subtreeRevenueCents: '900719925474101000',
  },
  {
    id: 'direct',
    parentId: 'root',
    fullName: 'Morgan Lee',
    referralCode: 'DIRECT1',
    role: 'member',
    status: 'active',
    depth: 1,
    isTeamLeader: true,
    joinedAt: '2026-02-01T00:00:00.000Z',
    salesCount: 2,
    revenueCents: '900719925474099300',
    earningsCents: '45000',
    monthlyCommissionCents: '40000',
    teamSize: 1,
    subtreeRevenueCents: '900719925474100000',
  },
  {
    id: 'extended',
    parentId: 'direct',
    fullName: 'Jordan Kim',
    referralCode: 'EXTEND1',
    role: 'member',
    status: 'active',
    depth: 2,
    isTeamLeader: false,
    joinedAt: '2026-03-01T00:00:00.000Z',
    salesCount: 1,
    revenueCents: '700',
    earningsCents: '5000',
    monthlyCommissionCents: '15000',
    teamSize: 0,
    subtreeRevenueCents: '700',
  },
];

const plans = {
  activeId: 'plan-active',
  plans: [
    {
      id: 'plan-active',
      name: 'Core referral plan',
      poolRateBps: 900,
      depth: 2,
      fastStartBps: 0,
      fastStartDays: 0,
      matchingBps: 0,
      version: 3,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      active: true,
      levels: [
        { level: 2, rateBps: 300 },
        { level: 1, rateBps: 600 },
      ],
    },
  ],
};

const todo = {
  total: 5,
  items: [
    { key: 'sales_approval', label: 'Sales awaiting approval', count: 2, href: '/admin/sales?status=draft' },
    { key: 'fraud_review', label: 'Fraud flags to review', count: 2, href: '/admin/sales?risk=flagged' },
    { key: 'payout_requests', label: 'Payout requests', count: 1, href: '/admin/payouts?tab=requests' },
  ],
};

const networkHealth = {
  month: '2026-07',
  totals: { members: 3, active: 3, inactive: 0 },
  noSaleActive: { count: 1, total: 3, pct: 33 },
  dormantClusters: [
    { leaderId: 'direct', leaderName: 'Morgan Lee', referralCode: 'DIRECT1', teamSize: 1 },
  ],
};

const recentSales = {
  total: 1,
  page: 1,
  pageSize: 6,
  items: [
    {
      id: 'sale-1',
      amountCents: '700',
      commissionCents: '63',
      currency: 'USD',
      status: 'approved',
      saleDate: '2026-07-18T00:00:00.000Z',
      sellerName: 'Jordan Kim',
      sellerReferralCode: 'EXTEND1',
      customerRef: null,
      externalRef: 'ORDER-17',
      approvedAt: '2026-07-18T02:00:00.000Z',
    },
  ],
};

test('cent helpers preserve values beyond Number.MAX_SAFE_INTEGER', () => {
  assert.equal(normalizeCents('0900719925474099300'), '900719925474099300');
  assert.equal(addCents('900719925474099300', '25', -5n), '900719925474099320');
});

test('cent helpers reject malformed and unsafe numeric inputs', () => {
  assert.throws(() => normalizeCents('12.5'), /integer cents/i);
  assert.throws(() => normalizeCents(Number.MAX_SAFE_INTEGER + 1), /safe integer/i);
});

test('workspace groups first-generation and extended network value without precision loss', () => {
  const workspace = buildValueFlowWorkspace({ dashboard, tree, plans, todo, networkHealth, recentSales });

  assert.equal(workspace.sources.direct.members, 2);
  assert.equal(workspace.sources.direct.sales, 3);
  assert.equal(workspace.sources.direct.revenueCents, '900719925474100300');
  assert.equal(workspace.sources.extended.members, 1);
  assert.equal(workspace.sources.extended.sales, 1);
  assert.equal(workspace.sources.extended.revenueCents, '700');
  assert.equal(workspace.summary.traceCoverageBps, 10_000);
});

test('workspace separates configured commission rules from earned amounts', () => {
  const workspace = buildValueFlowWorkspace({ dashboard, tree, plans, todo, networkHealth, recentSales });
  const levelOne = workspace.flow.nodes.find((node) => node.id === 'rule:level-1');

  assert.equal(levelOne?.kind, 'rule');
  assert.equal(levelOne?.rateBps, 600);
  assert.equal(levelOne?.valueCents, undefined);
  assert.equal(workspace.summary.netCommissionCents, '125000');
  assert.equal(workspace.summary.liabilities.payableCents, '50000');
  assert.ok(workspace.flow.nodes.some((node) => node.id === 'stage:qualified-sales'));
  assert.ok(workspace.flow.nodes.some((node) => node.id === 'stage:net-commission'));
  assert.ok(workspace.flow.nodes.some((node) => node.id === 'liability:in-payout'));
});

test('current-month commission is not drawn as the source of all-time outstanding balances', () => {
  const workspace = buildValueFlowWorkspace({ dashboard, tree, plans, todo, networkHealth, recentSales });
  const misleadingEdges = workspace.flow.edges.filter(
    (edge) => edge.source === 'stage:net-commission' && edge.target.startsWith('liability:'),
  );

  assert.deepEqual(misleadingEdges, []);
});

test('a selected subtree stays visibly partial and is not connected to tenant-wide sales', () => {
  const workspace = buildValueFlowWorkspace({
    dashboard,
    tree: tree.slice(1),
    treeScope: { rootMembershipId: 'direct', complete: false },
  });

  assert.deepEqual(workspace.treeScope, { rootMembershipId: 'direct', complete: false });
  assert.equal(workspace.summary.traceCoverageBps, 7_500);
  assert.equal(
    workspace.flow.edges.some(
      (edge) => edge.source.startsWith('source:') && edge.target === 'stage:qualified-sales',
    ),
    false,
  );
});

test('workspace never invents partner attribution or confidence claims', () => {
  const workspace = buildValueFlowWorkspace({ dashboard, tree, plans, todo, networkHealth, recentSales });
  const visibleCopy = workspace.flow.nodes.flatMap((node) => [node.title, node.detail]).join(' ');

  assert.doesNotMatch(visibleCopy, /partner/i);
  assert.doesNotMatch(visibleCopy, /confidence/i);
  assert.equal(workspace.summary.traceCoverageBps, 10_000);
});

test('attention is stable, explicit, and keeps health signals distinct from tasks', () => {
  const workspace = buildValueFlowWorkspace({ dashboard, tree, plans, todo, networkHealth, recentSales });

  assert.deepEqual(
    workspace.attention.map((item) => item.id),
    ['task:fraud_review', 'task:payout_requests', 'task:sales_approval', 'signal:no-sale-active', 'signal:dormant:direct'],
  );
  assert.equal(workspace.attention[0]?.kind, 'task');
  assert.equal(workspace.attention[3]?.kind, 'signal');
  assert.equal(workspace.attention[4]?.entityId, 'direct');
});

test('optional sources can be unavailable without hiding the authoritative core', () => {
  const workspace = buildValueFlowWorkspace({ dashboard, tree });

  assert.equal(workspace.asOf.month, '2026-07');
  assert.equal(workspace.asOf.currency, 'USD');
  assert.equal(workspace.summary.qualifiedRevenueCents, '900719925474101000');
  assert.equal(workspace.activePlan, null);
  assert.deepEqual(workspace.attention, []);
  assert.deepEqual(workspace.recentSales, []);
  assert.deepEqual(workspace.availability, {
    plans: false,
    todo: false,
    networkHealth: false,
    recentSales: false,
  });
});
