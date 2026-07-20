import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHierarchyFocusUrl,
  buildHierarchySelectionUrl,
  buildMemberNetworkHierarchyUrl,
  buildNetworkHierarchyUrl,
  parseNetworkHierarchyQuery,
  // @ts-expect-error Node's native TypeScript runner requires an explicit extension.
} from './network-hierarchy.url.ts';
// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { ensureValueFlowSurfaceHref } from '../admin/value-flow/value-flow.url.ts';

test('an empty admin URL defaults to the hierarchy surface', () => {
  assert.deepEqual(parseNetworkHierarchyQuery(new URLSearchParams()), {
    surface: 'hierarchy',
    scope: 'full',
    focus: null,
    view: 'tree',
    lens: 'people',
    selected: null,
  });
});

test('hierarchy builders make the surface deliberate and remove URL search text', () => {
  const url = buildNetworkHierarchyUrl(
    new URLSearchParams('surface=value-flow&q=private&signal=no-sale&campaign=summer'),
    { view: 'list', lens: 'performance' },
  );
  const parsed = new URL(url, 'https://example.test');

  assert.equal(parsed.pathname, '/admin/tree');
  assert.equal(parsed.searchParams.get('surface'), 'hierarchy');
  assert.equal(parsed.searchParams.get('view'), 'list');
  assert.equal(parsed.searchParams.get('lens'), 'performance');
  assert.equal(parsed.searchParams.get('campaign'), 'summer');
  assert.equal(parsed.searchParams.has('signal'), false);
  assert.equal(parsed.searchParams.has('q'), false);
});

test('selection and focus cannot collide with value-flow selections', () => {
  const focused = buildHierarchyFocusUrl(
    new URLSearchParams('surface=value-flow&selected=stage%3Aqualified-sales&view=network'),
    'member-42',
  );
  assert.equal(focused, '/admin/tree?surface=hierarchy&scope=focused&focus=member-42&selected=member-42');

  const selected = buildHierarchySelectionUrl(new URLSearchParams(focused.split('?')[1]), 'member-99');
  assert.equal(selected, '/admin/tree?surface=hierarchy&scope=focused&focus=member-42&selected=member-99');
});

test('member URLs keep selection, tenant search, and arbitrary focus out of the address bar', () => {
  assert.equal(
    buildMemberNetworkHierarchyUrl(
      new URLSearchParams('q=private&focus=other-member&selected=secret&campaign=summer'),
      { view: 'list', lens: 'performance' },
    ),
    '/app/team?campaign=summer&view=list&lens=performance',
  );
});

test('value-flow attention links always carry an explicit value-flow surface', () => {
  assert.equal(
    ensureValueFlowSurfaceHref('/admin/tree?view=table&q=private&signal=no-sale'),
    '/admin/tree?view=table&signal=no-sale&surface=value-flow',
  );
  assert.equal(ensureValueFlowSurfaceHref('/admin/sales?status=draft'), '/admin/sales?status=draft');
});
