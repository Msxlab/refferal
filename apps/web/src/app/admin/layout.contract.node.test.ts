import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const layoutSource = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('../globals.css', import.meta.url), 'utf8');
const i18nSource = readFileSync(new URL('../../lib/i18n.ts', import.meta.url), 'utf8');
const commandPaletteSource = readFileSync(new URL('../../components/CommandPalette.tsx', import.meta.url), 'utf8');

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

test('obsidian and cobalt ledger rail is responsive, calm and motion-safe', () => {
  assert.match(globalStyles, /--admin-rail-width:\s*256px/);
  assert.match(globalStyles, /--admin-obsidian:\s*#0b1020/i);
  assert.match(globalStyles, /--admin-cobalt:\s*#3157d5/i);
  assert.match(globalStyles, /--admin-cobalt-on-ink:\s*#a9b8ff/i);
  assert.doesNotMatch(globalStyles, /--admin-violet\b|#8b7cf6/i);
  assert.match(globalStyles, /\.admin-shell\s*\{/);
  assert.match(globalStyles, /\.admin-rail\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;[^}]*background:\s*var\(--admin-obsidian\);/s);
  assert.match(globalStyles, /\.admin-nav\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  assert.match(globalStyles, /\.admin-nav-link\s*\{[^}]*min-height:\s*44px;[^}]*transition:\s*color[^;]*background-color[^;]*transform[^;]*;/s);
  assert.match(globalStyles, /\.admin-nav-link\.active\s*\{[^}]*var\(--admin-cobalt\)/s);
  assert.match(globalStyles, /\.admin-workspace\s*\{[^}]*min-width:\s*0/s);
  assert.match(globalStyles, /\.admin-mobile-sheet\s*\{[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(globalStyles, /padding-left:\s*max\([^;]*env\(safe-area-inset-left\)/);
  assert.match(globalStyles, /@media \(max-width:\s*900px\)[\s\S]*?\.admin-rail\s*\{\s*display:\s*none;/);
  assert.match(
    globalStyles,
    /\.admin-rail,\s*\.admin-mobile-sheet\s*\{[^}]*--text:\s*var\(--admin-ink-text\);[^}]*--ring:\s*var\(--admin-cobalt-on-ink\);[^}]*--focus-ring:/s,
  );
  assert.match(globalStyles, /\.admin-mobile-kicker\s*\{[^}]*color:\s*var\(--admin-cobalt-on-ink\);/s);
  assert.match(globalStyles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(globalStyles, /transition\s*:\s*all(?:\s|;)/);
});

test('admin chrome keeps readable utility text and complete interactive targets', () => {
  assert.match(globalStyles, /\.admin-rail \.brand-lockup\s*\{[^}]*color:\s*var\(--admin-ink-text\);/s);
  assert.match(globalStyles, /\.admin-home-link\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(globalStyles, /\.admin-identity-link\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(globalStyles, /\.admin-logout\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(globalStyles, /\.admin-global-actions button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(globalStyles, /\.admin-mobile-leading button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
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

test('network destination is named Value flow in navigation and command search', () => {
  assert.match(i18nSource, /'nav\.tree': 'Value flow'/);
  assert.match(commandPaletteSource, /label: 'Go to Value flow', path: '\/admin\/tree'/);
  assert.doesNotMatch(commandPaletteSource, /Go to Network/);
});
