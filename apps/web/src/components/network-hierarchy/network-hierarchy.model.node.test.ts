import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNetworkHierarchyModel,
  displayClusterLabel,
  exactTierClusterLabel,
  flattenVisibleHierarchy,
  formatHierarchyMoney,
  hierarchyNodePresentation,
  isHierarchyNodeExpandable,
  // @ts-expect-error Node's native TypeScript runner requires an explicit extension.
} from './network-hierarchy.model.ts';
import {
  parseAnonymousMemberInitials,
  parseOpaqueMemberNodeRef,
  // @ts-expect-error Node's native TypeScript runner requires an explicit extension.
} from './types.ts';
import type {
  AdminHierarchyClusterNode,
  AdminHierarchyMemberNode,
  MemberAnonymousTier2Node,
  MemberAnonymousTier3Node,
  MemberDirectNode,
  MemberSelfNode,
  MemberVisibleClusterNode,
} from './types';

const OPAQUE_SIGNATURE = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE';
const directRef = parseOpaqueMemberNodeRef(`ZGlyZWN0.${OPAQUE_SIGNATURE}`);
const tierTwoRef = parseOpaqueMemberNodeRef(`dGllci0y.${OPAQUE_SIGNATURE}`);
const tierThreeRef = parseOpaqueMemberNodeRef(`dGllci0z.${OPAQUE_SIGNATURE}`);

const self: MemberSelfNode = {
  kind: 'self',
  nodeRef: 'self',
  displayName: 'Taylor Jordan',
  initials: 'TJ',
  referralCode: 'TJ100',
  status: 'active',
  directCount: 1,
  visibleDownlineCount: 3,
  performance: {
    currency: 'USD',
    period: '2026-07',
    visibleApprovedSales: 4,
    visibleTeamVolumeCents: '125000',
  },
};
const direct: MemberDirectNode = {
  kind: 'direct',
  nodeRef: directRef,
  parentRef: 'self',
  localTier: 1,
  displayName: 'Morgan Lee',
  initials: 'ML',
  referralCode: 'ML200',
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
};
const tierTwo: MemberAnonymousTier2Node = {
  kind: 'anonymous',
  nodeRef: tierTwoRef,
  parentRef: directRef,
  localTier: 2,
  initials: parseAnonymousMemberInitials('AB'),
  label: 'Tier 2 member',
  status: 'active',
  visibleChildCount: 1,
  canExpand: true,
  performanceBand: {
    suppressed: false,
    approvedSalesBand: '1-4',
    volumeBand: 'under1k',
  },
};
const tierThree: MemberAnonymousTier3Node = {
  kind: 'anonymous',
  nodeRef: tierThreeRef,
  parentRef: tierTwoRef,
  localTier: 3,
  initials: parseAnonymousMemberInitials('CD'),
  label: 'Tier 3 member',
  status: 'inactive',
  canExpand: false,
  performanceBand: { suppressed: true, reason: 'smallCohort' },
};

test('indexes a flattened hierarchy once and expands through visible tiers', () => {
  const model = buildNetworkHierarchyModel([self, direct, tierTwo, tierThree]);
  const rows = flattenVisibleHierarchy(model, new Set(['self', directRef, tierTwoRef]));

  assert.deepEqual(
    rows.map(({ key, depth }) => [key, depth]),
    [
      ['self', 0],
      [directRef, 1],
      [tierTwoRef, 2],
      [tierThreeRef, 3],
    ],
  );
  assert.equal(model.childrenByParent.get(directRef)?.[0], tierTwoRef);
});

test('Tier 3 is terminal in both the type projection and render model', () => {
  assert.equal(isHierarchyNodeExpandable(tierThree, true), false);
  assert.equal(hierarchyNodePresentation(tierThree).detail, 'Visible-depth limit');
  assert.throws(
    () =>
      buildNetworkHierarchyModel([
        tierThree,
        {
          ...tierTwo,
          nodeRef: parseOpaqueMemberNodeRef(`aW1wb3NzaWJsZQ.${OPAQUE_SIGNATURE}`),
          parentRef: tierThreeRef,
        },
      ]),
    /Tier 3 member nodes are terminal/,
  );
});

