import type {
  AdminNetworkContext,
  AdminNetworkNode,
  BranchPage,
  MemberAnonymousNode,
  MemberAnonymousTier2Node,
  MemberAnonymousTier3Node,
  MemberNetworkContext,
  MemberVisibleNode,
  NetworkStatus,
} from "./network-hierarchy.types";

type ForbiddenAnonymousKey = Extract<
  keyof MemberAnonymousTier2Node | keyof MemberAnonymousTier3Node,
  | "membershipId"
  | "parentMembershipId"
  | "displayName"
  | "email"
  | "referralCode"
  | "commissionCents"
  | "balanceCents"
  | "approvedSales"
  | "teamVolumeCents"
  | "visibleBranchVolumeCents"
>;

describe("network hierarchy DTO contracts", () => {
  it("uses only the membership statuses supported by the database", () => {
    const statuses = [
      "active",
      "inactive",
    ] as const satisfies readonly NetworkStatus[];
    const exhaustive: Record<NetworkStatus, true> = {
      active: true,
      inactive: true,
    };

    expect(statuses).toEqual(Object.keys(exhaustive));
  });

  it("keeps Tier 2 and Tier 3 anonymous nodes free of identity and exact finance keys", () => {
    const noForbiddenKeys: ForbiddenAnonymousKey extends never ? true : false =
      true;
    const tier2: MemberAnonymousTier2Node = {
      kind: "anonymous",
      nodeRef: "opaque-tier-2",
      parentRef: "opaque-direct",
      localTier: 2,
      initials: "AB",
      label: "Tier 2 member",
      status: "active",
      visibleChildCount: 2,
      canExpand: true,
      performanceBand: {
        suppressed: false,
        approvedSalesBand: "1-4",
        volumeBand: "under1k",
      },
    };
    const tier3: MemberAnonymousTier3Node = {
      kind: "anonymous",
      nodeRef: "opaque-tier-3",
      parentRef: "opaque-tier-2",
      localTier: 3,
      initials: "CD",
      label: "Tier 3 member",
      status: "inactive",
      canExpand: false,
      performanceBand: { suppressed: true, reason: "smallCohort" },
    };
    const forbidden = [
      "membershipId",
      "parentMembershipId",
      "displayName",
      "email",
      "referralCode",
      "commissionCents",
      "balanceCents",
      "approvedSales",
      "teamVolumeCents",
      "visibleBranchVolumeCents",
    ];

    expect(noForbiddenKeys).toBe(true);
    expect(forbidden.some((key) => key in tier2 || key in tier3)).toBe(false);
    expect("visibleChildCount" in tier3).toBe(false);
  });

  it("models admin and member contexts with branch-local coverage metadata", () => {
    const adminPage: BranchPage<AdminNetworkNode> = {
      parentRef: "tenant-root",
      items: [],
      representedNodes: 0,
      nextCursor: null,
      snapshotAt: "2026-07-20T12:00:00.000Z",
    };
    const admin: AdminNetworkContext = {
      root: { kind: "tenantRoot", label: "Earnica" },
      focus: null,
      ancestors: [],
      initialPage: adminPage,
      scope: {
        kind: "full",
        loadedNodes: 0,
        representedNodes: 0,
        totalNodes: 0,
        complete: true,
        collapsedBranches: 0,
        snapshotAt: adminPage.snapshotAt,
        structuralCountsCoverage: "exact",
        metricsCoverage: "fullSubtree",
      },
      capabilities: {
        viewIdentity: true,
        viewFinancials: false,
        openMember: false,
        focusBranch: true,
      },
    };
    const memberPage: BranchPage<MemberVisibleNode> = {
      parentRef: "self",
      items: [],
      representedNodes: 0,
      nextCursor: null,
      snapshotAt: adminPage.snapshotAt,
    };
    const member: MemberNetworkContext = {
      sponsor: null,
      self: {
        kind: "self",
        nodeRef: "self",
        displayName: "Viewer",
        initials: "VI",
        referralCode: "VIEWER",
        status: "active",
        directCount: 0,
        visibleDownlineCount: 0,
        performance: {
          currency: "USD",
          period: "2026-07",
          visibleApprovedSales: 0,
          visibleTeamVolumeCents: "0",
        },
      },
      initialPage: memberPage,
      scope: {
        maxVisibleTier: 3,
        loadedNodes: 0,
        representedNodes: 0,
        completeWithinVisibleDepth: true,
        snapshotAt: memberPage.snapshotAt,
        structuralCountsCoverage: "visibleTiersExact",
        metricsCoverage: "visibleTiersExact",
      },
    };

    expect(admin.root.kind).toBe("tenantRoot");
    expect(admin.capabilities.viewFinancials).toBe(false);
    expect(member.scope.maxVisibleTier).toBe(3);
  });

  it("preserves the anonymous discriminated union at the DTO boundary", () => {
    const node: MemberAnonymousNode = {
      kind: "anonymous",
      nodeRef: "opaque",
      parentRef: "parent",
      localTier: 3,
      initials: "EF",
      label: "Tier 3 member",
      status: "active",
      canExpand: false,
      performanceBand: { suppressed: true, reason: "noData" },
    };

    expect(node.localTier).toBe(3);
    expect(node.canExpand).toBe(false);
  });
});
