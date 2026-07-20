import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../../../components/admin/MembersPageContent.tsx', import.meta.url), 'utf8');

test('member management keeps server pagination in its request and exposes page navigation', () => {
  assert.match(source, /p\.set\('sort', sort\); p\.set\('dir', dir\); p\.set\('page', String\(page\)\); p\.set\('pageSize', '25'\);/);
  assert.match(source, /\/admin\/members\?\$\{p\.toString\(\)\}/);
  assert.match(source, /<Pagination page=\{list\.page\} pageSize=\{list\.pageSize\} total=\{list\.total\} onPage=\{setPage\} \/>/);
});
