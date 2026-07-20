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
