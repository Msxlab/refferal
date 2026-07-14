import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./button.tsx', import.meta.url), 'utf8');

test('button targets use absolute CSS pixels instead of root-relative spacing', () => {
  assert.match(source, /min-h-\[40px\] min-w-\[40px\]/);
  assert.match(source, /icon: "size-\[40px\]"/);
  assert.match(source, /"icon-lg": "size-\[44px\]"/);
  assert.doesNotMatch(source, /\bmin-h-10\b|\bmin-w-10\b/);
});
