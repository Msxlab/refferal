import { BadRequestException } from "@nestjs/common";
import { MembershipStatus, Prisma } from "@prisma/client";
import { authConfig } from "../auth/auth.config";
import { ActorContext } from "../common/actor";
import { encryptSecret } from "../common/crypto";
import {
  createHierarchyMemberReferenceToken,
  createHierarchyReferenceToken,
  HIERARCHY_REFERENCE_TTL_MS,
  NetworkSnapshotExpiredException,
} from "./network-hierarchy.tokens";
import {
  isAnonymousMemberInitials,
  isOpaqueMemberNodeRef,
  MemberDirectSearchPage,
  MemberNetworkContext,
} from "./network-hierarchy.types";
import { NetworkHierarchyService } from "./network-hierarchy.service";

const ACTOR: ActorContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
};
const ROOT_ID = "33333333-3333-4333-8333-333333333333";
const SPONSOR_ID = "44444444-4444-4444-8444-444444444444";
const DIRECT_ID = "55555555-5555-4555-8555-555555555555";
const TIER_TWO_ID = "66666666-6666-4666-8666-666666666666";
const TIER_THREE_ID = "77777777-7777-4777-8777-777777777777";
const TIER_FOUR_SENTINEL = "DO-NOT-SERIALIZE-TIER-FOUR";
const SNAPSHOT_AT = "2026-07-20T12:00:00.000Z";

type RawResolver = (label: string, query: Prisma.Sql) => unknown[];

function queryLabel(query: Prisma.Sql): string {
  const sql = query.strings.join(" ");
  return /network-hierarchy:([a-z-]+)/.exec(sql)?.[1] ?? "unknown";
}

function memberRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sponsorMembershipId: null,
    referralCode: `REF-${id.slice(0, 4)}`,
    path: id.replaceAll("-", "_"),
    depth: 0,
    status: MembershipStatus.active,
    joinedAt: new Date("2026-07-01T00:00:00.000Z"),
    fullName: "Member Example",
    localTier: 1,
    visibleDirectCount: 0n,
    visibleBranchCount: 0n,
    visibleChildCount: 0n,
    ...overrides,
  };
}

function harness(resolveRaw: RawResolver) {
  const root = {
    id: ROOT_ID,
    userId: ACTOR.userId,
    sponsorMembershipId: SPONSOR_ID,
    referralCode: "SELF-REF",
    path: ROOT_ID.replaceAll("-", "_"),
    depth: 0,
    status: MembershipStatus.active,
    joinedAt: new Date("2026-07-01T00:00:00.000Z"),
    user: { fullName: "Viewer Member" },
  };
  const tx = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        name: "Acme",
        currency: "USD",
        timezone: "UTC",
      }),
    },
    membership: {
      findFirst: jest.fn().mockResolvedValue(root),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn((query: Prisma.Sql) =>
      Promise.resolve(resolveRaw(queryLabel(query), query)),
    ),
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  return {
    service: new NetworkHierarchyService(prisma as never),
    prisma,
    tx,
  };
}

