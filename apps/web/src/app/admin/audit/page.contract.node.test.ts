import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

test('audit log requests a page size accepted by the server contract', () => {
  assert.match(source, /\/admin\/audit\?page=\$\{page\}&pageSize=100/);
  assert.doesNotMatch(source, /pageSize=120/);
});
