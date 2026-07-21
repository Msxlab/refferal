import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const pageSource = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const hqPageSource = readFileSync(new URL('../../hq/c/[id]/payouts/page.tsx', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../../components/admin/PayoutsPageContent.tsx', import.meta.url), 'utf8');
const permissionSource = readFileSync(new URL('../../../../../api/src/common/permissions.ts', import.meta.url), 'utf8');

test('both payout wrappers mirror the API role tier and each fine-grained capability they use', () => {
  for (const wrapper of [pageSource, hqPageSource]) {
    assert.match(wrapper, /payoutsView: canForTenantRoles\(s, 'payouts\.view', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /payoutsProcess: canForTenantRoles\(s, 'payouts\.process', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /payoutsExport: canForTenantRoles\(s, 'payouts\.export', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /complianceView: canForTenantRoles\(s, 'compliance\.view', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /complianceReview: canForTenantRoles\(s, 'compliance\.review', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /reportsView: canForTenantRoles\(s, 'reports\.view', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /reportsExport: canForTenantRoles\(s, 'reports\.export', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /<PayoutsPageContent[^>]*capabilities=\{capabilities\}/);
  }
});

test('Finance payout reads remain independent from compliance reads', () => {
  const financeStart = permissionSource.indexOf("key: 'finance'");
  const supportStart = permissionSource.indexOf("key: 'support'", financeStart);
  assert.notEqual(financeStart, -1);
  assert.notEqual(supportStart, -1);
  const financeRole = permissionSource.slice(financeStart, supportStart);
  assert.match(financeRole, /'payouts\.view'/);
  assert.match(financeRole, /'payouts\.process'/);
  assert.match(financeRole, /'payouts\.export'/);
  assert.match(financeRole, /'reports\.view'/);
  assert.match(financeRole, /'reports\.export'/);
  assert.doesNotMatch(financeRole, /'compliance\.view'|'compliance\.review'/);

  const coreStart = source.indexOf('const loadCore = useCallback');
  const complianceStart = source.indexOf('const loadCompliance = useCallback');
  assert.notEqual(coreStart, -1);
  assert.notEqual(complianceStart, -1);
  const coreLoader = source.slice(coreStart, complianceStart);
  assert.match(coreLoader, /\/admin\/payouts\/payable/);
  assert.match(coreLoader, /\/admin\/payouts\?status=requested/);
  assert.doesNotMatch(coreLoader, /payout-profiles|admin\/fraud/);
  assert.match(coreLoader, /if \(capabilities\.reportsView\) \{[\s\S]*?\/admin\/clawbacks/);

  const complianceLoader = source.slice(complianceStart, source.indexOf('const loadHistory', complianceStart));
  assert.match(complianceLoader, /if \(!capabilities\.complianceView\)/);
  assert.match(complianceLoader, /\/admin\/payout-profiles\?status=pending_review/);
  assert.match(complianceLoader, /\/admin\/fraud\?status=open/);
});

test('payout and compliance mutation controls are hidden without their exact capabilities', () => {
  assert.match(source, /if \(!capabilities\.payoutsProcess\) \{ setError\('Payout processing permission is required\.'/);
  assert.match(source, /if \(!capabilities\.complianceReview\) \{ setError\('Compliance review permission is required\.'/);
  assert.match(source, /capabilities\.complianceView && fraud\.length > 0/);
  assert.match(source, /capabilities\.complianceView && kyc\.length > 0/);
  assert.match(source, /capabilities\.complianceReview \? \(/);
  assert.match(source, /capabilities\.payoutsProcess \? \(/);
  assert.match(source, /<PayoutDrawer[\s\S]*?canProcess=\{capabilities\.payoutsProcess\}/);
});

test('export and report sources are hidden and guarded by their exact capabilities', () => {
  assert.match(source, /async function downloadExport\(\) \{\s*if \(!capabilities\.payoutsExport\)/);
  assert.match(source, /async function downloadAch\(\) \{\s*if \(!capabilities\.payoutsExport\)/);
  assert.match(source, /async function downloadTaxForm\(\) \{\s*if \(!capabilities\.reportsExport\)/);
  assert.match(source, /capabilities\.payoutsExport \? \([\s\S]*?payouts\.export/);
  assert.match(source, /capabilities\.payoutsExport \? \([\s\S]*?ACH file/);
  assert.match(source, /capabilities\.reportsExport \? \([\s\S]*?1099-NEC/);
  assert.match(source, /capabilities\.reportsView && clawbacks/);
});

test('payout mutations follow the reviewed settlement lifecycle', () => {
  assert.doesNotMatch(source, /\/admin\/payouts\/\$\{[^}]+\}\/decide/);
  assert.doesNotMatch(source, /\/admin\/payouts\/\$\{[^}]+\}\/retry/);
  assert.doesNotMatch(source, /\/admin\/payouts\/\$\{[^}]+\}\/approve/);
  assert.doesNotMatch(source, /\/admin\/payouts\/run/);
  assert.doesNotMatch(source, /\/admin\/payouts\/batches\/\$\{[^}]+\}\/(?:approve|reject)/);

  assert.match(source, /\/admin\/payouts\/batches\/preview/);
  assert.match(source, /['`]\/admin\/payouts\/batches['`]/);
  assert.match(source, /membershipIds: \[decide\.p\.membershipId\]/);
  assert.match(source, /\/admin\/payouts\/\$\{decide\.p\.id\}\/reject/);
  assert.match(source, /\/admin\/payouts\/batches\/\$\{payout\.batchId\}\/dispatch/);
  assert.match(source, /\/admin\/payouts\/batches\/\$\{payout\.batchId\}\/settle/);
  assert.match(source, /\/admin\/payouts\/batches\/\$\{payout\.batchId\}\/fail/);
  assert.match(source, /\/admin\/payouts\/members\/\$\{target\.membershipId\}\/readiness/);
  assert.match(source, /\/admin\/payouts\/members\/\$\{target\.membershipId\}\/destination/);
  assert.doesNotMatch(source, /Approve & mark paid|Retried|Retry payout|Approve & pay/);
});