test('cluster wording names one exact tier and never uses an ambiguous plus tier', () => {
  const cluster: AdminHierarchyClusterNode = {
    kind: 'cluster',
    clusterRef: 'cluster-ref',
    parentMembershipId: null,
    label: 'untrusted label',
    localTier: 2,
    representedNodes: 3,
    canExpand: true,
  };
  assert.equal(exactTierClusterLabel(3, 2), '+3 Tier 2 members');
  assert.equal(displayClusterLabel(cluster), '+3 Tier 2 members');
  assert.doesNotMatch(displayClusterLabel(cluster), /Tier 2\+/);
});

test('member clusters retain opaque references and can only represent Tier 2 or Tier 3', () => {
  const cluster: MemberVisibleClusterNode = {
    kind: 'cluster',
    clusterRef: parseOpaqueMemberNodeRef(`Y2x1c3Rlcg.${OPAQUE_SIGNATURE}`),
    parentRef: directRef,
    localTier: 2,
    label: 'Tier 2 members',
    representedNodes: 3,
    canExpand: true,
  };
  const model = buildNetworkHierarchyModel([self, direct, cluster]);

  assert.equal(model.childrenByParent.get(directRef)?.[0], `cluster:${cluster.clusterRef}`);
  assert.equal(displayClusterLabel(cluster), '+3 Tier 2 members');
});

test('missing or malformed optional money never reaches string trim formatting', () => {
  assert.equal(formatHierarchyMoney(undefined), 'Not available');
  assert.equal(formatHierarchyMoney(null), 'Not available');
  assert.equal(formatHierarchyMoney('not-cents'), 'Not available');
  assert.match(formatHierarchyMoney('125000', 'USD'), /1,250\.00/);
});

test('admin exact performance is capability-gated while member-safe summaries remain available', () => {
  const admin: AdminHierarchyMemberNode = {
    kind: 'member',
    membershipId: 'member-1',
    parentMembershipId: null,
    displayName: 'Admin-visible member',
    initials: 'AV',
    referralCode: 'AV100',
    status: 'active',
    rank: null,
    globalTier: 1,
    localTier: 1,
    directCount: 2,
    subtreeCount: 4,
    canExpand: true,
    performance: { currency: 'USD', period: '2026-07', approvedSales: 3, teamVolumeCents: '125000' },
  };

  assert.equal(hierarchyNodePresentation(admin).performance, null);
  assert.match(hierarchyNodePresentation(admin, { viewFinancials: true }).performance ?? '', /1,250\.00/);
  assert.match(hierarchyNodePresentation(tierTwo).performance ?? '', /approved sales/);
});

if (false) {
  const protectedTierTwo = tierTwo;
  const protectedTierThree = tierThree;
  const noRawUuidNodeRef: MemberAnonymousTier2Node = {
    ...protectedTierTwo,
    // @ts-expect-error Anonymous node references must be opaque signed references.
    nodeRef: '550e8400-e29b-41d4-a716-446655440000',
  };
  const noEmailParentRef: MemberAnonymousTier2Node = {
    ...protectedTierTwo,
    // @ts-expect-error Anonymous parent references must be opaque signed references.
    parentRef: 'member@example.com',
  };
  const noRawInitials: MemberAnonymousTier2Node = {
    ...protectedTierTwo,
    // @ts-expect-error Plain strings cannot bypass validated anonymous initials.
    initials: 'AB',
  };
  const noNameNodeRef: MemberAnonymousTier3Node = {
    ...protectedTierThree,
    // @ts-expect-error Names cannot become opaque references.
    nodeRef: 'Taylor Jordan',
  };
  const noRawUuidParentRef: MemberAnonymousTier3Node = {
    ...protectedTierThree,
    // @ts-expect-error Raw membership identifiers cannot become parent references.
    parentRef: '550e8400-e29b-41d4-a716-446655440000',
  };
  const noEmailInitials: MemberAnonymousTier3Node = {
    ...protectedTierThree,
    // @ts-expect-error Emails cannot become anonymous initials.
    initials: 'member@example.com',
  };
  void [noRawUuidNodeRef, noEmailParentRef, noRawInitials, noNameNodeRef, noRawUuidParentRef, noEmailInitials];
}
