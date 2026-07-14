import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const pageSource = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

async function subject() {
  const modulePath = './payout-reconciliation.ts';
  try {
    return await import(modulePath);
  } catch (error) {
    assert.fail(`payout reconciliation helper should load: ${String(error)}`);
  }
}

test('an accepted payout stays locked when its authoritative reload fails', async () => {
  const { initialPayoutActionState, payoutActionReducer, payoutActionIsLocked } = await subject();

  let state = payoutActionReducer(initialPayoutActionState, { type: 'submit-started' });
  state = payoutActionReducer(state, { type: 'submit-succeeded' });
  state = payoutActionReducer(state, { type: 'reload-failed', message: 'wallet unavailable' });

  assert.deepEqual(state, { status: 'awaiting-reconciliation', message: 'wallet unavailable' });
  assert.equal(payoutActionIsLocked(state), true);
});

test('a reconciliation retry unlocks only after an authoritative reload succeeds', async () => {
  const { payoutActionReducer, payoutActionIsLocked } = await subject();
  const awaiting = { status: 'awaiting-reconciliation', message: 'wallet unavailable' } as const;

  const checking = payoutActionReducer(awaiting, { type: 'retry-started' });
  assert.deepEqual(checking, { status: 'checking', message: 'wallet unavailable' });
  assert.equal(payoutActionIsLocked(checking), true);

  const reconciled = payoutActionReducer(checking, { type: 'reload-succeeded' });
  assert.deepEqual(reconciled, { status: 'idle' });
  assert.equal(payoutActionIsLocked(reconciled), false);
});

test('a rejected payout submission does not enter reconciliation lock', async () => {
  const { initialPayoutActionState, payoutActionReducer, payoutActionIsLocked } = await subject();

  const submitting = payoutActionReducer(initialPayoutActionState, { type: 'submit-started' });
  const failed = payoutActionReducer(submitting, { type: 'submit-failed' });

  assert.deepEqual(failed, { status: 'idle' });
  assert.equal(payoutActionIsLocked(failed), false);
});

test('the wallet page locks an accepted payout through its authoritative reload', () => {
  assert.match(
    pageSource,
    /await api\.post\('\/app\/payout-requests'\);[\s\S]*showToast\('Your payout request has been received\.'\);[\s\S]*type: 'submit-succeeded'[\s\S]*await load\(\)/,
  );
  assert.match(pageSource, /payoutActionIsLocked\(payoutAction\)/);
  assert.match(pageSource, /type: 'reload-succeeded'/);
  assert.match(pageSource, /type: 'reload-failed'/);
});

test('the wallet page exposes an accessible reconciliation retry', () => {
  assert.match(pageSource, /role="status"[\s\S]*aria-live="polite"/);
  assert.match(pageSource, /Retry status check/);
  assert.match(pageSource, /Your payout request was received, but the latest wallet status could not be confirmed\./);
});
