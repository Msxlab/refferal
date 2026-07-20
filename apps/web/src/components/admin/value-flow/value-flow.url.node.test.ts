import assert from 'node:assert/strict';
import { test } from 'node:test';

// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { buildValueFlowUrl, parseValueFlowQuery } from './value-flow.url.ts';

test('parses supported view, search, selection, and inspector tab values', () => {
  assert.deepEqual(
    parseValueFlowQuery(new URLSearchParams('view=table&q=Jordan&selected=member%3Aabc&tab=activity&signal=no-sale')),
    { view: 'table', search: 'Jordan', selected: 'member:abc', tab: 'activity', signal: 'no-sale' },
  );
});

test('falls back safely for unsupported values and rejects malformed selections', () => {
  assert.deepEqual(
    parseValueFlowQuery(new URLSearchParams('view=grid&q=%20%20&selected=javascript%3Aalert(1)&tab=edit&signal=unknown')),
    { view: 'network', search: '', selected: null, tab: 'summary', signal: null },
  );
});

test('builds a stable URL while preserving unrelated query state', () => {
  const url = buildValueFlowUrl(
    new URLSearchParams('signal=no-sale&view=table&q=old&selected=member%3Aold&tab=activity'),
    { view: 'network', search: '  Morgan  ', selected: 'sale:sale-1', tab: 'summary' },
  );

  assert.equal(url, '/admin/tree?view=network&q=Morgan&selected=sale%3Asale-1&signal=no-sale');
});

test('preserves an explicit mobile network view across selection updates', () => {
  const url = buildValueFlowUrl(
    new URLSearchParams('view=network'),
    { selected: 'stage:qualified-sales' },
  );

  assert.equal(url, '/admin/tree?view=network&selected=stage%3Aqualified-sales');
});

test('can explicitly clear an attention signal from the URL', () => {
  const url = buildValueFlowUrl(
    new URLSearchParams('view=table&signal=no-sale'),
    { signal: null },
  );

  assert.equal(url, '/admin/tree?view=table');
});
