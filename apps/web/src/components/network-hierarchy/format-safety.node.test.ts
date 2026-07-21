import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { money } from '../../lib/format.ts';

test('legacy value-flow money formatting tolerates absent optional cents', () => {
  assert.doesNotThrow(() => money(undefined));
  assert.doesNotThrow(() => money(null));
  assert.equal(money(undefined), '$0.00');
});
