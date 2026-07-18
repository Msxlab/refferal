import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

test('sales ledger passes its current page to the API and renders page navigation', () => {
  assert.match(source, /new URLSearchParams\(\{ page: String\(page\), pageSize: '50' \}\)/);
  assert.match(source, /Page \{list\.page\} of \{pageCount\}/);
  assert.match(source, /setPage\(\(current\) => Math\.min\(pageCount, current \+ 1\)\)/);
});
