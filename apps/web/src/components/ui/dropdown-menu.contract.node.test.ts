import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('dropdown actions remain reachable, printable pages stay clean, and targets are absolute-sized', () => {
  const dropdown = source('dropdown-menu.tsx');
  const sales = source('../admin/SalesPageContent.tsx');

  assert.match(dropdown, /max-h-\[var\(--radix-dropdown-menu-content-available-height\)\]/);
  assert.match(dropdown, /overflow-y-auto/);
  assert.match(dropdown, /print:hidden/);
  assert.match(dropdown, /min-h-\[40px\]/);
  assert.match(sales, /document\.querySelector\('\[role="menu"\]'\)/);
  assert.match(sales, /remainingFrames > 0/);
  assert.match(sales, /requestAnimationFrame\(\(\) => printAfterDropdownCloses\(remainingFrames - 1\)\)/);
});

test('login controls keep explicit 40px sizing and browser autofill semantics', () => {
  const input = source('input.tsx');
  const login = source('../../app/login/page.tsx');

  assert.match(input, /h-\[40px\]/);
  assert.match(login, /autoComplete="email"/);
  assert.match(login, /autoComplete="current-password"/);
});

test('payout disclosure distinguishes tax-ID minimization from encrypted bank storage', () => {
  const wallet = source('../../app/app/wallet/page.tsx');

  assert.doesNotMatch(wallet, /We store only the last 4 digits/);
  assert.match(wallet, /tax ID/i);
  assert.match(wallet, /bank account number is encrypted at rest/i);
});
