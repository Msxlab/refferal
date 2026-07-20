import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('mobile team outline consumes only the privacy-safe member tree and stops at Tier 3', () => {
  const screen = readFileSync(new URL('../app/(tabs)/team.tsx', import.meta.url), 'utf8');
  const outline = readFileSync(new URL('../src/components/MemberNetworkOutline.tsx', import.meta.url), 'utf8');
  const adapter = readFileSync(new URL('../src/lib/member-network.ts', import.meta.url), 'utf8');

  assert.match(screen, /api\.get<unknown>\('\/app\/team\/tree'\)/);
  assert.match(screen, /\/app\/team\/tree\/children\?/);
  assert.match(screen, /api\.post<unknown>\(\s*'\/app\/team\/tree\/direct-search'/);
  assert.match(screen, /cursor \? \{ query, cursor \} : \{ query \}/);
  assert.doesNotMatch(screen, /\/app\/team\/tree\/direct-search\?/);
  assert.doesNotMatch(`${screen}\n${outline}`, /AsyncStorage|localStorage/);
  assert.doesNotMatch(screen, /api\.get<Team>\('\/app\/team'\)/);
  assert.match(screen, /<MemberNetworkOutline/);
  assert.match(screen, /const snapshotGeneration = useRef\(0\)/);
  assert.match(screen, /snapshotGeneration\.current !== generation/);

  assert.match(outline, /const terminal = node\.kind === 'anonymous' && node\.localTier === 3/);
  const terminalBlock = outline.slice(outline.indexOf('if (terminal) {'), outline.indexOf('if (!expandable) {'));
  assert.match(terminalBlock, /<View accessibilityLabel=/);
  assert.doesNotMatch(terminalBlock, /Pressable|accessibilityRole|accessibilityState|onPress/);
  assert.match(outline, /accessibilityState=\{\{ expanded, busy \}\}/);

  assert.match(adapter, /typeof decode !== 'function' \|\| typeof encode !== 'function'\) return true/);
  assert.match(adapter, /only\(selfPerformance, \['currency', 'period', 'visibleApprovedSales', 'visibleTeamVolumeCents'\], 'self\.performance'\)/);
  assert.match(adapter, /ISO_MONTH\.test\(requiredString\(selfPerformance\.period/);
  assert.match(adapter, /only\(candidate, \['items', 'nextCursor', 'snapshotAt'\], 'directSearch'\)/);
  assert.match(adapter, /if \(parsed\.kind !== 'direct'\) invalid\('directSearch\.items'\)/);
  assert.doesNotMatch(`${screen}\n${outline}\n${adapter}`, /Tier 4/);
});

test('mobile direct-search pagination stays bound to its applied query and first snapshot', () => {
  const screen = readFileSync(new URL('../app/(tabs)/team.tsx', import.meta.url), 'utf8');
  const draftUpdate = screen.slice(screen.indexOf('const updateSearchDraft'), screen.indexOf('const submitDirectSearch'));
  const invalidation = screen.slice(screen.indexOf('const invalidateDirectSearch'), screen.indexOf('const load'));
  const directSearch = screen.slice(screen.indexOf('const submitDirectSearch'), screen.indexOf('const clearDirectSearch'));

  assert.match(screen, /const \[appliedSearchQuery, setAppliedSearchQuery\] = useState<string \| null>\(null\)/);
  assert.match(screen, /const \[searchSnapshotAt, setSearchSnapshotAt\] = useState<string \| null>\(null\)/);
  assert.match(draftUpdate, /invalidateDirectSearch\(\)/);
  assert.match(invalidation, /searchRequestGeneration\.current \+= 1/);
  assert.match(invalidation, /setSearchCursor\(null\)/);
  assert.match(invalidation, /setAppliedSearchQuery\(null\)/);
  assert.match(invalidation, /setSearchSnapshotAt\(null\)/);
  assert.match(directSearch, /const expectedSnapshot = cursor \? searchSnapshotAt \?\? undefined : undefined/);
  assert.match(directSearch, /if \(cursor && \(!expectedSnapshot \|\| appliedSearchQuery !== query\)\)/);
  assert.match(directSearch, /parseMemberDirectSearchPage\([\s\S]*?expectedSnapshot,\s*\)/);
  assert.match(directSearch, /setAppliedSearchQuery\(query\)/);
  assert.match(directSearch, /setSearchSnapshotAt\(page\.snapshotAt\)/);
  assert.match(directSearch, /reason instanceof MemberNetworkSnapshotMismatchError/);
  assert.match(directSearch, /await load\(\)/);
});
