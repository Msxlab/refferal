import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemberNetworkPayloadError,
  parseMemberDirectSearchPage,
  parseMemberNetworkContext,
} from './member-network.adapter';

const SIGNATURE = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE';
const ref = (subject: string) => `${subject}.${SIGNATURE}`;

function safeContext() {
  const directRef = ref('ZGlyZWN0');
  const tierTwoRef = ref('dGllci0y');
  const tierThreeRef = ref('dGllci0z');
  return {
    sponsor: {
      kind: 'sponsor',
      displayName: 'Approved Sponsor',
      initials: 'AS',
      referralCode: 'SPONSOR-1',
      status: 'active',
    },
    self: {
      kind: 'self',
      nodeRef: 'self',
      displayName: 'Viewer Member',
      initials: 'VM',
      referralCode: 'SELF-1',
      status: 'active',
      directCount: 1,
      visibleDownlineCount: 3,
      performance: {
        currency: 'USD',
        period: '2026-07',
        visibleApprovedSales: 4,
        visibleTeamVolumeCents: '125000',
      },
    },
    initialPage: {
      parentRef: ref('c2VsZg'),
      items: [
        {
          kind: 'direct',
          nodeRef: directRef,
          parentRef: 'self',
          localTier: 1,
          displayName: 'First Direct',
          initials: 'FD',
          referralCode: 'DIRECT-1',
          status: 'active',
          visibleDirectCount: 1,
          visibleBranchCount: 2,
          canExpand: true,
          performance: {
            currency: 'USD',
            period: '2026-07',
            approvedSales: 2,
            visibleBranchVolumeCents: '50000',
          },
        },
        {
          kind: 'anonymous',
          nodeRef: tierTwoRef,
          parentRef: directRef,
          localTier: 2,
          initials: 'AB',
          label: 'Tier 2 member',
          status: 'active',
          visibleChildCount: 1,
          canExpand: true,
          performanceBand: { suppressed: false, approvedSalesBand: '1-4', volumeBand: 'under1k' },
        },
        {
          kind: 'anonymous',
          nodeRef: tierThreeRef,
          parentRef: tierTwoRef,
          localTier: 3,
          initials: 'CD',
          label: 'Tier 3 member',
          status: 'inactive',
          canExpand: false,
          performanceBand: { suppressed: true, reason: 'smallCohort' },
        },
        {
          kind: 'cluster',
          clusterRef: ref('Y2x1c3Rlcg'),
          parentRef: directRef,
          localTier: 2,
          label: 'Tier 2 members',
          representedNodes: 3,
          canExpand: true,
        },
      ],
      representedNodes: 6,
      nextCursor: null,
      snapshotAt: '2026-07-20T12:00:00.000Z',
    },
    scope: {
      maxVisibleTier: 3,
      loadedNodes: 4,
      representedNodes: 7,
      completeWithinVisibleDepth: false,
      snapshotAt: '2026-07-20T12:00:00.000Z',
      structuralCountsCoverage: 'visibleTiersExact',
      metricsCoverage: 'visibleTiersExact',
    },
  };
}

test('accepts only the member projection and preserves an opaque Tier 1 continuation', () => {
  const payload = safeContext();
  (payload.initialPage as { nextCursor: string | null }).nextCursor = ref('Y3Vyc29y');

  const context = parseMemberNetworkContext(payload);

  assert.equal(context.initialPage.nextCursor, ref('Y3Vyc29y'));
  assert.equal(context.initialPage.items.at(-1)?.kind, 'cluster');
  assert.equal(context.initialPage.items.filter((item) => item.kind === 'anonymous').at(-1)?.localTier, 3);
});

test('rejects anonymous PII, exact money, raw identifiers, and forbidden Tier 4 content before render', () => {
  const scenarios: Array<{ mutate: (payload: ReturnType<typeof safeContext>) => void; message: RegExp }> = [
    {
      mutate: (payload) => {
        (payload.initialPage.items[1] as Record<string, unknown>).displayName = 'Private Person';
      },
      message: /anonymous node contains forbidden field/i,
    },
    {
      mutate: (payload) => {
        (payload.initialPage.items[1] as Record<string, unknown>).visibleBranchVolumeCents = '99900';
      },
      message: /anonymous node contains forbidden field/i,
    },
    {
      mutate: (payload) => {
        (payload.initialPage.items[1] as Record<string, unknown>).nodeRef = '550e8400-e29b-41d4-a716-446655440000';
      },
      message: /opaque member node reference/i,
    },
    {
      mutate: (payload) => {
        (payload.initialPage.items[2] as Record<string, unknown>).canExpand = true;
      },
      message: /Tier 3 must be terminal/i,
    },
    {
      mutate: (payload) => {
        (payload.initialPage.items[2] as Record<string, unknown>).localTier = 4;
      },
      message: /local tier/i,
    },
  ];

  for (const scenario of scenarios) {
    const payload = safeContext();
    scenario.mutate(payload);
    assert.throws(() => parseMemberNetworkContext(payload), (error: unknown) => {
      assert.ok(error instanceof MemberNetworkPayloadError);
      assert.match(error.message, scenario.message);
      return true;
    });
  }
});

test('accepts the direct-search envelope only for named Tier 1 records', () => {
  const payload = safeContext();
  const direct = payload.initialPage.items[0];
  const result = parseMemberDirectSearchPage({
    items: [direct],
    nextCursor: ref('c2VhcmNoLWN1cnNvcg'),
    snapshotAt: payload.initialPage.snapshotAt,
  });

  assert.equal(result.items[0]?.kind, 'direct');
  assert.equal(result.nextCursor, ref('c2VhcmNoLWN1cnNvcg'));

  assert.throws(
    () =>
      parseMemberDirectSearchPage({
        parentRef: payload.initialPage.parentRef,
        items: [direct],
        nextCursor: null,
        snapshotAt: payload.initialPage.snapshotAt,
      }),
    MemberNetworkPayloadError,
  );
  assert.throws(
    () =>
      parseMemberDirectSearchPage({
        items: [payload.initialPage.items[1]],
        nextCursor: null,
        snapshotAt: payload.initialPage.snapshotAt,
      }),
    MemberNetworkPayloadError,
  );
});
