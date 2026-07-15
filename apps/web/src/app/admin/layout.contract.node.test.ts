import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const layoutSource = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('../globals.css', import.meta.url), 'utf8');

const ADMIN_ROUTES = [
  '/admin',
  '/admin/sales',
  '/admin/members',
  '/admin/tree',
  '/admin/campaigns',
  '/admin/payouts',
  '/admin/checks',
  '/admin/periods',
  '/admin/audit',
  '/admin/settings',
];

test('admin shell preserves every route and the current auth/storage contracts', () => {
  for (const route of ADMIN_ROUTES) {
    assert.match(layoutSource, new RegExp(`href: '${route.replaceAll('/', '\\/')}'`));
  }

  assert.match(layoutSource, /activeMembership\(session\)/);
  assert.match(layoutSource, /isAdminRole\(active\?\.role\)/);
  assert.match(layoutSource, /subscribeToSessionStorageChanges\(/);
  assert.match(layoutSource, /await clearSession\(\)/);
  assert.match(layoutSource, /href="\/platform"/);
  assert.match(layoutSource, /href="\/account"/);
});

test('admin shell composes one navigation and one global utility set', () => {
  for (const componentName of ['AdminHomeLink', 'AdminNavigation', 'AdminIdentity', 'AdminRail', 'AdminMobileNavigation']) {
    assert.match(layoutSource, new RegExp(`function ${componentName}\\b`));
  }

  for (const slot of ['admin-shell', 'admin-rail', 'admin-commandbar', 'admin-main']) {
    assert.match(layoutSource, new RegExp(`data-slot="${slot}"`));
  }

  assert.equal((layoutSource.match(/<NotificationBell\b/g) ?? []).length, 1);
  assert.equal((layoutSource.match(/<CommandPalette\b/g) ?? []).length, 1);
  assert.match(layoutSource, /<a className="skip-link" href="#admin-main">/);
  assert.match(layoutSource, /<main id="admin-main"[^>]*tabIndex=\{-1\}/);
  assert.match(layoutSource, /aria-current=\{active \? 'page' : undefined\}/);
});

test('mobile navigation delegates focus, escape and overlay dismissal to the existing Radix Sheet', () => {
  assert.match(layoutSource, /from '@\/components\/ui\/sheet'/);
  assert.match(layoutSource, /<Sheet open=\{mobileNavOpen\} onOpenChange=\{setMobileNavOpen\}>/);
  assert.match(layoutSource, /<SheetContent[^>]*side="left"/);
  assert.match(layoutSource, /id="admin-mobile-navigation"/);
  assert.match(layoutSource, /<SheetTitle[^>]*>/);
  assert.match(layoutSource, /<SheetDescription[^>]*>/);
  assert.match(layoutSource, /aria-label="Open navigation"/);
  assert.match(layoutSource, /aria-expanded=\{mobileNavOpen\}/);
  assert.match(layoutSource, /aria-controls="admin-mobile-navigation"/);
  assert.match(layoutSource, /aria-haspopup="dialog"/);
  assert.match(layoutSource, /onNavigate=\{closeMobileNav\}/);
  assert.match(layoutSource, /onCloseAutoFocus=\{\(event\) =>/);
  assert.match(layoutSource, /returnFocusRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(layoutSource, /role="dialog"|useOverlayFocus/);
});

test('premium ledger rail is responsive, calm and motion-safe', () => {
  assert.match(globalStyles, /--admin-rail-width:\s*272px/);
  assert.match(globalStyles, /--admin-violet:\s*#8b7cf6/i);
  assert.match(globalStyles, /\.admin-shell\s*\{/);
  assert.match(globalStyles, /\.admin-rail\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(globalStyles, /\.admin-nav\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  assert.match(globalStyles, /\.admin-workspace\s*\{[^}]*min-width:\s*0/s);
  assert.match(globalStyles, /\.admin-mobile-sheet\s*\{[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(globalStyles, /padding-left:\s*max\([^;]*env\(safe-area-inset-left\)/);
  assert.match(globalStyles, /@media \(max-width:\s*900px\)[\s\S]*?\.admin-rail\s*\{\s*display:\s*none;/);
  assert.match(globalStyles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(globalStyles, /transition\s*:\s*all(?:\s|;)/);
});

test('admin chrome keeps readable utility text and complete interactive targets', () => {
  assert.match(globalStyles, /\.admin-home-link\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(globalStyles, /\.admin-identity-link\s*\{[^}]*min-height:\s*40px;/s);
  assert.match(globalStyles, /\.admin-identity-link span\s*\{[^}]*font-size:\s*12px;/s);

  for (const selector of [
    'admin-rail-brand > span',
    'admin-nav-section-label',
    'admin-commandbar-context span',
    'admin-mobile-kicker',
  ]) {
    const escapedSelector = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(globalStyles, new RegExp(`\\.${escapedSelector}\\s*\\{[^}]*font-size:\\s*11px;`, 's'));
  }

  assert.doesNotMatch(globalStyles, /\.admin-[^{]+\{[^}]*font-size:\s*10px;/s);
});
