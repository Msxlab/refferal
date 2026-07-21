import type {
  CommissionPlanApi,
  CommissionPlansApi,
  DashboardApi,
  NetworkHealthApi,
  RecentSaleApi,
  RecentSalesApi,
  ReferralTreeNodeApi,
  ReferralTreeSnapshotApi,
  TodoApi,
  ValueFlowTreeScope,
} from './value-flow.types';

export type ValueFlowOptionalSource = 'networkHealth' | 'todo' | 'plans' | 'recentSales';
export type ValueFlowRequiredSource = 'dashboard' | 'tree';

export interface ValueFlowSourceResult {
  dashboard: DashboardApi;
  tree: ReferralTreeNodeApi[];
  treeScope: ValueFlowTreeScope;
  networkHealth: NetworkHealthApi | null;
  todo: TodoApi | null;
  plans: CommissionPlansApi | null;
  recentSales: RecentSalesApi | null;
  optionalFailures: ValueFlowOptionalSource[];
}

export class RequiredValueFlowSourceError extends Error {
  readonly sources: ValueFlowRequiredSource[];

  constructor(sources: ValueFlowRequiredSource[]) {
    super(`Required value-flow source${sources.length === 1 ? '' : 's'} failed: ${sources.join(', ')}`);
    this.name = 'RequiredValueFlowSourceError';
    this.sources = sources;
  }
}

type Request = (path: string) => Promise<unknown>;

