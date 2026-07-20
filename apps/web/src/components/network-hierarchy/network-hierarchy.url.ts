export type NetworkHierarchySurface = 'hierarchy' | 'value-flow';
export type NetworkHierarchyScope = 'full' | 'focused';
export type NetworkHierarchyView = 'tree' | 'list';
export type NetworkHierarchyLens = 'people' | 'performance';

export interface AdminNetworkHierarchyQueryState {
  surface: NetworkHierarchySurface;
  scope: NetworkHierarchyScope;
  focus: string | null;
  view: NetworkHierarchyView;
  lens: NetworkHierarchyLens;
  selected: string | null;
}

export interface MemberNetworkHierarchyQueryState {
  view: NetworkHierarchyView;
  lens: NetworkHierarchyLens;
}

const HIERARCHY_REFERENCE = /^[A-Za-z0-9._~-]{1,256}$/;
const ADMIN_OWNED_QUERY_KEYS = [
  'surface',
  'scope',
  'focus',
  'view',
  'lens',
  'selected',
  'tab',
  'signal',
  'q',
  'search',
];
const MEMBER_FORBIDDEN_QUERY_KEYS = ['surface', 'scope', 'focus', 'selected', 'tab', 'signal', 'q', 'search'];

function safeReference(value: string | null): string | null {
  return value && HIERARCHY_REFERENCE.test(value) ? value : null;
}

export function parseNetworkHierarchyQuery(params: URLSearchParams): AdminNetworkHierarchyQueryState {
  const focus = safeReference(params.get('focus'));
  const requestedScope = params.get('scope');
  const scope = requestedScope === 'focused' && focus ? 'focused' : 'full';
  return {
    surface: params.get('surface') === 'value-flow' ? 'value-flow' : 'hierarchy',
    scope,
    focus: scope === 'focused' ? focus : null,
    view: params.get('view') === 'list' ? 'list' : 'tree',
    lens: params.get('lens') === 'performance' ? 'performance' : 'people',
    selected: safeReference(params.get('selected')),
  };
}

export function buildNetworkHierarchyUrl(
  current: URLSearchParams,
  next: Partial<Omit<AdminNetworkHierarchyQueryState, 'surface'>> = {},
): string {
  const merged = { ...parseNetworkHierarchyQuery(current), ...next };
  const requestedFocus = safeReference(merged.focus);
  const scope = merged.scope === 'focused' && requestedFocus ? 'focused' : 'full';
  const params = new URLSearchParams(current);
  for (const key of ADMIN_OWNED_QUERY_KEYS) params.delete(key);

  params.set('surface', 'hierarchy');
  if (scope === 'focused' && requestedFocus) {
    params.set('scope', 'focused');
    params.set('focus', requestedFocus);
  }
  if (merged.view === 'list') params.set('view', 'list');
  if (merged.lens === 'performance') params.set('lens', 'performance');
  const selected = safeReference(merged.selected);
  if (selected) params.set('selected', selected);

  return `/admin/tree?${params.toString()}`;
}

export function buildHierarchySelectionUrl(current: URLSearchParams, selected: string | null): string {
  return buildNetworkHierarchyUrl(current, { selected });
}

export function buildHierarchyFocusUrl(current: URLSearchParams, focus: string): string {
  return buildNetworkHierarchyUrl(current, {
    scope: 'focused',
    focus,
    selected: focus,
  });
}

export function buildWholeNetworkUrl(current: URLSearchParams): string {
  return buildNetworkHierarchyUrl(current, {
    scope: 'full',
    focus: null,
    selected: null,
  });
}

export function parseMemberNetworkHierarchyQuery(params: URLSearchParams): MemberNetworkHierarchyQueryState {
  return {
    view: params.get('view') === 'list' ? 'list' : 'tree',
    lens: params.get('lens') === 'performance' ? 'performance' : 'people',
  };
}

export function buildMemberNetworkHierarchyUrl(
  current: URLSearchParams,
  next: Partial<MemberNetworkHierarchyQueryState>,
): string {
  const merged = { ...parseMemberNetworkHierarchyQuery(current), ...next };
  const params = new URLSearchParams(current);
  for (const key of MEMBER_FORBIDDEN_QUERY_KEYS) params.delete(key);
  params.delete('view');
  params.delete('lens');
  if (merged.view === 'list') params.set('view', 'list');
  if (merged.lens === 'performance') params.set('lens', 'performance');
  const query = params.toString();
  return query ? `/app/team?${query}` : '/app/team';
}
