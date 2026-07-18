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

function pageSection(startMarker: string, endMarker: string): string {
  const start = pageSource.indexOf(startMarker);
  assert.notEqual(start, -1, `missing page marker: ${startMarker}`);
  const end = pageSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing page marker: ${endMarker}`);
  return pageSource.slice(start, end);
}

test('an accepted payout keeps its id and remains locked when reconciliation fails', async () => {
  const { initialPayoutActionState, payoutActionIsLocked, payoutActionReducer } = await subject();

  let state = payoutActionReducer(initialPayoutActionState, { type: 'submit-started' });
  state = payoutActionReducer(state, { type: 'submit-succeeded', payoutId: 'payout-new' });
  state = payoutActionReducer(state, {
    type: 'reload-failed',
    payoutId: 'payout-new',
    message: 'wallet unavailable',
  });

  assert.deepEqual(state, {
    status: 'awaiting-reconciliation',
    payoutId: 'payout-new',
    message: 'wallet unavailable',
  });
  assert.equal(payoutActionIsLocked(state), true);
});

test('a retry unlocks only after the matching accepted payout reconciles', async () => {
  const { payoutActionIsLocked, payoutActionReducer } = await subject();
  const awaiting = {
    status: 'awaiting-reconciliation',
    payoutId: 'payout-new',
    message: 'history unavailable',
  } as const;

  const checking = payoutActionReducer(awaiting, { type: 'retry-started' });
  assert.deepEqual(checking, {
    status: 'checking',
    payoutId: 'payout-new',
    message: 'history unavailable',
  });
  assert.equal(payoutActionIsLocked(checking), true);

  const reconciled = payoutActionReducer(checking, {
    type: 'reload-succeeded',
    payoutId: 'payout-new',
  });
  assert.deepEqual(reconciled, { status: 'idle' });
  assert.equal(payoutActionIsLocked(reconciled), false);
});

test('a stale reload for another payout cannot unlock the current request', async () => {
  const { payoutActionIsLocked, payoutActionReducer } = await subject();
  const checking = {
    status: 'checking',
    payoutId: 'payout-current',
    message: null,
  } as const;

  const state = payoutActionReducer(checking, {
    type: 'reload-succeeded',
    payoutId: 'payout-stale',
  });

  assert.deepEqual(state, checking);
  assert.equal(payoutActionIsLocked(state), true);
});

test('events from the wrong state cannot clear an accepted payout lock', async () => {
  const { payoutActionReducer } = await subject();
  const accepted = {
    status: 'checking',
    payoutId: 'payout-new',
    message: null,
  } as const;

  assert.deepEqual(payoutActionReducer(accepted, { type: 'submit-failed' }), accepted);
  assert.deepEqual(payoutActionReducer(accepted, { type: 'submit-started' }), accepted);
  assert.deepEqual(
    payoutActionReducer(
      { status: 'awaiting-reconciliation', payoutId: 'payout-new', message: 'try again' } as const,
      { type: 'reload-succeeded', payoutId: 'payout-new' },
    ),
    { status: 'awaiting-reconciliation', payoutId: 'payout-new', message: 'try again' },
  );
});

test('a rejected payout submission returns to idle', async () => {
  const { initialPayoutActionState, payoutActionIsLocked, payoutActionReducer } = await subject();

  const submitting = payoutActionReducer(initialPayoutActionState, { type: 'submit-started' });
  const failed = payoutActionReducer(submitting, { type: 'submit-failed' });

  assert.deepEqual(failed, { status: 'idle' });
  assert.equal(payoutActionIsLocked(failed), false);
});

test('only requested and processing payouts keep the request action closed', async () => {
  const { hasOpenPayoutRequest } = await subject();

  assert.equal(hasOpenPayoutRequest([{ status: 'requested' }]), true);
  assert.equal(hasOpenPayoutRequest([{ status: 'processing' }]), true);
  assert.equal(hasOpenPayoutRequest([{ status: 'paid' }, { status: 'failed' }]), false);
  assert.equal(hasOpenPayoutRequest([]), false);
});

test('history reconciles any current row for the matching accepted payout', async () => {
  const { payoutHistoryReconciles } = await subject();
  const history = [
    { id: 'payout-old', status: 'requested' },
    { id: 'payout-new', status: 'paid' },
  ];

  assert.equal(payoutHistoryReconciles(history, 'payout-missing'), false);
  assert.equal(payoutHistoryReconciles(history, 'payout-new'), true);
  assert.equal(payoutHistoryReconciles([{ id: 'payout-new', status: 'failed' }], 'payout-new'), true);
});

test('the wallet page submits once and correlates the returned payout id', () => {
  const requestSource = pageSection('async function requestPayout()', 'async function retryPayoutStatus()');

  assert.match(requestSource, /type: 'submit-started'/);
  assert.match(requestSource, /api\.post<PayoutAcceptance>\('\/app\/payout-requests'\)/);
  assert.match(requestSource, /type: 'submit-succeeded', payoutId: accepted\.id/);
  assert.match(requestSource, /await load\(accepted\.id\)/);
  assert.match(requestSource, /type: 'reload-succeeded', payoutId: accepted\.id/);
  assert.match(requestSource, /type: 'reload-failed', payoutId: accepted\.id/);
});

test('the authoritative wallet reload waits for both current resources and checks history id', () => {
  assert.match(
    pageSource,
    /Promise\.all\(\[\s*api\.get<Wallet>\(`\/app\/wallet\?\$\{ledgerQuery\}`\),\s*api\.get<PayoutReq\[\]>\('\/app\/payout-requests'\),?\s*\]\)/,
  );
  assert.match(pageSource, /payoutHistoryReconciles\(h, expectedPayoutId\)/);
});

test('an older wallet reload cannot commit after a newer generation starts', () => {
  const loadSource = pageSection('const load = useCallback', '  useEffect(() => {');

  assert.match(pageSource, /const loadGeneration = useRef\(0\)/);
  assert.match(loadSource, /const generation = \+\+loadGeneration\.current/);
  assert.match(
    loadSource,
    /await Promise\.all[\s\S]*generation !== loadGeneration\.current[\s\S]*setWallet\(w\)[\s\S]*setHistory\(h\)/,
  );
  assert.match(loadSource, /status: 'superseded'/);
});

test('the reconciliation retry performs status GETs and never submits another payout', () => {
  const retrySource = pageSection('async function retryPayoutStatus()', '  if (error && !wallet)');

  assert.match(retrySource, /type: 'retry-started'/);
  assert.match(retrySource, /await load\(payoutId\)/);
  assert.doesNotMatch(retrySource, /api\.post/);
});

test('the wallet page exposes persistent and transient locks with an accessible retry status', () => {
  assert.match(pageSource, /payoutActionIsLocked\(payoutAction\)/);
  assert.match(pageSource, /hasOpenPayoutRequest\(history\)/);
  assert.match(pageSource, /role="status"/);
  assert.match(pageSource, /aria-live="polite"/);
  assert.match(pageSource, /Retry status check/);
  assert.match(pageSource, /A payout request is already under review/);
});

test('the current wallet contract stays free of unimplemented processing fields', () => {
  assert.doesNotMatch(pageSource, /payoutEligibility|processingCents|settledAt|processingStartedAt/);
});
