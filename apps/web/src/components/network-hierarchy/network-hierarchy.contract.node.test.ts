import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const directory = new URL('./', import.meta.url);

test('anonymous DTO types contain no full identity, raw membership, or exact-money fields', async () => {
  const source = await readFile(new URL('types.ts', directory), 'utf8');
  const start = source.indexOf('interface MemberAnonymousNodeBase');
  const end = source.indexOf('export type MemberAnonymousNode =');
  const anonymousContract = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(anonymousContract, /displayName|fullName|email|referralCode|membershipId|Cents|commission/);
  assert.match(anonymousContract, /nodeRef: OpaqueMemberNodeRef/);
  assert.match(anonymousContract, /parentRef: OpaqueMemberNodeRef/);
  assert.match(anonymousContract, /initials: AnonymousMemberInitials/);
  assert.match(anonymousContract, /performanceBand: MemberPerformanceBand/);
  assert.match(source, /interface MemberAnonymousTier3Node[\s\S]*localTier: 3;[\s\S]*canExpand: false;/);
  assert.match(source, /export function parseOpaqueMemberNodeRef/);
  assert.match(source, /export function parseAnonymousMemberInitials/);
});

test('tree and list use semantic button actions with expansion and keyboard contracts', async () => {
  const [tree, list, css] = await Promise.all([
    readFile(new URL('NetworkHierarchyTree.tsx', directory), 'utf8'),
    readFile(new URL('NetworkHierarchyList.tsx', directory), 'utf8'),
    readFile(new URL('network-hierarchy.module.css', directory), 'utf8'),
  ]);
  for (const source of [tree, list]) {
    assert.match(source, /<button/);
    assert.match(source, /aria-expanded=/);
    assert.match(source, /event\.key === 'ArrowRight'/);
    assert.match(source, /event\.key === 'ArrowLeft'/);
    assert.match(source, /Enter and Space/);
    assert.doesNotMatch(source, /onClick=.*<div/);
  }
  assert.match(tree, /aria-controls=/);
  assert.doesNotMatch(list, /aria-controls=/);
  assert.match(tree, /onKeyDown=\{\(event\) => handleKeyDown\(event, node, key, expandable, expanded\)\}/);
  assert.match(list, /onKeyDown=\{\(event\) => handleKeyDown\(event, index\)\}/);
  assert.match(tree, /<ul/);
  assert.match(tree, /<ul className=\{styles\.treeRoot\} role="tree">/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /content-visibility:\s*auto/);
});

test('the inspector narrows every discriminated node before rendering capability fields', async () => {
  const source = await readFile(new URL('NetworkHierarchyInspector.tsx', directory), 'utf8');
  assert.match(source, /selected\.kind === 'member'/);
  assert.match(source, /selected\.kind === 'cluster'/);
  assert.match(source, /selected\.kind === 'self'/);
  assert.match(source, /selected\.kind === 'direct'/);
  assert.match(source, /selected\.kind === 'anonymous'/);
  assert.match(source, /selected\.performance\.commissionCents != null/);
  assert.match(source, /viewFinancials && selected\.performance/);
  assert.match(source, /selected\.localTier === 3/);
});

test('exact admin performance is not projected without the explicit financial capability', async () => {
  const [model, tree, list] = await Promise.all([
    readFile(new URL('network-hierarchy.model.ts', directory), 'utf8'),
    readFile(new URL('NetworkHierarchyTree.tsx', directory), 'utf8'),
    readFile(new URL('NetworkHierarchyList.tsx', directory), 'utf8'),
  ]);
  assert.match(model, /\{ viewFinancials = false \}/);
  assert.match(model, /viewFinancials && node\.performance/);
  assert.match(tree, /viewFinancials = false/);
  assert.match(list, /viewFinancials = false/);
});

test('value-flow attention navigation applies the explicit value-flow surface', async () => {
  const source = await readFile(new URL('../admin/value-flow/ValueFlowAttention.tsx', directory), 'utf8');
  assert.match(source, /href=\{ensureValueFlowSurfaceHref\(item\.href\)\}/);
});
