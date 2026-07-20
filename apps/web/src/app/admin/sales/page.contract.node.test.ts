import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../../../components/admin/SalesPageContent.tsx', import.meta.url), 'utf8');

test('sales ledger passes its current page to the API and renders page navigation', () => {
  assert.match(source, /p\.set\('page', String\(page\)\); p\.set\('pageSize', String\(pageSize\)\);/);
  assert.match(source, /\/admin\/sales\?\$\{listQuery\}/);
  assert.match(source, /<Pagination page=\{list\.page\} pageSize=\{list\.pageSize\} total=\{list\.total\} onPage=\{setPage\} \/>/);
});
