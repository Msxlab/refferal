import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

test('member management keeps server pagination in its request and exposes page navigation', () => {
  assert.match(source, /\/admin\/members\?page=\$\{page\}&pageSize=100/);
  assert.match(source, /Page \{list\.page\} of \{pageCount\}/);
  assert.match(source, /setPage\(\(current\) => Math\.min\(pageCount, current \+ 1\)\)/);
});
