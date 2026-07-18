import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const layoutSource = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('../globals.css', import.meta.url), 'utf8');
const i18nSource = readFileSync(new URL('../../lib/i18n.ts', import.meta.url), 'utf8');

const MEMBER_ROUTES = [
  '/app',
  '/app/wallet',
  '/app/sales',
  '/app/team',
  '/app/invite',
];

test('member shell preserves routes, auth storage, impersonation and account contracts', () => {
  for (const route of MEMBER_ROUTES) {
    assert.match(layoutSource, new RegExp(`href: '${route.replaceAll('/', '\\/')}'`));
  }

  assert.match(layoutSource, /activeMembership\(s\)/);
  assert.match(layoutSource, /subscribeToSessionStorageChanges\(/);
  assert.match(layoutSource, /change\.action === 'defer-to-caller'/);
  assert.match(layoutSource, /change\.action === 'reload'/);
  assert.match(layoutSource, /window\.location\.reload\(\)/);
  assert.match(layoutSource, /await clearSession\(\);\s*router\.replace\('\/login'\)/);
  assert.match(layoutSource, /await stopImpersonation\(\)[\s\S]*?window\.location\.href = '\/admin'/);
  assert.match(layoutSource, /api\.post\(`\/admin\/members\/\$\{mid\}\/impersonate\/end`\)/);
  assert.match(layoutSource, /href="\/account"/);
});

test('member navigation composes explicit pieces and activates nested routes', () => {
  assert.match(layoutSource, /function isMemberNavItemActive\b/);
  assert.match(layoutSource, /pathname === href \|\| pathname\.startsWith\(`\$\{href\}\//);

  for (const componentName of [
    'MemberHomeLink',
    'MemberNavigation',
    'MemberIdentity',
    'MemberDesktopNavigation',
    'MemberMobileNavigation',
  ]) {
    assert.match(layoutSource, new RegExp(`function ${componentName}\\b`));
  }

  assert.match(layoutSource, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(i18nSource, /'anav\.team': 'Network'/);
  assert.doesNotMatch(i18nSource, /'anav\.team': 'Team'/);
});

test('member chrome exposes one utility set and a focusable main destination', () => {
  for (const slot of ['member-shell', 'member-commandbar', 'member-navigation', 'member-main']) {
    assert.match(layoutSource, new RegExp(`data-slot="${slot}"`));
  }

  assert.equal((layoutSource.match(/<NotificationBell\b/g) ?? []).length, 1);
  assert.match(layoutSource, /<a className="skip-link" href="#member-main">/);
  assert.match(layoutSource, /<main id="member-main"[^>]*tabIndex=\{-1\}/);
  assert.match(layoutSource, /title=\{tenantName\}/);
  assert.match(
    layoutSource,
    /<Link href="\/account" className="member-identity member-identity-link"[\s\S]*?<span className="member-avatar"[\s\S]*?<span className="member-identity-copy">/,
  );
  assert.doesNotMatch(layoutSource, /<div className="member-identity">/);
});

test('mobile member navigation delegates dismissal and focus to the existing Radix Sheet', () => {
  assert.match(layoutSource, /from '@\/components\/ui\/sheet'/);
  assert.match(layoutSource, /<Sheet open=\{mobileNavOpen\} onOpenChange=\{setMobileNavOpen\}>/);
  assert.match(layoutSource, /<SheetContent[^>]*side="left"/);
  assert.match(layoutSource, /id="member-mobile-navigation"/);
  assert.match(layoutSource, /<SheetTitle[^>]*>/);
  assert.match(layoutSource, /<SheetDescription[^>]*>/);
  assert.match(layoutSource, /aria-label="Open navigation"/);
  assert.match(layoutSource, /aria-expanded=\{mobileNavOpen\}/);
  assert.match(layoutSource, /aria-controls="member-mobile-navigation"/);
  assert.match(layoutSource, /aria-haspopup="dialog"/);
  assert.match(layoutSource, /onNavigate=\{closeMobileNav\}/);
  assert.match(layoutSource, /onCloseAutoFocus=\{\(event\) =>/);
  assert.match(layoutSource, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(layoutSource, /setMobileNavOpen\(false\);\s*\}, \[pathname\]\)/);
  assert.match(layoutSource, /window\.matchMedia\('\(min-width: 901px\)'\)/);
  assert.doesNotMatch(layoutSource, /role="dialog"|useOverlayFocus/);
});

test('premium member workspace is scoped, responsive, touch-safe and motion-safe', () => {
  assert.match(globalStyles, /\/\* member workspace: start \*\//);
  assert.match(globalStyles, /\.member-shell\s*\{/);
  assert.match(globalStyles, /\.member-shell\s*\{[^}]*--member-accent-text:\s*var\(--gold-400\);/s);
  assert.match(globalStyles, /\.member-workspace\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*clip;/s);
  assert.match(globalStyles, /\.member-nav-link\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(globalStyles, /\.member-mobile-trigger\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
  assert.match(globalStyles, /\.member-mobile-sheet\s*\{[^}]*--member-gold:\s*var\(--gold-500\);/s);
  assert.match(globalStyles, /\.member-mobile-sheet\s*\{[^}]*--member-accent-text:\s*var\(--gold-400\);/s);
  assert.match(globalStyles, /\.member-mobile-sheet\s*\{[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(globalStyles, /\[data-theme="light"\] \.member-shell,[\s\S]*?\[data-theme="light"\] \.member-mobile-sheet\s*\{[^}]*--member-accent-text:\s*var\(--gold-800\);/s);
  assert.match(globalStyles, /\.member-mobile-kicker\s*\{[^}]*color:\s*var\(--member-accent-text\);/s);
  assert.match(globalStyles, /\.member-identity-link:hover\s*\{[^}]*background:\s*var\(--panel-3\);/s);
  assert.match(globalStyles, /padding-left:\s*max\([^;]*env\(safe-area-inset-left\)/);
  assert.match(globalStyles, /@media \(max-width:\s*900px\)[\s\S]*?\.member-desktop-navigation\s*\{\s*display:\s*none;/);
  assert.match(globalStyles, /@media \(max-width:\s*360px\)[\s\S]*?\.member-leading\s*\{[^}]*margin-right:\s*auto;/s);
  assert.match(globalStyles, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.member-shell \.member-identity-link/);
  assert.match(globalStyles, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.member-shell \.member-identity-link:active[^}]*transform:\s*none;/s);
  assert.match(globalStyles, /@media print[\s\S]*?\.member-commandbar/);
  assert.doesNotMatch(globalStyles, /transition\s*:\s*all(?:\s|;)/);
  assert.match(globalStyles, /\/\* member workspace: end \*\//);
});
