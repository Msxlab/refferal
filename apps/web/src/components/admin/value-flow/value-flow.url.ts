export type ValueFlowView = 'network' | 'table';
export type ValueFlowInspectorTab = 'summary' | 'activity';
export type ValueFlowSignal = 'no-sale';

const DEFAULT_VALUE_FLOW_ROUTE_BASE = '/admin/tree';

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
): string {
  const [path, query = ''] = href.split('?', 2);
  if (path !== DEFAULT_VALUE_FLOW_ROUTE_BASE && path !== routeBase) return href;
  const params = new URLSearchParams(query);
  params.set('surface', 'value-flow');
  for (const key of HIERARCHY_ONLY_KEYS) params.delete(key);
  params.delete('q');
  params.delete('search');
  const targetRouteBase = path === DEFAULT_VALUE_FLOW_ROUTE_BASE ? routeBase : path;
  return `${targetRouteBase}?${params.toString()}`;
}
