import assert from 'node:assert/strict';
import { test } from 'node:test';

// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { loadValueFlowSources, RequiredValueFlowSourceError } from './value-flow.loader.ts';

const payloads: Record<string, unknown> = {
  '/admin/dashboard': {
    month: '2026-07', currency: 'USD', members: { total: 1, active: 1 },
    thisMonth: { approvedSalesCount: 1, revenueCents: '1000', commissionCents: '100', effectiveRateBps: 1000 },
    outstandingPayableCents: '50', liability: { pendingCents: '25', payableCents: '20', inPayoutCents: '5' },
    topEarners: [], pendingPayoutRequests: 0,
  },
  '/admin/members/tree-snapshot': {
    items: [{
      id: 'member-1', parentId: null, fullName: 'Morgan Lee', referralCode: 'MOR-1', role: 'member',
      status: 'active', depth: 0, isTeamLeader: false, joinedAt: '2026-01-01T00:00:00.000Z',
      salesCount: 1, revenueCents: '1000', earningsCents: '100', monthlyCommissionCents: '100',
      teamSize: 0, subtreeRevenueCents: '1000',
    }],
    scope: { complete: true, total: 1, limit: 500 },
  },
  '/admin/members/network-health': {
    month: '2026-07', totals: { members: 1, active: 1, inactive: 0 },
    noSaleActive: { count: 0, total: 1, pct: 0 },
    dormantScope: { complete: true, totalLeaders: 1, scannedLeaders: 1, matchedDormantInScan: 0, returnedDormant: 0, leaderLimit: 200, resultLimit: 20 },
    dormantClusters: [],
  },
  '/admin/todo': { total: 2, items: [] },
  '/admin/plans': { activeId: null, plans: [] },
  '/admin/sales?status=approved&summaryMonth=2026-07&page=1&pageSize=6': { total: 0, page: 1, pageSize: 6, items: [] },
};

test('starts independent requests together, then binds sale evidence to the dashboard month', async () => {
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  const request = (path: string) => {
    started.push(path);
    return new Promise<unknown>((resolve) => {
      releases.set(path, () => resolve(payloads[path]));
    });
  };

  const pending = loadValueFlowSources(request);
  assert.deepEqual(started, Object.keys(payloads).slice(0, 5));
  releases.get('/admin/dashboard')?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(started.at(-1), '/admin/sales?status=approved&summaryMonth=2026-07&page=1&pageSize=6');
  for (const release of releases.values()) release();

  const result = await pending;
  assert.deepEqual(result.optionalFailures, []);
  assert.deepEqual(result.tree, (payloads['/admin/members/tree-snapshot'] as { items: unknown }).items);
  assert.deepEqual(result.treeScope, { rootMembershipId: null, complete: true, total: 1, limit: 500 });
});

test('preserves core data and identifies optional failures', async () => {
  const result = await loadValueFlowSources(async (path) => {
    if (path === '/admin/todo' || path === '/admin/plans') throw new Error(`unavailable: ${path}`);
    return payloads[path];
  });

  assert.deepEqual(result.dashboard, payloads['/admin/dashboard']);
  assert.deepEqual(result.tree, (payloads['/admin/members/tree-snapshot'] as { items: unknown }).items);
  assert.equal(result.todo, null);
  assert.equal(result.plans, null);
  assert.deepEqual(result.optionalFailures, ['todo', 'plans']);
});

test('marks a bounded hierarchy snapshot as incomplete', async () => {
  const result = await loadValueFlowSources(async (path) => {
    if (path !== '/admin/members/tree-snapshot') return payloads[path];
    const snapshot = payloads[path] as { items: unknown[] };
    return { items: snapshot.items, scope: { complete: false, total: 701, limit: 500 } };
  });

  assert.deepEqual(result.treeScope, { rootMembershipId: null, complete: false, total: 701, limit: 500 });
});

test('skips optional sources that the current role cannot read', async () => {
  const started: string[] = [];
  const result = await loadValueFlowSources(async (path) => {
    started.push(path);
    return payloads[path];
  }, { includePlans: false, includeRecentSales: false });

  assert.equal(started.includes('/admin/plans'), false);
  assert.equal(started.some((path) => path.startsWith('/admin/sales?')), false);
  assert.equal(result.plans, null);
  assert.equal(result.recentSales, null);
  assert.deepEqual(result.optionalFailures, []);
});

test('publishes required core data before optional evidence settles', async () => {
  const releases: Array<() => void> = [];
  let core: unknown = null;
  const pending = loadValueFlowSources((path) => {
    if (path === '/admin/dashboard' || path === '/admin/members/tree-snapshot') return Promise.resolve(payloads[path]);
    return new Promise<unknown>((resolve) => releases.push(() => resolve(payloads[path])));
  }, { onCore: (sources) => { core = sources; } });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(core, {
    dashboard: payloads['/admin/dashboard'],
    tree: (payloads['/admin/members/tree-snapshot'] as { items: unknown }).items,
    treeScope: { rootMembershipId: null, complete: true, total: 1, limit: 500 },
  });

  for (const release of releases) release();
  await pending;
});

test('throws an explicit required-source error after all requests settle', async () => {
  const settled: string[] = [];
  const request = async (path: string) => {
    try {
      if (path === '/admin/dashboard' || path === '/admin/members/tree-snapshot') {
        throw new Error(`failed: ${path}`);
      }
      return payloads[path];
    } finally {
      settled.push(path);
    }
  };

  await assert.rejects(
    () => loadValueFlowSources(request),
    (error: unknown) => {
      assert.ok(error instanceof RequiredValueFlowSourceError);
      assert.deepEqual(error.sources, ['dashboard', 'tree']);
      return true;
    },
  );
  assert.equal(settled.length, Object.keys(payloads).length - 1);
});

test('rejects malformed required 200 responses instead of coercing false zeroes', async () => {
  await assert.rejects(
    () => loadValueFlowSources(async (path) => path === '/admin/dashboard' ? { month: '2026-07' } : payloads[path]),
    (error: unknown) => error instanceof RequiredValueFlowSourceError && error.sources.includes('dashboard'),
  );
});

test('accepts a negative effective rate produced by clawbacks or adjustments', async () => {
  const dashboard = payloads['/admin/dashboard'] as {
    thisMonth: Record<string, unknown>;
  };
  const adjustedDashboard = {
    ...dashboard,
    thisMonth: { ...dashboard.thisMonth, effectiveRateBps: -250 },
  };

  const result = await loadValueFlowSources(async (path) =>
    path === '/admin/dashboard' ? adjustedDashboard : payloads[path]);

  assert.equal(result.dashboard.thisMonth.effectiveRateBps, -250);
});

test('rejects an effective rate outside the safe signed-integer range', async () => {
  const dashboard = payloads['/admin/dashboard'] as {
    thisMonth: Record<string, unknown>;
  };
  const unsafeDashboard = {
    ...dashboard,
    thisMonth: { ...dashboard.thisMonth, effectiveRateBps: Number.MIN_SAFE_INTEGER - 1 },
  };

  await assert.rejects(
    () => loadValueFlowSources(async (path) =>
      path === '/admin/dashboard' ? unsafeDashboard : payloads[path]),
    (error: unknown) => error instanceof RequiredValueFlowSourceError && error.sources.includes('dashboard'),
  );
});
