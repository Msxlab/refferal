import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MembershipStatus, Prisma } from "@prisma/client";
import { ActorContext } from "../common/actor";
import { NetworkSnapshotExpiredException } from "./network-hierarchy.tokens";
import { NetworkHierarchyService } from "./network-hierarchy.service";

const ACTOR: ActorContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
};
const SNAPSHOT_AT = "2026-07-20T12:00:00.000Z";
const ROOT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";

type RawResolver = (label: string, query: Prisma.Sql) => unknown[];

function queryLabel(query: Prisma.Sql): string {
  const sql = query.strings.join(" ");
  return /network-hierarchy:([a-z-]+)/.exec(sql)?.[1] ?? "unknown";
}

function memberRow(index: number, overrides: Record<string, unknown> = {}) {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    id,
    sponsorMembershipId: null,
    referralCode: `REF${index}`,
    path: id.replaceAll("-", "_"),
    depth: 0,
    status: MembershipStatus.active,
    joinedAt: new Date(
      `2026-07-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
    ),
    fullName: `Member ${index}`,
    directCount: 0n,
    subtreeCount: 0n,
    branchCount: 1n,
    branchRepresentedNodes: 1n,
    ...overrides,
  };
}

function harness(resolveRaw: RawResolver = () => []) {
  const tx = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        name: "Acme",
        currency: "USD",
        timezone: "UTC",
      }),
    },
    membership: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue({
        id: ROOT_ID,
        sponsorMembershipId: null,
        referralCode: "ROOT",
        path: ROOT_ID.replaceAll("-", "_"),
        depth: 0,
        status: MembershipStatus.active,
        joinedAt: new Date("2026-07-01T00:00:00.000Z"),
        user: { fullName: "Root Member" },
      }),
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

describe("NetworkHierarchyService", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(SNAPSHOT_AT));
  });

  afterEach(() => jest.useRealTimers());

  it("rejects invalid full/focused combinations and hides cross-tenant focus and parents", async () => {
    const { service, tx } = harness();

    await expect(
      service.adminContext(ACTOR, {
        scope: "full",
        focusId: ROOT_ID,
        depth: 3,
        viewFinancials: false,
        openMember: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.adminContext(ACTOR, {
        scope: "focused",
        depth: 3,
        viewFinancials: false,
        openMember: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    tx.membership.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.adminContext(ACTOR, {
        scope: "focused",
        focusId: OTHER_ID,
        depth: 3,
        viewFinancials: false,
        openMember: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    tx.membership.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.adminChildren(ACTOR, {
        parentRef: OTHER_ID,
        snapshotAt: SNAPSHOT_AT,
        viewFinancials: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("caps child pages at 50, clusters the exact remainder, and expands that cluster", async () => {
    const firstRows = Array.from({ length: 51 }, (_, index) =>
      memberRow(index + 1, {
        branchCount: 51n,
        branchRepresentedNodes: 51n,
      }),
    );
    const remaining = memberRow(51);
    let branchRead = 0;
    const { service } = harness((label) => {
      if (label === "branch") {
        branchRead += 1;
        return branchRead === 1 ? firstRows : [remaining];
      }
      return [];
    });

    const first = await service.adminChildren(ACTOR, {
      parentRef: "tenant-root",
      snapshotAt: SNAPSHOT_AT,
      viewFinancials: false,
    });

    expect(first.items.filter((item) => item.kind === "member")).toHaveLength(
      50,
    );
    expect(first.items.at(-1)).toMatchObject({
      kind: "cluster",
      representedNodes: 1,
      canExpand: true,
    });
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.representedNodes).toBe(51);

    const cluster = first.items.at(-1);
    if (!cluster || cluster.kind !== "cluster")
      throw new Error("missing cluster");
    const expanded = await service.adminClusterChildren(ACTOR, {
      parentRef: "tenant-root",
      clusterRef: cluster.clusterRef,
      snapshotAt: SNAPSHOT_AT,
      viewFinancials: false,
    });

    expect(expanded.items).toHaveLength(1);
    expect(expanded.items[0]).toMatchObject({
      kind: "member",
      membershipId: remaining.id,
    });
    expect(expanded.nextCursor).toBeNull();
  });

  it("rejects a cursor replayed against another parent/scope binding before reading data", async () => {
    const rows = Array.from({ length: 51 }, (_, index) =>
      memberRow(index + 1, { branchCount: 51n, branchRepresentedNodes: 51n }),
    );
    const { service, tx } = harness((label) =>
      label === "branch" ? rows : [],
    );
    const first = await service.adminChildren(ACTOR, {
      parentRef: "tenant-root",
      snapshotAt: SNAPSHOT_AT,
      viewFinancials: false,
    });
    tx.$queryRaw.mockClear();
    tx.membership.findFirst.mockClear();

    await expect(
      service.adminChildren(ACTOR, {
        parentRef: OTHER_ID,
        cursor: first.nextCursor ?? undefined,
        snapshotAt: SNAPSHOT_AT,
        viewFinancials: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.membership.findFirst).not.toHaveBeenCalled();
  });

  it("audits search metadata without retaining the raw body query", async () => {
    const { service, tx } = harness((label) =>
      label === "search" ? [memberRow(1)] : [],
    );

    const result = await service.adminSearch(ACTOR, {
      query: "  Secret Person  ",
      viewFinancials: false,
    });

    expect(result.items).toHaveLength(1);
    const auditData = tx.auditLog.create.mock.calls[0][0].data;
    expect(JSON.stringify(auditData)).not.toContain("Secret Person");
    expect(auditData.after).toMatchObject({
      queryLength: 13,
      resultCount: 1,
      scope: "full",
    });
  });

  it("omits performance and performs no finance read when the capability is disabled", async () => {
    const labels: string[] = [];
    const { service } = harness((label) => {
      labels.push(label);
      return label === "branch"
        ? [memberRow(1, { directCount: 75n, subtreeCount: 900n })]
        : [];
    });

    const result = await service.adminChildren(ACTOR, {
      parentRef: "tenant-root",
      snapshotAt: SNAPSHOT_AT,
      viewFinancials: false,
    });

    expect(labels).not.toContain("financials");
    expect(result.items[0]).toMatchObject({
      directCount: 75,
      subtreeCount: 900,
    });
    expect(result.items[0]).not.toHaveProperty("performance");
  });

  it("uses authoritative structural counts even when only one node is loaded", async () => {
    const { service } = harness((label) =>
      label === "branch"
        ? [memberRow(1, { directCount: 83n, subtreeCount: 1204n })]
        : [],
    );

    const result = await service.adminChildren(ACTOR, {
      parentRef: "tenant-root",
      snapshotAt: SNAPSHOT_AT,
      viewFinancials: false,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: "member",
      directCount: 83,
      subtreeCount: 1204,
      canExpand: true,
    });
  });

  it("rejects an unsigned stale snapshot on initial child and list reads as generic bad requests", async () => {
    const { service, prisma } = harness();
    const staleSnapshotAt = "2026-07-20T11:44:59.999Z";

    await expect(
      service.adminChildren(ACTOR, {
        parentRef: "tenant-root",
        snapshotAt: staleSnapshotAt,
        viewFinancials: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.adminChildren(ACTOR, {
        parentRef: "tenant-root",
        snapshotAt: staleSnapshotAt,
        viewFinancials: false,
      }),
    ).rejects.not.toBeInstanceOf(NetworkSnapshotExpiredException);

    await expect(
      service.adminList(ACTOR, {
        scope: "full",
        snapshotAt: staleSnapshotAt,
        viewFinancials: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("stops depth-five breadth-first materialization at the 250-member budget before another level read", async () => {
    const rootRows = Array.from({ length: 50 }, (_, index) =>
      memberRow(index + 1, { depth: 0 }),
    );
    const secondLevelRows = Array.from({ length: 200 }, (_, index) =>
      memberRow(index + 51, {
        depth: 1,
        sponsorMembershipId: rootRows[Math.floor(index / 50)].id,
      }),
    );
    let levelRead = 0;
    const { service, tx } = harness((label) => {
      if (label === "context-level") {
        levelRead += 1;
        return levelRead === 1 ? rootRows : secondLevelRows;
      }
      if (label === "context-branches") return [];
      return [];
    });
    tx.membership.count.mockResolvedValue(10_000);

    const context = await service.adminContext(ACTOR, {
      scope: "full",
      depth: 5,
      viewFinancials: false,
      openMember: false,
    });

    expect(context.scope.loadedNodes).toBe(250);
    expect(context.initialPage.items).toHaveLength(250);
    expect(levelRead).toBe(2);
    expect(levelRead).toBeLessThanOrEqual(5);
    expect(
      tx.$queryRaw.mock.calls.map(([query]) => queryLabel(query)),
    ).not.toEqual(expect.arrayContaining(["context-members"]));
  });

  it("reserves the focus member slot when a focused context reaches the global budget", async () => {
    const directChildren = Array.from({ length: 50 }, (_, index) =>
      memberRow(index + 1, {
        sponsorMembershipId: ROOT_ID,
        depth: 1,
        subtreeCount: 4n,
      }),
    );
    const grandchildren = Array.from({ length: 200 }, (_, index) =>
      memberRow(index + 51, {
        sponsorMembershipId: directChildren[Math.floor(index / 4)].id,
        depth: 2,
      }),
    );
    let contextLevelRead = 0;
    const { service } = harness((label) => {
      if (label === "member-counts")
        return [{ directCount: 50n, subtreeCount: 250n }];
      if (label === "ancestors") return [];
      if (label === "context-level") {
        contextLevelRead += 1;
        return contextLevelRead === 1 ? directChildren : grandchildren;
      }
      if (label === "context-branches")
        return [
          {
            parentMembershipId: ROOT_ID,
            directCount: 50n,
            representedNodes: 250n,
          },
          ...directChildren.map((child) => ({
            parentMembershipId: child.id,
            directCount: 4n,
            representedNodes: 4n,
          })),
        ];
      return [];
    });

    const context = await service.adminContext(ACTOR, {
      scope: "focused",
      focusId: ROOT_ID,
      depth: 5,
      viewFinancials: false,
      openMember: false,
    });

    expect(
      context.initialPage.items.filter((item) => item.kind === "member"),
    ).toHaveLength(249);
    expect(context.scope.loadedNodes).toBeLessThanOrEqual(250);
    expect(context.scope).toMatchObject({
      loadedNodes: 250,
      representedNodes: 251,
      totalNodes: 251,
      complete: true,
    });
    expect(context.initialPage.items.at(-1)).toMatchObject({
      kind: "cluster",
      parentMembershipId: directChildren.at(-1)!.id,
      representedNodes: 1,
    });
  });

  it("initializes context in repeatable read and reports exact focused coverage", async () => {
    const child = memberRow(2, {
      sponsorMembershipId: ROOT_ID,
      depth: 1,
      directCount: 0n,
      subtreeCount: 0n,
    });
    let contextLevelRead = 0;
    const { service, prisma } = harness((label) => {
      if (label === "member-counts")
        return [{ directCount: 1n, subtreeCount: 1n }];
      if (label === "ancestors") return [];
      if (label === "context-level") {
        contextLevelRead += 1;
        return contextLevelRead === 1 ? [child] : [];
      }
      if (label === "context-branches")
        return [
          {
            parentMembershipId: ROOT_ID,
            directCount: 1n,
            representedNodes: 1n,
          },
        ];
      return [];
    });

    const context = await service.adminContext(ACTOR, {
      scope: "focused",
      focusId: ROOT_ID,
      depth: 3,
      viewFinancials: false,
      openMember: true,
    });

    expect(context.focus).toMatchObject({
      membershipId: ROOT_ID,
      localTier: 1,
    });
    expect(context.initialPage.items).toHaveLength(1);
    expect(context.scope).toMatchObject({
      loadedNodes: 2,
      representedNodes: 2,
      totalNodes: 2,
      complete: true,
      structuralCountsCoverage: "exact",
    });
    expect(context.capabilities).toMatchObject({
      viewFinancials: false,
      openMember: true,
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });
});
