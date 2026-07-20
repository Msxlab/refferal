import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const directory = new URL('./', import.meta.url);

test('/admin/tree defaults to the hierarchy cockpit and keeps Value Flow deliberately gated', async () => {
  const [route, hierarchy] = await Promise.all([
    readFile(new URL('../../../app/admin/tree/page.tsx', directory), 'utf8'),
    readFile(new URL('../network-hierarchy/AdminNetworkHierarchyContent.tsx', directory), 'utf8'),
  ]);
  assert.match(route, /AdminNetworkHierarchyContent/);
  assert.match(route, /financials: can\(s, 'network\.financials\.view'\)/);
  assert.match(route, /<Suspense/);
  assert.match(route, /<AdminNetworkHierarchyContent tenantName={tenantName} valueFlowCapabilities={valueFlowCapabilities} \/>/);
  assert.doesNotMatch(route, /<ReferralValueFlowContent/);
  assert.match(hierarchy, /query\.surface === 'value-flow' && valueFlowCapabilities\.financials/);
  assert.match(hierarchy, /requestedSurface !== 'hierarchy'/);
});

test('the route content dynamically loads the canvas and guards asynchronous refreshes', async () => {
  const source = await readFile(new URL('ReferralValueFlowContent.tsx', directory), 'utf8');
  assert.match(source, /dynamic\(\(\) => import\('\.\/ReferralValueFlowCanvas'\)/);
  assert.match(source, /loading: \(\) => <ValueFlowCanvasSkeleton \/>/);
  assert.match(source, /const requestGeneration = \+\+generation\.current/);
  assert.match(source, /loadValueFlowSources\(\(path\) => api\.get\(path\),\s*{/);
  assert.match(source, /Some supporting evidence is unavailable/);
  assert.match(source, /Hierarchy snapshot limited to/);
  assert.match(source, /Network health scan is partial/);
  assert.match(source, /includePlans: capabilities\.plans/);
  assert.match(source, /Required data could not be loaded/);
  assert.match(source, /Showing the last loaded value flow/);
  assert.doesNotMatch(source, /if \(!workspace \|\| error\)/);
  assert.doesNotMatch(source, /<main className={styles\.primaryPanel}>/);
  assert.match(source, /name="value-flow-search"/);
  assert.match(source, /autoComplete="off"/);
  assert.match(source, /spellCheck={false}/);
  assert.match(source, /prefersTableView = useMediaQuery\('\(max-width: 1180px\)'\)/);
  assert.match(source, /selected: `member:\$\{id\}`/);
  assert.match(source, /const \[searchDraft, setSearchDraft\] = useState\(''\)/);
  assert.doesNotMatch(source, /params\.get\('q'\)|updateQuery\(\{ search:/);
  assert.match(source, /role="status" aria-live="polite"/);
});

test('the interactive graph uses native-button custom nodes and Lucide controls', async () => {
  const [nodeSource, canvasSource] = await Promise.all([
    readFile(new URL('ValueFlowNode.tsx', directory), 'utf8'),
    readFile(new URL('ReferralValueFlowCanvas.tsx', directory), 'utf8'),
  ]);
  assert.match(nodeSource, /<button/);
  assert.match(nodeSource, /nodrag nopan/);
  assert.match(nodeSource, /aria-pressed={selected}/);
  assert.match(canvasSource, /ZoomIn, ZoomOut/);
  assert.match(canvasSource, /prefers-reduced-motion: reduce/);
  assert.match(canvasSource, /markerEnd: edge\.kind === 'rule'/);
  assert.match(canvasSource, /edgesFocusable={false}/);
  assert.match(canvasSource, /minZoom={0\.32}/);
  assert.match(canvasSource, /preventScrolling={false}/);
  assert.match(canvasSource, /zoomOnScroll={false}/);
  assert.match(canvasSource, /onNodeClick={\(_, node\) => onSelect\(node\.id\)}/);
  assert.doesNotMatch(`${nodeSource}\n${canvasSource}`, /<svg|dangerouslySetInnerHTML/);
});

test('responsive table keeps one inspect target and announces filtered results', async () => {
  const source = await readFile(new URL('ReferralHierarchyTable.tsx', directory), 'utf8');
  assert.match(source, /TableCaption/);
  assert.match(source, /aria-selected=/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /const noSaleMembers = members\.filter/);
  assert.match(source, /const searchableMembers = signal === 'no-sale' \? noSaleMembers : members/);
  assert.match(source, /const filtered = searchableMembers\.filter/);
  assert.match(source, /expectedNoSaleCount !== noSaleMembers\.length/);
  assert.match(source, /const searchEmpty = Boolean\(term\)/);
  assert.match(source, /filtered\.slice\(0, 50\)/);
  assert.match(source, /searchEmpty\s*\? 'No members match this search'/);
  assert.match(source, /No members match this loaded snapshot/);
  assert.match(source, /No no-sale members are present in this hierarchy snapshot/);
  assert.match(source, /Network health reports/);
  assert.match(source, /noSaleCountMismatch \|\| filtered\.length > visible\.length/);
  assert.match(source, /Hierarchy data is limited to/);
  assert.doesNotMatch(source, /expectedNoSaleCount > 0/);
  assert.doesNotMatch(source, /ChevronRight|>Inspect</);
});

test('feature styles use the product tokens and retain scoped colors in the portal sheet', async () => {
  const source = await readFile(new URL('value-flow.module.css', directory), 'utf8');
  assert.doesNotMatch(source, /var\(--(?:card|background|foreground|muted-foreground|destructive)\)/);
  assert.match(source, /\.mobileInspector\s*{[^}]*--vf-blue:/s);
  assert.match(source, /:focus-visible\s*{[^}]*outline:\s*\d+px solid var\(--vf-blue\)/s);
  assert.match(source, /@media \(max-width: 900px\)/);
  assert.match(source, /@media \(max-width: 1360px\)/);
  assert.match(source, /@media \(max-width: 640px\)/);
  assert.match(source, /\.tableFrame th:first-child/);
  assert.match(source, /\.canvasFrame\s*{[^}]*min-width:\s*760px/s);
  assert.match(source, /@media \(max-width: 1360px\)[\s\S]*\.liabilityLabel\s*{\s*display:\s*none/);
  assert.match(source, /tabs-trigger[^}]*min-height:\s*44px/);
  assert.match(source, /skeletonInspector\s*{\s*display:\s*none/);
});

test('sale evidence discloses its time scope and ledger state', async () => {
  const source = await readFile(new URL('AttributionEvidencePanel.tsx', directory), 'utf8');
  assert.match(source, /Period-authoritative approvals for/);
  assert.match(source, /ledgerTypeLabel\(line\.type\)/);
  assert.match(source, /line\.status/);
  assert.match(source, /if \(detailRestricted\)/);
  assert.match(source, /record-level evidence is restricted/);
});

test('member evidence includes commission currently locked in a payout', async () => {
  const source = await readFile(new URL('AttributionEvidencePanel.tsx', directory), 'utf8');
  assert.match(source, /commission: \{ pendingCents: string; payableCents: string; processingCents: string; paidCents: string \}/);
  assert.match(source, /<Fact label="In payout" value=\{money\(detail\.stats\.commission\.processingCents, currency\)\} \/>/);
});

test('attention copy distinguishes partial coverage from a complete zero', async () => {
  const source = await readFile(new URL('ValueFlowAttention.tsx', directory), 'utf8');
  assert.match(source, /Partial coverage:/);
  assert.match(source, /No signals were found in the available source/);
  assert.match(source, /\+ known signals/);
});
