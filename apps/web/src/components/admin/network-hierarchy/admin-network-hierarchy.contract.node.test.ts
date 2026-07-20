import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const directory = new URL('./', import.meta.url);

async function sources() {
  const [content, search, toolbar, hq, adapter, route, css, valueFlow, attention, evidence] = await Promise.all([
    readFile(new URL('AdminNetworkHierarchyContent.tsx', directory), 'utf8'),
    readFile(new URL('AdminNetworkSearch.tsx', directory), 'utf8'),
    readFile(new URL('AdminNetworkToolbar.tsx', directory), 'utf8'),
    readFile(new URL('../../../app/hq/c/[id]/tree/page.tsx', directory), 'utf8'),
    readFile(new URL('../TreePageContent.tsx', directory), 'utf8'),
    readFile(new URL('../../../app/admin/tree/page.tsx', directory), 'utf8'),
    readFile(new URL('admin-network-hierarchy.module.css', directory), 'utf8'),
    readFile(new URL('../value-flow/ReferralValueFlowContent.tsx', directory), 'utf8'),
    readFile(new URL('../value-flow/ValueFlowAttention.tsx', directory), 'utf8'),
    readFile(new URL('../value-flow/AttributionEvidencePanel.tsx', directory), 'utf8'),
  ]);
  return { content, search, toolbar, hq, adapter, route, css, valueFlow, attention, evidence };
}

test('admin hierarchy uses the bounded context and branch endpoints rather than legacy tree snapshots', async () => {
  const { content, adapter, hq, route } = await sources();
  for (const source of [content, adapter, hq, route]) {
    assert.doesNotMatch(source, /NetworkExplorer|\/admin\/members\/tree|tree-snapshot/);
  }
  assert.match(content, /\/admin\/members\/network-context/);
  assert.match(content, /scope: query\.scope/);
  assert.match(content, /depth: '3'/);
  assert.match(content, /\/admin\/members\/network-children/);
  assert.match(content, /\/admin\/members\/network-cluster-children/);
  assert.match(content, /\/admin\/members\/network-list/);
  assert.match(content, /<NetworkHierarchyTree/);
  assert.match(content, /<NetworkHierarchyList/);
  assert.match(content, /<NetworkHierarchyInspector/);
});

test('search stays ephemeral and uses only the POST body contract', async () => {
  const { search } = await sources();
  assert.match(search, /api\.post<SearchPage>\('\/admin\/members\/network-search', \{/);
  assert.match(search, /query,/);
  assert.match(search, /window\.setTimeout/);
  assert.match(search, /autoComplete="off"/);
  assert.doesNotMatch(search, /network-search\?|useSearchParams|useRouter|localStorage|sessionStorage/);
});

test('selection and explicit local-root focus use distinct hierarchy URL actions', async () => {
  const { content } = await sources();
  assert.match(content, /buildHierarchySelectionUrl\(currentParams\(\), key, routeBase\)/);
  assert.match(content, /buildHierarchyFocusUrl\(currentParams\(\), membershipId, routeBase\)/);
  assert.match(content, /buildWholeNetworkUrl\(currentParams\(\), routeBase\)/);
  assert.match(content, /const focusBranch = useCallback/);
  assert.match(content, /Local Tier 1 root/);
});

test('snapshot expiration is reloaded and server capabilities gate financial and member actions', async () => {
  const { content, toolbar } = await sources();
  assert.match(content, /NETWORK_SNAPSHOT_EXPIRED/);
  assert.match(content, /reloadExpiredSnapshot\(\)/);
  assert.match(content, /context\.capabilities\.viewFinancials/);
  assert.match(content, /context\.capabilities\.openMember \? openMember : undefined/);
  assert.match(content, /context\.capabilities\.focusBranch \? focusBranch : undefined/);
  assert.match(toolbar, /\{canViewFinancials \? \(/);
  assert.match(toolbar, /Performance/);
});

test('cockpit communicates exact loaded and collapsed scope plus the lineage signal rail', async () => {
  const { content, css } = await sources();
  assert.match(content, /const loadedMembers = activeNodes\.filter\(\(node\) => node\.kind === 'member'\)\.length/);
  assert.match(content, /Loaded \$\{loadedMembers\} of \$\{context\.scope\.totalNodes\}/);
  assert.match(content, /const collapsedBranches = treeNodes\.filter\(\(node\) => node\.kind === 'cluster'\)\.length/);
  assert.match(content, /Company root/);
  assert.match(content, /context\.ancestors/);
  assert.match(css, /\.lineageRail/);
  assert.match(css, /\.lineageSteps::before/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('cluster expansion replaces its bounded marker and the HQ entry point is a shared adapter', async () => {
  const { content, hq, adapter, route } = await sources();
  assert.match(content, /node\.kind === 'cluster'/);
  assert.match(content, /clusterRef: node\.clusterRef/);
  assert.match(content, /withoutExpandedCluster/);
  assert.match(content, /setListNodes\(\(current\) => \(current\.length > 0 \? mergeBranchPage\(current\) : current\)\)/);
  assert.match(hq, /TreePageContent/);
  assert.match(adapter, /AdminNetworkHierarchyContent/);
  assert.match(route, /AdminNetworkHierarchyContent/);
});

test('HQ actions remain under the active company hierarchy route', async () => {
  const { content, hq, adapter, valueFlow, attention, evidence } = await sources();
  assert.match(hq, /routeBase=\{`\/hq\/c\/\$\{id\}\/tree`\}/);
  assert.match(hq, /memberRouteBase=\{`\/hq\/c\/\$\{id\}\/members`\}/);
  assert.match(hq, /companyRouteBase=\{`\/hq\/c\/\$\{id\}`\}/);
  assert.match(adapter, /routeBase=\{routeBase\}/);
  assert.match(adapter, /memberRouteBase=\{memberRouteBase\}/);
  assert.match(adapter, /companyRouteBase=\{companyRouteBase\}/);
  assert.match(content, /buildNetworkHierarchyUrl\(currentParams\(\), \{ view \}, routeBase\)/);
  assert.match(content, /buildNetworkHierarchyUrl\(currentParams\(\), \{ lens \}, routeBase\)/);
  assert.match(content, /buildHierarchySelectionUrl\(currentParams\(\), key, routeBase\)/);
  assert.match(content, /buildHierarchyFocusUrl\(currentParams\(\), membershipId, routeBase\)/);
  assert.match(content, /buildWholeNetworkUrl\(currentParams\(\), routeBase\)/);
  assert.match(content, /buildValueFlowUrl\(currentParams\(\), \{\}, routeBase\)/);
  assert.match(content, /companyRouteBase=\{companyRouteBase\}/);
  assert.match(valueFlow, /buildValueFlowUrl\(new URLSearchParams\(searchParams\.toString\(\)\), next, routeBase\)/);
  assert.match(valueFlow, /createValueFlowHrefResolver\(routeBase, companyRouteBase\)/);
  assert.equal((valueFlow.match(/resolveHref=\{resolveHref\}/g) ?? []).length, 3);
  assert.match(attention, /resolveHref \? items\.map\(\(item\) => \(\{ \.\.\.item, href: resolveHref\(item\.href\) \}\)\) : items/);
  assert.match(attention, /href=\{ensureValueFlowSurfaceHref\(item\.href\)\}/);
  assert.match(evidence, /href=\{resolveHref\('\/admin\/sales'\)\}/);
});
