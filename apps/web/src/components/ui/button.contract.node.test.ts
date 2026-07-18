import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./button.tsx', import.meta.url), 'utf8');

test('buttons expose absolute 40–44px targets and restrained press feedback', () => {
  assert.match(source, /min-h-\[40px\] min-w-\[40px\]/);
  assert.match(source, /sm: "h-\[40px\]/);
  assert.match(source, /lg: "h-\[44px\]/);
  assert.match(source, /icon: "size-\[40px\]"/);
  assert.match(source, /active:scale-\[0\.96\]/);
  assert.match(source, /motion-reduce:transition-none/);
  assert.doesNotMatch(source, /\btransition-all\b/);
});
