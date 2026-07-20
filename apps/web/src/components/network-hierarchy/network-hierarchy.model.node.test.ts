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
import type {
  AdminHierarchyClusterNode,
  MemberAnonymousTier2Node,
  MemberAnonymousTier3Node,
  MemberDirectNode,
  MemberSelfNode,
} from './types';

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
  nodeRef: 'direct-ref',
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
  nodeRef: 'tier-two-ref',
  parentRef: 'direct-ref',
  localTier: 2,
  initials: 'AB',
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
  nodeRef: 'tier-three-ref',
  parentRef: 'tier-two-ref',
  localTier: 3,
  initials: 'CD',
  label: 'Tier 3 member',
  status: 'inactive',
  canExpand: false,
  performanceBand: { suppressed: true, reason: 'smallCohort' },
};

test('indexes a flattened hierarchy once and expands through visible tiers', () => {
  const model = buildNetworkHierarchyModel([self, direct, tierTwo, tierThree]);
  const rows = flattenVisibleHierarchy(model, new Set(['self', 'direct-ref', 'tier-two-ref']));

  assert.deepEqual(
    rows.map(({ key, depth }) => [key, depth]),
    [
      ['self', 0],
      ['direct-ref', 1],
      ['tier-two-ref', 2],
      ['tier-three-ref', 3],
    ],
  );
  assert.equal(model.childrenByParent.get('direct-ref')?.[0], 'tier-two-ref');
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
          nodeRef: 'impossible-child',
          parentRef: 'tier-three-ref',
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

test('missing or malformed optional money never reaches string trim formatting', () => {
  assert.equal(formatHierarchyMoney(undefined), 'Not available');
  assert.equal(formatHierarchyMoney(null), 'Not available');
  assert.equal(formatHierarchyMoney('not-cents'), 'Not available');
  assert.match(formatHierarchyMoney('125000', 'USD'), /1,250\.00/);
});
