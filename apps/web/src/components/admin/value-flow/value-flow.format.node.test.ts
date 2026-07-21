import assert from 'node:assert/strict';
import test from 'node:test';

// Node's native TypeScript runner requires an explicit extension.
// @ts-expect-error TypeScript app imports omit extensions, while this file runs directly in Node.
import { monthLabel } from './value-flow.format.ts';

test('renders a frozen evidence month as a human-readable label', () => {
  assert.equal(monthLabel('2026-07'), 'July 2026');
});

test('preserves malformed evidence periods instead of inventing a date', () => {
  assert.equal(monthLabel('all-time'), 'all-time');
  assert.equal(monthLabel('2026-13'), '2026-13');
});
