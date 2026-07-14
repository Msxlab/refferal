import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const layoutSource = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('../globals.css', import.meta.url), 'utf8');

test('admin navigation keeps section routes active and exposes the current page', () => {
  const matcherSource = layoutSource.match(
    /function isNavItemActive\(pathname: string, href: string\) \{([\s\S]*?)\n\}/,
  );
  assert.ok(matcherSource, 'isNavItemActive helper must remain directly testable');
  const isNavItemActive = new Function('pathname', 'href', matcherSource[1]) as (
    pathname: string,
    href: string,
  ) => boolean;

  assert.equal(isNavItemActive('/admin', '/admin'), true);
  assert.equal(isNavItemActive('/admin/sales', '/admin'), false);
  assert.equal(isNavItemActive('/admin/sales/42', '/admin/sales'), true);
  assert.equal(isNavItemActive('/administrator', '/admin'), false);
  assert.match(layoutSource, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(
    layoutSource,
    /<Link href="\/admin" className="admin-home-link" aria-label="Go to admin overview">/,
  );
  assert.equal((layoutSource.match(/<AdminHomeLink \/>/g) ?? []).length, 2);

  const roleLabelSource = layoutSource.match(
    /function roleLabel\(role: string \| undefined\) \{([\s\S]*?)\n\}/,
  );
  assert.ok(roleLabelSource, 'role labels must remain directly testable');
  const roleLabel = new Function('role', roleLabelSource[1]) as (role?: string) => string;
  assert.equal(roleLabel('tenant_owner'), 'Owner');
  assert.equal(roleLabel('tenant_admin'), 'Administrator');
  assert.equal(roleLabel('tenant_staff'), 'Staff');
  assert.equal(roleLabel(undefined), 'Team member');
});

test('mobile administrator navigation is an accessible dismissible dialog', () => {
  assert.match(layoutSource, /aria-expanded=\{mobileNavOpen\}/);
  assert.match(layoutSource, /aria-controls="admin-mobile-navigation"/);
  assert.match(layoutSource, /id="admin-mobile-navigation"/);
  assert.match(layoutSource, /role="dialog"/);
  assert.match(layoutSource, /aria-modal="true"/);
  assert.match(layoutSource, /mobileNavOpen && \(/);
  assert.match(layoutSource, /aria-label="Close navigation"/);
  assert.match(layoutSource, /onNavigate=\{closeMobileNav\}/);
  assert.match(layoutSource, /useOverlayFocus\(mobileNavRef, closeMobileNav\)/);
  assert.match(layoutSource, /window\.matchMedia\('\(min-width: 901px\)'\)/);
  assert.match(layoutSource, /desktopMedia\.addEventListener\('change', closeOnDesktop\)/);
});

test('premium ledger shell has explicit responsive chrome and interruptible motion', () => {
  for (const slot of ['admin-shell', 'admin-rail', 'admin-commandbar', 'admin-mobile-nav', 'admin-main']) {
    assert.match(layoutSource, new RegExp(`data-slot="${slot}"`));
  }
  assert.match(globalStyles, /--shell-rail-width:/);
  assert.match(globalStyles, /\.admin-rail\s*\{/);
  assert.match(globalStyles, /\.admin-commandbar\s*\{/);
  assert.match(globalStyles, /\.admin-mobile-drawer\s*\{/);
  assert.match(globalStyles, /@media \(max-width: 900px\)/);
  assert.match(globalStyles, /\.admin-workspace\s*\{[^}]*min-width:\s*0/s);
  assert.match(globalStyles, /\.admin-rail\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(globalStyles, /\.admin-nav\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  assert.match(globalStyles, /@media \(max-width: 900px\)[\s\S]*?\.admin-rail\s*\{\s*display:\s*none;/);
  assert.match(globalStyles, /@media \(max-width: 900px\)[\s\S]*?\.admin-mobilebar\s*\{[^}]*display:\s*flex;/);
  assert.doesNotMatch(globalStyles, /transition\s*:\s*all(?:\s|;)/);

  const keyframeNames = [...globalStyles.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
  assert.deepEqual(keyframeNames, [...new Set(keyframeNames)], 'keyframe names must remain unique');
  assert.equal((layoutSource.match(/<NotificationBell\b/g) ?? []).length, 1);
  assert.match(
    layoutSource,
    /<ThemeToggle \/>[\s\S]*?<NotificationBell \/>/,
    'the notification trigger must stay on the viewport edge so its anchored panel fits at 320px',
  );
});
