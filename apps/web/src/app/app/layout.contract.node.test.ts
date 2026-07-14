import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const layoutSource = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('../globals.css', import.meta.url), 'utf8');
const translations = readFileSync(new URL('../../lib/i18n.ts', import.meta.url), 'utf8');

test('member navigation keeps nested routes active and exposes the current page', () => {
  const matcherSource = layoutSource.match(
    /function isMemberNavItemActive\(pathname: string, href: string\) \{([\s\S]*?)\n\}/,
  );
  assert.ok(matcherSource, 'isMemberNavItemActive helper must remain directly testable');
  const isMemberNavItemActive = new Function('pathname', 'href', matcherSource[1]) as (
    pathname: string,
    href: string,
  ) => boolean;

  assert.equal(isMemberNavItemActive('/app', '/app'), true);
  assert.equal(isMemberNavItemActive('/app/team', '/app'), false);
  assert.equal(isMemberNavItemActive('/app/wallet/history', '/app/wallet'), true);
  assert.equal(isMemberNavItemActive('/application', '/app'), false);
  assert.match(layoutSource, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(layoutSource, /<Link href="\/app" className="member-home-link" aria-label="Go to member overview">/);
  assert.match(translations, /'anav\.team':\s*'Network'/, 'member navigation and page terminology must agree');
});

test('member shell has one utility cluster and task-oriented desktop and mobile navigation', () => {
  for (const slot of ['member-shell', 'member-topbar', 'member-desktop-nav', 'member-bottom-nav', 'member-main']) {
    assert.match(layoutSource, new RegExp(`data-slot="${slot}"`));
  }
  assert.equal((layoutSource.match(/<NotificationBell\b/g) ?? []).length, 1);
  assert.match(layoutSource, /role="group" aria-label="Member utilities"/);
  assert.match(
    layoutSource,
    /<ThemeToggle \/>[\s\S]*?className="member-logout"[\s\S]*?<NotificationBell \/>/,
    'the notification trigger must stay on the viewport edge so its panel fits at 320px',
  );
});

test('member chrome uses a safe-area mobile dock without shrinking touch targets', () => {
  assert.match(globalStyles, /--member-content-max:/);
  assert.match(globalStyles, /\.member-shell\s*\{/);
  assert.match(globalStyles, /\.member-topbar\s*\{/);
  assert.match(globalStyles, /\.member-main\s*\{[^}]*min-width:\s*0;/s);
  assert.match(globalStyles, /\.member-bottom-nav\s*\{[^}]*display:\s*none;/s);
  assert.match(globalStyles, /@media \(max-width: 820px\)[\s\S]*?\.member-desktop-nav\s*\{\s*display:\s*none;/);
  assert.match(globalStyles, /@media \(max-width: 820px\)[\s\S]*?\.member-bottom-nav\s*\{[^}]*display:\s*grid;/s);
  assert.match(globalStyles, /safe-area-inset-bottom/);
  assert.match(globalStyles, /\.member-bottom-nav \.member-nav-link\s*\{[^}]*min-height:\s*56px;/s);
  assert.doesNotMatch(globalStyles, /transition\s*:\s*all(?:\s|;)/);
});
