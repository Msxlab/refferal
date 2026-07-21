import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const pageSource = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const hqPageSource = readFileSync(new URL('../../hq/c/[id]/members/page.tsx', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../../components/admin/MembersPageContent.tsx', import.meta.url), 'utf8');

test('member management keeps server pagination in its request and exposes page navigation', () => {
  assert.match(source, /p\.set\('sort', sort\); p\.set\('dir', dir\); p\.set\('page', String\(page\)\); p\.set\('pageSize', '25'\);/);
  assert.match(source, /\/admin\/members\?\$\{p\.toString\(\)\}/);
  assert.match(source, /<Pagination page=\{list\.page\} pageSize=\{list\.pageSize\} total=\{list\.total\} onPage=\{setPage\} \/>/);
});

test('member actions receive permission-derived capabilities from the session', () => {
  for (const wrapper of [pageSource, hqPageSource]) {
    assert.match(wrapper, /reportsExport: canForTenantRoles\(s, 'reports\.export', TENANT_STAFF_ROLES\)/);
    assert.match(wrapper, /memberDataExport: canForTenantRoles\(s, 'reports\.export', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /membersSuspend: canForTenantRoles\(s, 'members\.suspend', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /settingsRoles: canForTenantRoles\(s, 'settings\.roles', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /membersManage: canForTenantRoles\(s, 'members\.manage', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /invitesCreate: canForTenantRoles\(s, 'invites\.create', TENANT_ADMIN_ROLES\)/);
    assert.match(wrapper, /settingsSecurity: canForTenantRoles\(s, 'settings\.security', TENANT_ADMIN_ROLES\)/);
  }
  assert.match(pageSource, /<MembersPageContent tenantName=\{tenantName\} capabilities=\{capabilities\} \/>/);
});

test('member exports, bulk changes, role assignment, and manual creation are capability gated', () => {
  assert.match(source, /disabled=\{!capabilities\.reportsExport\}[\s\S]*?Export CSV/);
  assert.match(source, /capabilities\.memberDataExport && <Button[\s\S]*?onClick=\{exportData\}>[\s\S]*?Export data/);
  assert.match(source, /disabled=\{!capabilities\.membersSuspend \|\| selActivatable === 0\}/);
  assert.match(source, /disabled=\{!capabilities\.membersSuspend \|\| selDeactivatable === 0\}/);
  assert.match(source, /disabled=\{!capabilities\.settingsRoles \|\| roleBusyId === m\.id\}/);
  assert.match(source, /capabilities\.settingsRoles[\s\S]*?openBulk\('set_role'\)/);
  assert.match(source, /disabled=\{!capabilities\.membersManage\}[\s\S]*?Add member/);
  assert.match(source, /const addRoles = capabilities\.settingsRoles \? ROLES : MEMBER_ROLES/);
  assert.match(source, /role: capabilities\.settingsRoles \? addRole : 'member'/);
});

test('individual member mutations cannot issue requests without their exact capability', () => {
  assert.match(source, /if \(!capabilities\.invitesCreate\) \{ setError\('Invitation creation permission is required\.'/);
  assert.match(source, /disabled=\{!capabilities\.invitesCreate\}[\s\S]*?members\.invite/);
  assert.match(source, /if \(!capabilities\.membersManage\) \{ setError\('Member management permission is required\.'/);
  assert.match(source, /disabled=\{!capabilities\.membersManage\}[\s\S]*?title=\{capabilities\.membersManage \? 'Edit profile' : undefined\}/);
  assert.match(source, /if \(!capabilities\.membersSuspend\) \{ setError\('Member suspension permission is required\.'/);
  assert.match(source, /disabled=\{!capabilities\.membersSuspend\}/);
  assert.match(source, /if \(!capabilities\.settingsSecurity\) \{ setErr\('Security management permission is required\.'/);
  assert.match(source, /capabilities\.settingsSecurity && p\.role !== 'tenant_owner'/);
  assert.doesNotMatch(source, /meIsAdmin/);
});

test('permission-disabled controls expose their reason to keyboard and assistive technology', () => {
  assert.match(source, /function PermissionHint[\s\S]*?tabIndex=\{0\}[\s\S]*?aria-describedby=\{reasonId\}/);
  assert.match(source, /<PermissionHint allowed=\{capabilities\.membersManage\} reason="Requires member management permission">[\s\S]*?Edit profile/);
  assert.match(source, /<PermissionHint allowed=\{capabilities\.settingsRoles\} reason="Requires role management permission">[\s\S]*?<select/);
  assert.match(source, /<PermissionHint allowed=\{capabilities\.membersSuspend\} reason="Requires member suspension permission">/);
});

test('member detail renders the in-flight payout balance on screen and in print', () => {
  assert.match(source, /commission: \{ pendingCents: string; payableCents: string; processingCents: string; paidCents: string \}/);
  assert.match(source, /In payout: \{money\(d\.stats\.commission\.processingCents, cur\)\}/);
  assert.match(source, /<tr><td>In payout<\/td><td style=\{\{ textAlign: 'right' \}\}>\{money\(d\.stats\.commission\.processingCents, cur\)\}<\/td><\/tr>/);
});
