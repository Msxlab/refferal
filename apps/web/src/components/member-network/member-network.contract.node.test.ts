import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const directory = new URL('./', import.meta.url);

test('member Focus Tree calls only privacy-safe hierarchy routes and keeps search out of URLs', async () => {
  const source = await readFile(new URL('MemberNetworkTreeContent.tsx', directory), 'utf8');
  const adapter = await readFile(new URL('member-network.adapter.ts', directory), 'utf8');

  assert.match(source, /api\s*\.\s*get<unknown>\('\/app\/team\/tree'\)/);
  assert.match(source, /\/app\/team\/tree\/children\?/);
  assert.match(source, /api\.post<unknown>\('\/app\/team\/tree\/direct-search'/);
  assert.match(source, /Load more Tier 1 members/);
  assert.doesNotMatch(source, /\/app\/team\/recruits/);
  assert.doesNotMatch(source, /api\s*\.\s*(?:get|post)<[^>]*>\('\/app\/team'\)/);
  assert.doesNotMatch(source, /Tier 4/);
  assert.match(source, /buildMemberNetworkHierarchyUrl/);
  assert.match(source, /requestGeneration\.current !== generation/);
  assert.doesNotMatch(source, /as OpaqueMemberNodeRef/);
  assert.match(adapter, /parseOpaqueMemberNodeRef/);
  assert.match(adapter, /parseAnonymousMemberInitials/);
  assert.doesNotMatch(adapter, /as OpaqueMemberNodeRef/);
  assert.match(adapter, /exactlyKeys\(candidate, \['items', 'nextCursor', 'snapshotAt'\], 'directSearch'\)/);
});

test('member error boundary isolates a malformed network payload instead of replacing the app shell', async () => {
  const source = await readFile(new URL('MemberNetworkErrorBoundary.tsx', directory), 'utf8');
  assert.match(source, /getDerivedStateFromError/);
  assert.match(source, /Try again/);
  assert.match(source, /children: ReactNode/);
  assert.match(source, /retryVersion/);
  assert.match(source, /<Fragment key=\{this\.state\.retryVersion\}>/);
  assert.match(source, /retryVersion: state\.retryVersion \+ 1/);
});

test('member page no longer renders the legacy radial network or direct-recruit response', async () => {
  const page = await readFile(new URL('../../app/app/team/page.tsx', directory), 'utf8');
  assert.match(page, /MemberNetworkTreeContent/);
  assert.match(page, /MemberNetworkErrorBoundary/);
  assert.doesNotMatch(page, /RadialNetwork/);
  assert.doesNotMatch(page, /team\/recruits/);
});

test('member Focus Tree binds direct-search cursors to the applied query and first snapshot', async () => {
  const source = await readFile(new URL('MemberNetworkTreeContent.tsx', directory), 'utf8');
  const draftUpdate = source.slice(source.indexOf('const updateSearchDraft'), source.indexOf('const submitSearch'));
  const invalidation = source.slice(source.indexOf('const invalidateDirectSearch'), source.indexOf('const refreshSnapshot'));
  const directSearch = source.slice(source.indexOf('const submitSearch'), source.indexOf('if (loading && !context)'));

  assert.match(source, /const \[appliedSearchQuery, setAppliedSearchQuery\] = useState<string \| null>\(null\)/);
  assert.match(source, /const \[searchSnapshotAt, setSearchSnapshotAt\] = useState<string \| null>\(null\)/);
  assert.match(draftUpdate, /invalidateDirectSearch\(\)/);
  assert.match(invalidation, /searchRequestGeneration\.current \+= 1/);
  assert.match(invalidation, /setSearchCursor\(null\)/);
  assert.match(invalidation, /setAppliedSearchQuery\(null\)/);
  assert.match(invalidation, /setSearchSnapshotAt\(null\)/);
  assert.match(directSearch, /const expectedSnapshot = cursor \? searchSnapshotAt \?\? undefined : undefined/);
  assert.match(directSearch, /if \(cursor && \(!expectedSnapshot \|\| appliedSearchQuery !== queryText\)\)/);
  assert.match(directSearch, /parseMemberDirectSearchPage\(raw, expectedSnapshot\)/);
  assert.match(directSearch, /setAppliedSearchQuery\(queryText\)/);
  assert.match(directSearch, /setSearchSnapshotAt\(page\.snapshotAt\)/);
  assert.match(directSearch, /reason instanceof MemberNetworkSnapshotMismatchError/);
  assert.match(directSearch, /refreshSnapshot\(\)/);
});