describe("NetworkHierarchyService member projection", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(SNAPSHOT_AT));
  });

  afterEach(() => jest.useRealTimers());

  it("serializes only the approved sponsor, self, Tier 1 identity, and anonymous Tier 2-3 data", async () => {
    const direct = memberRow(DIRECT_ID, {
      sponsorMembershipId: ROOT_ID,
      depth: 1,
      fullName: "Direct Person",
      referralCode: "DIRECT-REF",
      visibleDirectCount: 1n,
      visibleBranchCount: 2n,
    });
    const tierTwo = memberRow(TIER_TWO_ID, {
      sponsorMembershipId: DIRECT_ID,
      depth: 2,
      fullName: "Tier Two Private",
      referralCode: "T2-PRIVATE",
      localTier: 2,
      visibleChildCount: 1n,
    });
    const tierThree = memberRow(TIER_THREE_ID, {
      sponsorMembershipId: TIER_TWO_ID,
      depth: 3,
      fullName: "Tier Three Private",
      referralCode: "T3-PRIVATE",
      localTier: 3,
    });
    let levelRead = 0;
    const { service } = harness((label) => {
      if (label === "member-root-counts") {
        return [{ directCount: 1n, visibleDownlineCount: 3n }];
      }
      if (label === "member-sponsor") {
        return [
          memberRow(SPONSOR_ID, {
            fullName: "Approved Sponsor",
            referralCode: "SPONSOR-REF",
          }),
        ];
      }
      if (label === "member-context-level") {
        levelRead += 1;
        return levelRead === 1
          ? [direct]
          : levelRead === 2
            ? [tierTwo]
            : [tierThree];
      }
      if (label === "member-performance") {
        return [
          {
            membershipId: ROOT_ID,
            cohortCount: 4n,
            approvedSales: 8n,
            teamVolumeCents: 120_000n,
          },
          {
            membershipId: DIRECT_ID,
            cohortCount: 3n,
            approvedSales: 5n,
            teamVolumeCents: 60_000n,
          },
          {
            membershipId: TIER_TWO_ID,
            cohortCount: 2n,
            approvedSales: 4n,
            teamVolumeCents: 20_000n,
          },
          {
            membershipId: TIER_THREE_ID,
            cohortCount: 1n,
            approvedSales: 1n,
            teamVolumeCents: 5_000n,
          },
        ];
      }
      return [];
    });

    const memberService = service as unknown as {
      memberContext(
        actor: ActorContext,
        input: { rootMembershipId: string },
      ): Promise<MemberNetworkContext>;
    };
    const context = await memberService.memberContext(ACTOR, {
      rootMembershipId: ROOT_ID,
    });
    const serialized = JSON.stringify(context);
    const directNode = context.initialPage.items.find(
      (item) => item.kind === "direct",
    );
    const anonymousNodes = context.initialPage.items.filter(
      (item) => item.kind === "anonymous",
    );
    const tierThreeNode = anonymousNodes.find((item) => item.localTier === 3);

    expect(context.sponsor).toEqual({
      kind: "sponsor",
      displayName: "Approved Sponsor",
      initials: "AS",
      referralCode: "SPONSOR-REF",
      status: "active",
    });
    expect(context.self).toMatchObject({
      kind: "self",
      nodeRef: "self",
      displayName: "Viewer Member",
      directCount: 1,
      visibleDownlineCount: 3,
      performance: {
        currency: "USD",
        period: "2026-07",
        visibleApprovedSales: 8,
        visibleTeamVolumeCents: "120000",
      },
    });
    expect(directNode).toMatchObject({
      kind: "direct",
      displayName: "Direct Person",
      referralCode: "DIRECT-REF",
      visibleDirectCount: 1,
      visibleBranchCount: 2,
      performance: {
        approvedSales: 5,
        visibleBranchVolumeCents: "60000",
      },
    });
    if (!directNode || directNode.kind !== "direct") {
      throw new Error("missing direct node");
    }
    expect(isOpaqueMemberNodeRef(directNode.nodeRef)).toBe(true);
    expect(anonymousNodes).toHaveLength(2);
    expect(anonymousNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localTier: 2,
          label: "Tier 2 member",
          visibleChildCount: 1,
          canExpand: true,
          performanceBand: { suppressed: true, reason: "smallCohort" },
        }),
        expect.objectContaining({
          localTier: 3,
          label: "Tier 3 member",
          canExpand: false,
          performanceBand: { suppressed: true, reason: "smallCohort" },
        }),
      ]),
    );
    expect(
      anonymousNodes.every((node) => isOpaqueMemberNodeRef(node.nodeRef)),
    ).toBe(true);
    expect(
      anonymousNodes.every((node) => isAnonymousMemberInitials(node.initials)),
    ).toBe(true);
    expect(tierThreeNode).not.toHaveProperty("visibleChildCount");
    expect(serialized).not.toContain(TIER_TWO_ID);
    expect(serialized).not.toContain(TIER_THREE_ID);
    expect(serialized).not.toContain("Tier Two Private");
    expect(serialized).not.toContain("Tier Three Private");
    expect(serialized).not.toContain("T2-PRIVATE");
    expect(serialized).not.toContain("T3-PRIVATE");
    expect(serialized).not.toContain(TIER_FOUR_SENTINEL);
  });

  it("collapses only omitted Tier 2 siblings into an exact opaque member cluster", async () => {
    const direct = memberRow(DIRECT_ID, {
      sponsorMembershipId: ROOT_ID,
      depth: 1,
      fullName: "Direct Person",
      visibleDirectCount: 51n,
      visibleBranchCount: 51n,
    });
    const tierTwoRows = Array.from({ length: 51 }, (_, index) =>
      memberRow(
        `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        {
          sponsorMembershipId: DIRECT_ID,
          depth: 2,
          fullName: `Tier Two ${index + 1}`,
          localTier: 2,
        },
      ),
    );
    let levelRead = 0;
    const { service } = harness((label) => {
      if (label === "member-root-counts") {
        return [{ directCount: 1n, visibleDownlineCount: 52n }];
      }
      if (label === "member-sponsor") return [];
      if (label === "member-context-level") {
        levelRead += 1;
        return levelRead === 1
          ? [direct]
          : levelRead === 2
            ? tierTwoRows.slice(0, 50)
            : [];
      }
      if (label === "member-branch-summaries") {
        return [
          { parentMembershipId: ROOT_ID, directCount: 1n },
          { parentMembershipId: DIRECT_ID, directCount: 51n },
        ];
      }
      if (label === "member-parent-candidates") {
        return [memberRow(ROOT_ID, { depth: 0 }), direct];
      }
      if (label === "member-children") return [tierTwoRows.at(-1)!];
      if (label === "member-performance") return [];
      return [];
    });
    const memberService = service as unknown as {
      memberContext(
        actor: ActorContext,
        input: { rootMembershipId: string },
      ): Promise<MemberNetworkContext>;
      memberChildren(
        actor: ActorContext,
        input: {
          rootMembershipId: string;
          parentRef: string;
          cursor?: string;
          snapshotAt: string;
        },
      ): Promise<MemberNetworkContext["initialPage"]>;
    };

    const context = await memberService.memberContext(ACTOR, {
      rootMembershipId: ROOT_ID,
    });
    const directNode = context.initialPage.items.find(
      (item) => item.kind === "direct",
    );
    const cluster = context.initialPage.items.find(
      (item) => item.kind === "cluster",
    );
    if (!directNode || directNode.kind !== "direct" || !cluster) {
      throw new Error("missing direct node or visible-tier cluster");
    }

    expect(cluster).toMatchObject({
      kind: "cluster",
      parentRef: directNode.nodeRef,
      localTier: 2,
      label: "Tier 2 members",
      representedNodes: 1,
      canExpand: true,
    });
    if (cluster.kind !== "cluster") throw new Error("missing cluster");
    expect(isOpaqueMemberNodeRef(cluster.clusterRef)).toBe(true);
    expect(
      Buffer.from(cluster.clusterRef.split(".")[0], "base64url").toString(
        "utf8",
      ),
    ).not.toContain(tierTwoRows.at(49)!.id);
    expect(JSON.stringify(cluster)).not.toContain(DIRECT_ID);
    expect(JSON.stringify(cluster)).not.toContain(TIER_FOUR_SENTINEL);

    const expanded = await memberService.memberChildren(ACTOR, {
      rootMembershipId: ROOT_ID,
      parentRef: directNode.nodeRef,
      cursor: cluster.clusterRef,
      snapshotAt: context.scope.snapshotAt,
    });
    expect(expanded.items).toEqual([
      expect.objectContaining({
        kind: "anonymous",
        localTier: 2,
        parentRef: directNode.nodeRef,
      }),
    ]);
    expect(JSON.stringify(expanded)).not.toContain(tierTwoRows.at(-1)!.id);
    expect(JSON.stringify(expanded)).not.toContain("Tier Two 51");
  });

  it("continues Tier 1 overflow from the opaque root parent without silently hiding named directs", async () => {
    const directRows = Array.from({ length: 51 }, (_, index) =>
      memberRow(
        `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        {
          sponsorMembershipId: ROOT_ID,
          depth: 1,
          fullName: `Direct ${index + 1}`,
          referralCode: `DIRECT-${index + 1}`,
        },
      ),
    );
    let levelRead = 0;
    const { service } = harness((label) => {
      if (label === "member-root-counts") {
        return [{ directCount: 51n, visibleDownlineCount: 51n }];
      }
      if (label === "member-sponsor") return [];
      if (label === "member-context-level") {
        levelRead += 1;
        return levelRead === 1 ? directRows.slice(0, 50) : [];
      }
      if (label === "member-branch-summaries") {
        return [{ parentMembershipId: ROOT_ID, directCount: 51n }];
      }
      if (label === "member-parent-candidates") {
        return [memberRow(ROOT_ID, { depth: 0 })];
      }
      if (label === "member-children") return [directRows.at(-1)!];
      if (label === "member-performance") return [];
      return [];
    });
    const memberService = service as unknown as {
      memberContext(
        actor: ActorContext,
        input: { rootMembershipId: string },
      ): Promise<MemberNetworkContext>;
      memberChildren(
        actor: ActorContext,
        input: {
          rootMembershipId: string;
          parentRef: string;
          cursor?: string;
          snapshotAt: string;
        },
      ): Promise<MemberNetworkContext["initialPage"]>;
    };

    const context = await memberService.memberContext(ACTOR, {
      rootMembershipId: ROOT_ID,
    });
    const outerRootPayload = Buffer.from(
      context.initialPage.parentRef.split(".")[0],
      "base64url",
    ).toString("utf8");
    const outerCursorPayload = Buffer.from(
      context.initialPage.nextCursor!.split(".")[0],
      "base64url",
    ).toString("utf8");

    expect(
      context.initialPage.items.filter((item) => item.kind === "direct"),
    ).toHaveLength(50);
    expect(context.initialPage.nextCursor).toEqual(expect.any(String));
    expect(context.scope.completeWithinVisibleDepth).toBe(false);
    expect(outerRootPayload).not.toContain(ROOT_ID);
    expect(outerCursorPayload).not.toContain(directRows.at(49)!.id);

    const next = await memberService.memberChildren(ACTOR, {
      rootMembershipId: ROOT_ID,
      parentRef: context.initialPage.parentRef,
      cursor: context.initialPage.nextCursor ?? undefined,
      snapshotAt: context.scope.snapshotAt,
    });
    expect(next.items).toEqual([
      expect.objectContaining({
        kind: "direct",
        displayName: "Direct 51",
        referralCode: "DIRECT-51",
        parentRef: "self",
      }),
    ]);
    expect(JSON.stringify(next)).not.toContain(TIER_FOUR_SENTINEL);
  });

  it("searches and audits only named Tier 1 directs without retaining the raw query", async () => {
    const directRows = Array.from({ length: 51 }, (_, index) =>
      memberRow(
        `51000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        {
          sponsorMembershipId: ROOT_ID,
          depth: 1,
          fullName: `Secret Direct ${index + 1}`,
          referralCode: `SECRET-${index + 1}`,
          branchCount: 51n,
        },
      ),
    );
    const { service, tx } = harness((label) => {
      if (label === "member-direct-search") return directRows;
      if (label === "member-performance") return [];
      return [];
    });
    const memberService = service as unknown as {
      memberDirectSearch(
        actor: ActorContext,
        input: { rootMembershipId: string; query: string; cursor?: string },
      ): Promise<MemberDirectSearchPage>;
    };

    const result = await memberService.memberDirectSearch(ACTOR, {
      rootMembershipId: ROOT_ID,
      query: "  Secret Direct  ",
    });
    const rawQuery = tx.$queryRaw.mock.calls
      .map(([query]) => query as Prisma.Sql)
      .find((query) => queryLabel(query) === "member-direct-search");
    const performanceQuery = tx.$queryRaw.mock.calls
      .map(([query]) => query as Prisma.Sql)
      .find((query) => queryLabel(query) === "member-performance");
    const auditData = tx.auditLog.create.mock.calls[0][0].data;

    expect(result.items).toHaveLength(50);
    expect(result.items.every((item) => item.kind === "direct")).toBe(true);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain(TIER_TWO_ID);
    expect(JSON.stringify(result)).not.toContain(TIER_FOUR_SENTINEL);
    expect(
      Buffer.from(result.nextCursor!.split(".")[0], "base64url").toString(
        "utf8",
      ),
    ).not.toContain(directRows.at(-1)!.id);
    expect(rawQuery?.strings.join(" ")).toContain("m.sponsor_membership_id =");
    expect(rawQuery?.strings.join(" ")).toContain("m.depth =");
    expect(performanceQuery?.strings.join(" ")).toContain(
      "count(DISTINCT visible_member.id)::bigint",
    );
    expect(JSON.stringify(auditData)).not.toContain("Secret Direct");
    expect(auditData.after).toEqual({
      queryLength: 13,
      resultCount: 50,
      scope: "tier1-direct",
      paginated: false,
    });
  });

  it("expands only visible tiers and refuses a Tier 3 parent before a child read", async () => {
    const direct = memberRow(DIRECT_ID, {
      sponsorMembershipId: ROOT_ID,
      depth: 1,
      fullName: "Direct Person",
      referralCode: "DIRECT-REF",
      visibleDirectCount: 1n,
      visibleBranchCount: 2n,
    });
    const tierTwo = memberRow(TIER_TWO_ID, {
      sponsorMembershipId: DIRECT_ID,
      depth: 2,
      fullName: "Tier Two Private",
      localTier: 2,
      visibleChildCount: 1n,
    });
    const tierThree = memberRow(TIER_THREE_ID, {
      sponsorMembershipId: TIER_TWO_ID,
      depth: 3,
      fullName: "Tier Three Private",
      localTier: 3,
    });
    let levelRead = 0;
    const { service, tx } = harness((label) => {
      if (label === "member-root-counts") {
        return [{ directCount: 1n, visibleDownlineCount: 3n }];
      }
      if (label === "member-sponsor") return [];
      if (label === "member-context-level") {
        levelRead += 1;
        return levelRead === 1
          ? [direct]
          : levelRead === 2
            ? [tierTwo]
            : [tierThree];
      }
      if (label === "member-parent-candidates") {
        return [
          memberRow(ROOT_ID, {
            userId: ACTOR.userId,
            sponsorMembershipId: SPONSOR_ID,
            depth: 0,
          }),
          direct,
          tierTwo,
        ];
      }
      if (label === "member-children") return [tierTwo];
      if (label === "member-performance") {
        return [
          {
            membershipId: ROOT_ID,
            cohortCount: 4n,
            approvedSales: 0n,
            teamVolumeCents: 0n,
          },
          {
            membershipId: DIRECT_ID,
            cohortCount: 3n,
            approvedSales: 0n,
            teamVolumeCents: 0n,
          },
          {
            membershipId: TIER_TWO_ID,
            cohortCount: 2n,
            approvedSales: 0n,
            teamVolumeCents: 0n,
          },
        ];
      }
      return [];
    });
    const memberService = service as unknown as {
      memberContext(
        actor: ActorContext,
        input: { rootMembershipId: string },
      ): Promise<MemberNetworkContext>;
      memberChildren(
        actor: ActorContext,
        input: {
          rootMembershipId: string;
          parentRef: string;
          snapshotAt: string;
          cursor?: string;
        },
      ): Promise<MemberNetworkContext["initialPage"]>;
    };
    const context = await memberService.memberContext(ACTOR, {
      rootMembershipId: ROOT_ID,
    });
    const directNode = context.initialPage.items.find(
      (item) => item.kind === "direct",
    );
    const tierThreeNode = context.initialPage.items.find(
      (item) => item.kind === "anonymous" && item.localTier === 3,
    );
    if (!directNode || directNode.kind !== "direct" || !tierThreeNode) {
      throw new Error("missing visible hierarchy nodes");
    }

    tx.$queryRaw.mockClear();
    const children = await memberService.memberChildren(ACTOR, {
      rootMembershipId: ROOT_ID,
      parentRef: directNode.nodeRef,
      snapshotAt: context.scope.snapshotAt,
    });

    expect(children.parentRef).toBe(directNode.nodeRef);
    expect(children.items).toEqual([
      expect.objectContaining({
        kind: "anonymous",
        localTier: 2,
        parentRef: directNode.nodeRef,
      }),
    ]);
    expect(JSON.stringify(children)).not.toContain(TIER_TWO_ID);
    expect(JSON.stringify(children)).not.toContain("Tier Two Private");

    tx.$queryRaw.mockClear();
    await expect(
      memberService.memberChildren(ACTOR, {
        rootMembershipId: ROOT_ID,
        parentRef: tierThreeNode.nodeRef,
        snapshotAt: context.scope.snapshotAt,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      tx.$queryRaw.mock.calls.map(([query]) => queryLabel(query)),
    ).not.toContain("member-children");
  });

  it("treats a tampered parent plus an expired continuation as a generic invalid request before DB work", async () => {
    const { service, prisma } = harness(() => []);
    const rootBinding = `member-tree:${ROOT_ID}`;
    const validParentRef = createHierarchyMemberReferenceToken({
      actor: ACTOR,
      membershipId: ROOT_ID,
      parentRef: rootBinding,
      snapshotAt: SNAPSHOT_AT,
    });
    const sealedKeyset = Buffer.from(
      encryptSecret(
        JSON.stringify({
          v: 1,
          joinedAt: "2026-07-01T00:00:00.000Z",
          id: DIRECT_ID,
        }),
        authConfig.accessSecret(),
      ),
      "utf8",
    ).toString("base64url");
    const expiredCursor = createHierarchyReferenceToken("cursor", {
      actor: ACTOR,
      parentRef: validParentRef,
      snapshotAt: SNAPSHOT_AT,
      subject: sealedKeyset,
    });
    const tamperedParentRef = `${validParentRef.slice(0, -1)}${
      validParentRef.endsWith("A") ? "B" : "A"
    }`;
    const memberService = service as unknown as {
      memberChildren(
        actor: ActorContext,
        input: {
          rootMembershipId: string;
          parentRef: string;
          cursor?: string;
          snapshotAt: string;
        },
      ): Promise<MemberNetworkContext["initialPage"]>;
    };

    jest.setSystemTime(
      new Date(Date.parse(SNAPSHOT_AT) + HIERARCHY_REFERENCE_TTL_MS + 1),
    );
    await expect(
      memberService.memberChildren(ACTOR, {
        rootMembershipId: ROOT_ID,
        parentRef: tamperedParentRef,
        cursor: expiredCursor,
        snapshotAt: SNAPSHOT_AT,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects foreign member refs before DB work and reserves 409 for a valid expired ref", async () => {
    const { service, prisma } = harness(() => []);
    const parentRef = createHierarchyMemberReferenceToken({
      actor: ACTOR,
      membershipId: ROOT_ID,
      parentRef: `member-tree:${ROOT_ID}`,
      snapshotAt: SNAPSHOT_AT,
    });
    const memberService = service as unknown as {
      memberChildren(
        actor: ActorContext,
        input: {
          rootMembershipId: string;
          parentRef: string;
          cursor?: string;
          snapshotAt: string;
        },
      ): Promise<MemberNetworkContext["initialPage"]>;
    };

    await expect(
      memberService.memberChildren(
        { ...ACTOR, userId: SPONSOR_ID },
        {
          rootMembershipId: ROOT_ID,
          parentRef,
          snapshotAt: SNAPSHOT_AT,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();

    jest.setSystemTime(
      new Date(Date.parse(SNAPSHOT_AT) + HIERARCHY_REFERENCE_TTL_MS + 1),
    );
    await expect(
      memberService.memberChildren(ACTOR, {
        rootMembershipId: ROOT_ID,
        parentRef,
        snapshotAt: SNAPSHOT_AT,
      }),
    ).rejects.toBeInstanceOf(NetworkSnapshotExpiredException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
