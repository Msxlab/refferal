export type ValueFlowView = 'network' | 'table';
export type ValueFlowInspectorTab = 'summary' | 'activity';
export type ValueFlowSignal = 'no-sale';

const DEFAULT_VALUE_FLOW_ROUTE_BASE = '/admin/tree';
const COMPANY_ADMIN_ROUTE_SEGMENTS = new Set([
  'audit',
  'campaigns',
  'checks',
  'members',
  'payouts',
  'periods',
  'sales',
  'settings',
  'tree',
]);
const COMPANY_ROUTE_BASE = /^\/hq\/c\/[^/?#]+$/;

export type ValueFlowHrefResolver = (href: string) => string;

export interface ValueFlowQueryState {
  view: ValueFlowView;
  selected: string | null;
  tab: ValueFlowInspectorTab;
  signal: ValueFlowSignal | null;
}

const SELECTION = /^(?:member|sale|source|stage|rule|liability):[A-Za-z0-9._~-]+$/;
const HIERARCHY_ONLY_KEYS = ['scope', 'focus', 'lens'];

export function parseValueFlowQuery(params: URLSearchParams): ValueFlowQueryState {
  const view = params.get('view');
  const tab = params.get('tab');
  const selected = params.get('selected');
  return {
    view: view === 'table' ? 'table' : 'network',
    selected: selected && SELECTION.test(selected) ? selected : null,
    tab: tab === 'activity' ? 'activity' : 'summary',
    signal: params.get('signal') === 'no-sale' ? 'no-sale' : null,
  };
}

export function buildValueFlowUrl(
  current: URLSearchParams,
  next: Partial<ValueFlowQueryState>,
  routeBase = DEFAULT_VALUE_FLOW_ROUTE_BASE,
): string {
  const merged = { ...parseValueFlowQuery(current), ...next };
  const params = new URLSearchParams(current);
  params.set('surface', 'value-flow');
  for (const key of HIERARCHY_ONLY_KEYS) params.delete(key);
  params.delete('view');
  params.delete('q');
  params.delete('search');
  params.delete('selected');
  params.delete('tab');
  params.delete('signal');

  const preserveExplicitNetwork = next.view === 'network'
    || (next.view === undefined && current.get('view') === 'network');
  if (merged.view !== 'network' || preserveExplicitNetwork) params.set('view', merged.view);
  if (merged.selected && SELECTION.test(merged.selected)) params.set('selected', merged.selected);
  if (merged.tab !== 'summary') params.set('tab', merged.tab);
  if (merged.signal) params.set('signal', merged.signal);

  const query = params.toString();
  return query ? `${routeBase}?${query}` : routeBase;
}

export function ensureValueFlowSurfaceHref(
  href: string,
  routeBase = DEFAULT_VALUE_FLOW_ROUTE_BASE,
  companyRouteBase?: string,
): string {
  const hashIndex = href.indexOf('#');
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
  const pathAndQuery = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const queryIndex = pathAndQuery.indexOf('?');
  const path = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : pathAndQuery.slice(queryIndex + 1);
  if (path !== DEFAULT_VALUE_FLOW_ROUTE_BASE && path !== routeBase) {
    return resolveInternalAdminHref(href, companyRouteBase);
  }
  const params = new URLSearchParams(query);
  params.set('surface', 'value-flow');
  for (const key of HIERARCHY_ONLY_KEYS) params.delete(key);
  params.delete('q');
  params.delete('search');
  const targetRouteBase = path === DEFAULT_VALUE_FLOW_ROUTE_BASE ? routeBase : path;
  return `${targetRouteBase}?${params.toString()}${hash}`;
}

/** Rebase only routes that have an equivalent active-company HQ page. */
export function resolveInternalAdminHref(href: string, companyRouteBase?: string): string {
  if (!companyRouteBase || !COMPANY_ROUTE_BASE.test(companyRouteBase)) return href;
  const match = href.match(/^\/admin\/([a-z-]+)(?=[?#]|$)/);
  if (!match || !COMPANY_ADMIN_ROUTE_SEGMENTS.has(match[1])) return href;
  return `${companyRouteBase}${href.slice('/admin'.length)}`;
}

export function createValueFlowHrefResolver(
  routeBase = DEFAULT_VALUE_FLOW_ROUTE_BASE,
  companyRouteBase?: string,
): ValueFlowHrefResolver {
  return (href) => ensureValueFlowSurfaceHref(href, routeBase, companyRouteBase);
}
