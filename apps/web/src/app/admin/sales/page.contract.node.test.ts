import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const pageSource = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const hqPageSource = readFileSync(new URL('../../hq/c/[id]/sales/page.tsx', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../../components/admin/SalesPageContent.tsx', import.meta.url), 'utf8');

test('sales ledger passes its current page to the API and renders page navigation', () => {
  assert.match(source, /p\.set\('page', String\(page\)\); p\.set\('pageSize', String\(pageSize\)\);/);
  assert.match(source, /\/admin\/sales\?\$\{listQuery\}/);
  assert.match(source, /<Pagination page=\{list\.page\} pageSize=\{list\.pageSize\} total=\{list\.total\} onPage=\{setPage\} \/>/);
});

test('sales mutations are gated by the permission and role tier required by the API', () => {
  for (const wrapper of [pageSource, hqPageSource]) {
    assert.match(wrapper, /salesCreate: canForTenantRoles\(s, 'sales\.create', TENANT_STAFF_ROLES\)/);
    assert.match(wrapper, /salesImport: canForTenantRoles\(s, 'sales\.import', TENANT_STAFF_ROLES\)/);
    assert.match(wrapper, /salesExport: canForTenantRoles\(s, 'sales\.export', TENANT_STAFF_ROLES\)/);
    assert.match(wrapper, /salesApprove: canForTenantRoles\(s, 'sales\.approve', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /salesVoid: canForTenantRoles\(s, 'sales\.void', TENANT_ADMIN_ROLES\)/);
  }
  assert.match(pageSource, /<SalesPageContent tenantName=\{tenantName\} capabilities=\{capabilities\} \/>/);
  assert.match(source, /disabled=\{!capabilities\.salesCreate\}[\s\S]*?New sale/);
  assert.match(source, /disabled=\{!capabilities\.salesImport\}[\s\S]*?Import/);
  assert.match(source, /disabled=\{!capabilities\.salesExport\}[\s\S]*?Export CSV/);
  assert.match(source, /capabilities\.salesExport \? 'Export sales as CSV' : 'Requires sales export permission'/);
  assert.match(source, /if \(!capabilities\.salesCreate\) \{ setError\('Sales creation permission is required\.'/);
  assert.match(source, /if \(!capabilities\.salesApprove\) \{ setError\('Sales approval permission is required\.'/);
  assert.match(source, /!capabilities\.salesVoid\) \{ setError\('Sales void permission is required\.'/);
  assert.match(source, /capabilities\.salesApprove && s\.status === 'draft'/);
  assert.match(source, /capabilities\.salesVoid && s\.status === 'draft'/);
  assert.match(source, /<SaleDrawer[\s\S]*?capabilities=\{capabilities\}/);
});

test('bulk approve and void use the reviewed API contract and unsupported bulk actions are absent', () => {
  assert.match(source, /api\.post<BulkPreview>\('\/admin\/sales\/bulk\/preview', \{ action, scope \}\)/);
  assert.match(source, /idempotencyKey: crypto\.randomUUID\(\)/);
  const confirmCallStart = source.indexOf("'/admin/sales/bulk'");
  assert.notEqual(confirmCallStart, -1);
  const confirmCall = source.slice(confirmCallStart, confirmCallStart + 240);
  assert.match(confirmCall, /\{ scope: p\.scope, previewToken: p\.previewToken \}/);
  assert.match(confirmCall, /\{ 'Idempotency-Key': p\.idempotencyKey \}/);
  assert.match(source, /api\.post\(`\/admin\/sales\/\$\{id\}\/deliver`, \{\}\)/);

  const bulkBarStart = source.indexOf('<div className="bulkbar no-print">');
  const bulkBarEnd = source.indexOf('</div>', bulkBarStart);
  assert.notEqual(bulkBarStart, -1);
  assert.notEqual(bulkBarEnd, -1);
  const bulkBar = source.slice(bulkBarStart, bulkBarEnd);
  assert.match(bulkBar, /Approve/);
  assert.match(bulkBar, /Void/);
  assert.doesNotMatch(bulkBar, /Deliver|Delete/);
  assert.doesNotMatch(source, /selDeliverable/);
});

test('permission-disabled sales controls expose their reason to keyboard and assistive technology', () => {
  assert.match(source, /function PermissionHint[\s\S]*?tabIndex=\{0\}[\s\S]*?aria-describedby=\{reasonId\}/);
  assert.match(source, /<PermissionHint allowed=\{capabilities\.salesCreate\} reason="Requires sales creation permission">[\s\S]*?New sale/);
  assert.match(source, /<PermissionHint allowed=\{capabilities\.salesApprove\} reason="Requires sales approval permission">[\s\S]*?Approve/);
  assert.match(source, /<PermissionHint allowed=\{capabilities\.salesVoid\} reason="Requires sales void permission">[\s\S]*?Void/);
});