interface LoadOptions {
  optionalTimeoutMs?: number;
  onCore?: (sources: Pick<ValueFlowSourceResult, 'dashboard' | 'tree' | 'treeScope'>) => void;
  includePlans?: boolean;
  includeRecentSales?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCents(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d+$/.test(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSignedInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isDashboard(value: unknown): value is DashboardApi {
  if (!isRecord(value) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value.month)) || !isText(value.currency)) return false;
  const members = value.members;
  const month = value.thisMonth;
  const liability = value.liability;
  return isRecord(members) && isCount(members.total) && isCount(members.active) &&
    isRecord(month) && isCount(month.approvedSalesCount) && isCents(month.revenueCents) &&
    isCents(month.commissionCents) && isSignedInteger(month.effectiveRateBps) &&
    isCents(value.outstandingPayableCents) && isRecord(liability) &&
    isCents(liability.pendingCents) && isCents(liability.payableCents) && isCents(liability.inPayoutCents) &&
    Array.isArray(value.topEarners) && isCount(value.pendingPayoutRequests);
}

function isTreeNode(value: unknown): value is ReferralTreeNodeApi {
  return isRecord(value) && isText(value.id) && (value.parentId === null || isText(value.parentId)) &&
    isText(value.fullName) && isText(value.referralCode) && isText(value.role) && isText(value.status) &&
    isCount(value.depth) && typeof value.isTeamLeader === 'boolean' && isText(value.joinedAt) &&
    isCount(value.salesCount) && isCents(value.revenueCents) && isCents(value.earningsCents) &&
    isCents(value.monthlyCommissionCents) && isCount(value.teamSize) && isCents(value.subtreeRevenueCents);
}

function isTree(value: unknown): value is ReferralTreeNodeApi[] {
  return Array.isArray(value) && value.every(isTreeNode);
}

function isTreeSnapshot(value: unknown): value is ReferralTreeSnapshotApi {
  if (!isRecord(value) || !isTree(value.items) || !isRecord(value.scope)) return false;
  const { complete, total, limit } = value.scope;
  return typeof complete === 'boolean' && isCount(total) && isCount(limit) && limit > 0 &&
    value.items.length <= limit && total >= value.items.length && complete === (value.items.length === total);
}

function isPlan(value: unknown): value is CommissionPlanApi {
  return isRecord(value) && isText(value.id) && isText(value.name) && isCount(value.poolRateBps) &&
    isCount(value.depth) && isCount(value.fastStartBps) && isCount(value.fastStartDays) &&
    isCount(value.matchingBps) && isCount(value.version) && isText(value.effectiveFrom) &&
    typeof value.active === 'boolean' && Array.isArray(value.levels) && value.levels.every((level) =>
      isRecord(level) && isCount(level.level) && isCount(level.rateBps));
}

function isPlans(value: unknown): value is CommissionPlansApi {
  return isRecord(value) && (value.activeId === null || isText(value.activeId)) &&
    Array.isArray(value.plans) && value.plans.every(isPlan);
}

function isTodo(value: unknown): value is TodoApi {
  return isRecord(value) && isCount(value.total) && Array.isArray(value.items) && value.items.every((item) =>
    isRecord(item) && isText(item.key) && isText(item.label) && isCount(item.count) && isText(item.href));
}

function isNetworkHealth(value: unknown): value is NetworkHealthApi {
  if (!isRecord(value) || !isText(value.month) || !isRecord(value.totals) || !isRecord(value.noSaleActive) || !isRecord(value.dormantScope)) return false;
  const scope = value.dormantScope;
  const validScope = typeof scope.complete === 'boolean' &&
    isCount(scope.totalLeaders) && isCount(scope.scannedLeaders) && isCount(scope.matchedDormantInScan) &&
    isCount(scope.returnedDormant) && isCount(scope.leaderLimit) && isCount(scope.resultLimit) &&
    scope.leaderLimit > 0 && scope.resultLimit > 0 && scope.scannedLeaders <= scope.totalLeaders &&
    scope.scannedLeaders <= scope.leaderLimit && scope.returnedDormant <= scope.matchedDormantInScan &&
    scope.returnedDormant <= scope.resultLimit &&
    scope.complete === (scope.scannedLeaders === scope.totalLeaders && scope.matchedDormantInScan <= scope.resultLimit);
  return isCount(value.totals.members) && isCount(value.totals.active) && isCount(value.totals.inactive) &&
    isCount(value.noSaleActive.count) && isCount(value.noSaleActive.total) && isCount(value.noSaleActive.pct) &&
    validScope &&
    Array.isArray(value.dormantClusters) && value.dormantClusters.every((cluster) =>
      isRecord(cluster) && isText(cluster.leaderId) && isText(cluster.leaderName) &&
      isText(cluster.referralCode) && isCount(cluster.teamSize));
}

function isRecentSale(value: unknown): value is RecentSaleApi {
  return isRecord(value) && isText(value.id) && isCents(value.amountCents) && isCents(value.commissionCents) &&
    isText(value.status) && isText(value.saleDate) && isText(value.sellerName) && isText(value.sellerReferralCode) &&
    (value.currency === undefined || isText(value.currency));
}

function isRecentSales(value: unknown): value is RecentSalesApi {
  return isRecord(value) && isCount(value.total) && isCount(value.page) && isCount(value.pageSize) &&
    Array.isArray(value.items) && value.items.every(isRecentSale);
}

function requireShape<T>(value: unknown, predicate: (candidate: unknown) => candidate is T): T {
  if (!predicate(value)) throw new TypeError('Value-flow source returned an invalid payload');
  return value;
}

function begin(request: Request, path: string): Promise<unknown> {
  try {
    return Promise.resolve(request(path));
  } catch (error) {
    return Promise.reject(error);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Optional value-flow source timed out')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function loadValueFlowSources(
  request: Request,
  {
    optionalTimeoutMs = 4_000,
    onCore,
    includePlans = true,
    includeRecentSales = true,
  }: LoadOptions = {},
): Promise<ValueFlowSourceResult> {
  const dashboardPromise = begin(request, '/admin/dashboard').then((value) => requireShape(value, isDashboard));
  const treePromise = begin(request, '/admin/members/tree-snapshot').then((value) => requireShape(value, isTreeSnapshot));
  const networkHealthPromise = withTimeout(
    begin(request, '/admin/members/network-health').then((value) => requireShape(value, isNetworkHealth)),
    optionalTimeoutMs,
  );
  const todoPromise = withTimeout(
    begin(request, '/admin/todo').then((value) => requireShape(value, isTodo)),
    optionalTimeoutMs,
  );
  const plansPromise = includePlans
    ? withTimeout(
        begin(request, '/admin/plans').then((value) => requireShape(value, isPlans)),
        optionalTimeoutMs,
      )
    : Promise.resolve(null);
  const recentSalesPromise = includeRecentSales
    ? dashboardPromise.then((dashboard) => withTimeout(
        begin(
          request,
          `/admin/sales?status=approved&summaryMonth=${encodeURIComponent(dashboard.month)}&page=1&pageSize=6`,
        ).then((value) => requireShape(value, isRecentSales)),
        optionalTimeoutMs,
      ))
    : Promise.resolve(null);
  const optionalSettledPromise = Promise.allSettled([
    networkHealthPromise,
    todoPromise,
    plansPromise,
    recentSalesPromise,
  ] as const);

  const [dashboard, tree] = await Promise.allSettled([
    dashboardPromise,
    treePromise,
  ] as const);

  const requiredFailures: ValueFlowRequiredSource[] = [];
  if (dashboard.status === 'rejected') requiredFailures.push('dashboard');
  if (tree.status === 'rejected') requiredFailures.push('tree');
  if (dashboard.status !== 'fulfilled' || tree.status !== 'fulfilled') {
    await optionalSettledPromise;
    throw new RequiredValueFlowSourceError(requiredFailures);
  }

  const treeScope: ValueFlowTreeScope = {
    rootMembershipId: null,
    complete: tree.value.scope.complete,
    total: tree.value.scope.total,
    limit: tree.value.scope.limit,
  };
  onCore?.({ dashboard: dashboard.value, tree: tree.value.items, treeScope });

  const [networkHealth, todo, plans, recentSales] = await optionalSettledPromise;

  const optionalFailures: ValueFlowOptionalSource[] = [];
  if (networkHealth.status === 'rejected') optionalFailures.push('networkHealth');
  if (todo.status === 'rejected') optionalFailures.push('todo');
  if (plans.status === 'rejected') optionalFailures.push('plans');
  if (recentSales.status === 'rejected') optionalFailures.push('recentSales');

  return {
    dashboard: dashboard.value,
    tree: tree.value.items,
    treeScope,
    networkHealth: networkHealth.status === 'fulfilled' ? networkHealth.value : null,
    todo: todo.status === 'fulfilled' ? todo.value : null,
    plans: plans.status === 'fulfilled' ? plans.value : null,
    recentSales: recentSales.status === 'fulfilled' ? recentSales.value : null,
    optionalFailures,
  };
}
