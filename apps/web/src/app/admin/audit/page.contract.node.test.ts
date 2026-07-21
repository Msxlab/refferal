import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../../../components/admin/AuditPageContent.tsx', import.meta.url), 'utf8');

test('audit log requests a page size accepted by the server contract', () => {
  assert.match(source, /p\.set\('page', String\(page\)\); p\.set\('pageSize', '50'\);/);
  assert.match(source, /\/admin\/audit\?\$\{p\.toString\(\)\}/);
});
