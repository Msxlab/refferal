import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemberNetworkPayloadError,
  MemberNetworkSnapshotMismatchError,
  parseMemberDirectSearchPage,
  parseMemberNetworkContext,
  // @ts-expect-error Native Node needs an explicit runtime extension for this isolated contract test.
} from '../src/lib/member-network.ts';

const SIGNATURE = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE';
const ref = (subject: string) => `${subject}.${SIGNATURE}`;

function safeContext() {
  return {
    sponsor: null,
    self: {
      kind: 'self',
      nodeRef: 'self',
      displayName: 'Viewer Member',
      initials: 'VM',
      referralCode: 'SELF-1',
      status: 'active',
      directCount: 0,
      visibleDownlineCount: 0,
      performance: {
        currency: 'USD',
        period: '2026-07',
        visibleApprovedSales: 4,
        visibleTeamVolumeCents: '125000',
      },
    },
    initialPage: {
      parentRef: ref('c2VsZg'),
      items: [],
      representedNodes: 0,
      nextCursor: null,
      snapshotAt: '2026-07-20T12:00:00.000Z',
    },
    scope: {
      maxVisibleTier: 3,
      loadedNodes: 0,
      representedNodes: 0,
      completeWithinVisibleDepth: true,
      snapshotAt: '2026-07-20T12:00:00.000Z',
      structuralCountsCoverage: 'visibleTiersExact',
      metricsCoverage: 'visibleTiersExact',
    },
  };
}

function directItem() {
  return {
    kind: 'direct',
    nodeRef: ref('ZGlyZWN0'),
    parentRef: 'self',
    localTier: 1,
    displayName: 'First Direct',
    initials: 'FD',
    referralCode: 'DIRECT-1',
    status: 'active',
    visibleDirectCount: 0,
    visibleBranchCount: 0,
    canExpand: false,
    performance: {
      currency: 'USD',
      period: '2026-07',
      approvedSales: 1,
      visibleBranchVolumeCents: '10000',
    },
  };
}

function anonymousItem() {
  return {
    kind: 'anonymous',
    nodeRef: ref('dGllci0y'),
    parentRef: ref('ZGlyZWN0'),
    localTier: 2,
    initials: 'AB',
    label: 'Tier 2 member',
    status: 'active',
    visibleChildCount: 0,
    canExpand: false,
    performanceBand: { suppressed: true, reason: 'noData' },
  };
}

test('mobile adapter validates and then drops the self performance payload', () => {
  const context = parseMemberNetworkContext(safeContext());
  assert.equal(context.self.displayName, 'Viewer Member');
  assert.equal('performance' in context.self, false);
});

test('mobile adapter rejects unrecognized or malformed self performance data', () => {
  const scenarios: Array<(payload: ReturnType<typeof safeContext>) => void> = [
    (payload) => {
      (payload.self.performance as Record<string, unknown>).commissionCents = '100';
    },
    (payload) => {
      payload.self.performance.period = '2026-13';
    },
    (payload) => {
      payload.self.performance.visibleTeamVolumeCents = '1.25';
    },
  ];

  for (const mutate of scenarios) {
    const payload = safeContext();
    mutate(payload);
    assert.throws(() => parseMemberNetworkContext(payload), MemberNetworkPayloadError);
  }
});

test('mobile direct search accepts only its named Tier 1 envelope', () => {
  const result = parseMemberDirectSearchPage({
    items: [directItem()],
    nextCursor: ref('Y3Vyc29y'),
    snapshotAt: '2026-07-20T12:00:00.000Z',
  });
  assert.equal(result.items[0]?.kind, 'direct');
  assert.equal(result.nextCursor, ref('Y3Vyc29y'));

  assert.throws(
    () =>
      parseMemberDirectSearchPage({
        parentRef: ref('c2VsZg'),
        items: [directItem()],
        nextCursor: null,
        snapshotAt: '2026-07-20T12:00:00.000Z',
      }),
    MemberNetworkPayloadError,
  );
  assert.throws(
    () =>
      parseMemberDirectSearchPage({
        items: [anonymousItem()],
        nextCursor: null,
        snapshotAt: '2026-07-20T12:00:00.000Z',
      }),
    MemberNetworkPayloadError,
  );
});

test('mobile direct search rejects a cursor page from a different snapshot', () => {
  assert.throws(
    () =>
      parseMemberDirectSearchPage(
        {
          items: [directItem()],
          nextCursor: null,
          snapshotAt: '2026-07-20T12:01:00.000Z',
        },
        '2026-07-20T12:00:00.000Z',
      ),
    MemberNetworkSnapshotMismatchError,
  );
});
