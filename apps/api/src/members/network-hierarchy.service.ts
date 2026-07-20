import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MembershipStatus, Prisma, PrismaClient } from "@prisma/client";
import { authConfig } from "../auth/auth.config";
import { ActorContext } from "../common/actor";
import { decryptSecret, encryptSecret, sha256 } from "../common/crypto";
import { monthKey } from "../engine/month";
import { PrismaService } from "../prisma/prisma.service";
import {
  createHierarchyMemberReferenceToken,
  createHierarchyReferenceToken,
  HIERARCHY_REFERENCE_TTL_MS,
  HIERARCHY_TOKEN_MAX_LENGTH,
  hierarchyMemberReferenceMatches,
  verifyHierarchyReferenceToken,
} from "./network-hierarchy.tokens";
import {
  AdminClusterNode,
  AdminMemberNode,
  AdminNetworkContext,
  AdminNetworkNode,
  BranchPage,
  MemberAnonymousNode,
  MemberDirectSearchPage,
  MemberDirectNode,
  MemberNetworkContext,
  MemberPerformanceBand,
  MemberSponsorNode,
  MemberVisibleNode,
  MemberVisibleClusterNode,
  OpaqueMemberNodeRef,
  parseAnonymousMemberInitials,
  parseOpaqueMemberNodeRef,
} from "./network-hierarchy.types";

export const ADMIN_HIERARCHY_PAGE_SIZE = 50;
export const ADMIN_CONTEXT_NODE_BUDGET = 250;
export const MEMBER_MAX_VISIBLE_TIER = 3;
export const TENANT_ROOT_REF = "tenant-root" as const;

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

type AdminScope = "full" | "focused";

interface HierarchyReadCapabilities {
  viewFinancials: boolean;
}

export interface AdminContextInput extends HierarchyReadCapabilities {
  scope: AdminScope;
  focusId?: string;
  depth: number;
  openMember: boolean;
}

export interface AdminChildrenInput extends HierarchyReadCapabilities {
  parentRef: string;
  focusId?: string;
  cursor?: string;
  snapshotAt: string;
}

export interface AdminClusterChildrenInput extends HierarchyReadCapabilities {
  parentRef: string;
  focusId?: string;
  clusterRef: string;
  snapshotAt: string;
}

export interface AdminListInput extends HierarchyReadCapabilities {
  scope: AdminScope;
  focusId?: string;
  cursor?: string;
  snapshotAt: string;
}

export interface AdminSearchInput extends HierarchyReadCapabilities {
  query: string;
  cursor?: string;
}

export interface MemberContextInput {
  rootMembershipId: string;
}

export interface MemberChildrenInput {
  rootMembershipId: string;
  parentRef: string;
  cursor?: string;
  snapshotAt: string;
}

export interface MemberDirectSearchInput {
  rootMembershipId: string;
  query: string;
  cursor?: string;
}

export interface AdminSearchPage {
  items: AdminMemberNode[];
  nextCursor: string | null;
  snapshotAt: string;
}

interface MembershipRecord {
  id: string;
  sponsorMembershipId: string | null;
  referralCode: string;
  path: string;
  depth: number;
  status: MembershipStatus;
  joinedAt: Date;
  fullName: string;
  directCount: bigint;
  subtreeCount: bigint;
  branchCount?: bigint;
  branchRepresentedNodes?: bigint;
}

interface MembershipLookup {
  id: string;
  sponsorMembershipId: string | null;
  referralCode: string;
  path: string;
  depth: number;
  status: MembershipStatus;
  joinedAt: Date;
  user: { fullName: string };
}

interface BranchSummaryRecord {
  parentMembershipId: string | null;
  directCount: bigint;
  representedNodes: bigint;
}

interface FinancialRecord {
  membershipId: string;
  approvedSales: bigint;
  teamVolumeCents: bigint;
}

interface Keyset {
  joinedAt: string;
  id: string;
}

interface ScopeAnchor {
  scope: AdminScope;
  focus: MembershipLookup | null;
}

interface MemberRootRecord extends MembershipLookup {
  userId: string;
}

interface MemberVisibleRecord {
  id: string;
  sponsorMembershipId: string | null;
  referralCode: string;
  path: string;
  depth: number;
  status: MembershipStatus;
  joinedAt: Date;
  fullName: string;
  localTier: 1 | 2 | 3;
  visibleDirectCount?: bigint;
  visibleBranchCount?: bigint;
  visibleChildCount?: bigint;
  branchCount?: bigint;
}

interface MemberRootCounts {
  directCount: bigint;
  visibleDownlineCount: bigint;
}

interface MemberSponsorRecord {
  referralCode: string;
  status: MembershipStatus;
  fullName: string;
}

interface MemberPerformanceRecord {
  membershipId: string;
  cohortCount: bigint;
  approvedSales: bigint;
  teamVolumeCents: bigint;
}

interface MemberBranchSummaryRecord {
  parentMembershipId: string;
  directCount: bigint;
}

interface MemberParentRecord {
  id: string;
  path: string;
  depth: number;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function badRequest(message = "invalid hierarchy request"): never {
  throw new BadRequestException(message);
}

function canonicalDate(value: string): boolean {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function safeCount(value: bigint | number): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("network hierarchy count exceeds the safe response range");
  }
  return count;
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "?";
  const last = Array.from(parts.at(-1) ?? parts[0])[0] ?? "?";
  return `${first}${last}`.toLocaleUpperCase("en-US");
}

function anonymousInitials(fullName: string) {
  const letters = Array.from(fullName.normalize("NFC").toLocaleUpperCase("en-US"))
    .filter((character) => /\p{Lu}/u.test(character));
  const first = letters[0] ?? "X";
  const last = letters.at(-1) ?? first;
  return parseAnonymousMemberInitials(`${first}${last}`);
}

function encodeKeyset(after?: Keyset): string {
  const payload = after
    ? { v: 1, joinedAt: after.joinedAt, id: after.id }
    : { v: 1 };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function parseKeyset(subject: string): Keyset | undefined {
  let decoded: string;
  try {
    const bytes = Buffer.from(subject, "base64url");
    if (bytes.toString("base64url") !== subject) badRequest();
    decoded = bytes.toString("utf8");
  } catch {
    badRequest();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    badRequest();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    badRequest();
  const value = parsed as Record<string, unknown>;
  if (value.v !== 1) badRequest();
  if (Object.keys(value).length === 1) return undefined;
  if (
    Object.keys(value).sort().join(",") !== "id,joinedAt,v" ||
    typeof value.joinedAt !== "string" ||
    !canonicalDate(value.joinedAt) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id)
  ) {
    badRequest();
  }
  return { joinedAt: value.joinedAt, id: value.id };
}

/** Member cursors and cluster continuations must not expose a membership UUID. */
function encodeMemberKeyset(after?: Keyset): string {
  const payload = after
    ? { v: 1, joinedAt: after.joinedAt, id: after.id }
    : { v: 1 };
  const sealed = encryptSecret(
    JSON.stringify(payload),
    authConfig.accessSecret(),
  );
  return Buffer.from(sealed, "utf8").toString("base64url");
}

function parseMemberKeyset(subject: string): Keyset | undefined {
  if (
    typeof subject !== "string" ||
    subject.length === 0 ||
    subject.length > HIERARCHY_TOKEN_MAX_LENGTH ||
    !BASE64URL.test(subject)
  ) {
    badRequest();
  }
  let decoded: string;
  try {
    const sealed = Buffer.from(subject, "base64url");
    if (sealed.toString("base64url") !== subject) badRequest();
    decoded = decryptSecret(sealed.toString("utf8"), authConfig.accessSecret());
  } catch {
    badRequest();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    badRequest();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    badRequest();
  const value = parsed as Record<string, unknown>;
  if (value.v !== 1) badRequest();
  if (Object.keys(value).length === 1) return undefined;
  if (
    Object.keys(value).sort().join(",") !== "id,joinedAt,v" ||
    typeof value.joinedAt !== "string" ||
    !canonicalDate(value.joinedAt) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id)
  ) {
    badRequest();
  }
  return { joinedAt: value.joinedAt, id: value.id };
}

/**
 * Reads one untrusted field only so body-only search cursors can supply their snapshot
 * binding. The caller must immediately pass it to verifyHierarchyReferenceToken.
 */
function extractUntrustedSnapshotAt(token: string): string {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > HIERARCHY_TOKEN_MAX_LENGTH
  ) {
    badRequest();
  }
  const parts = token.split(".");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !BASE64URL.test(parts[0]) ||
    !parts[1]
  ) {
    badRequest();
  }
  let decoded: string;
  try {
    const bytes = Buffer.from(parts[0], "base64url");
    if (bytes.toString("base64url") !== parts[0]) badRequest();
    decoded = bytes.toString("utf8");
  } catch {
    badRequest();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    badRequest();
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    badRequest();
  const snapshotAt = (payload as Record<string, unknown>).snapshotAt;
  if (typeof snapshotAt !== "string" || !canonicalDate(snapshotAt))
    badRequest();
  return snapshotAt;
}

@Injectable()
export class NetworkHierarchyService {
  constructor(private readonly prisma: PrismaService) {}

  async adminContext(
    actor: ActorContext,
    input: AdminContextInput,
  ): Promise<AdminNetworkContext> {
    this.assertScope(input.scope, input.focusId);
    if (!Number.isInteger(input.depth) || input.depth < 1 || input.depth > 5)
      badRequest();
    const snapshotAt = new Date().toISOString();

    return this.repeatableRead(async (tx) => {
      const tenant = await this.tenant(tx, actor.tenantId);
      const anchor = await this.resolveScope(
        tx,
        actor.tenantId,
        input.scope,
        input.focusId,
        snapshotAt,
      );
      const focusRecord = anchor.focus
        ? await this.withAuthoritativeCounts(
            tx,
            actor.tenantId,
            anchor.focus,
            snapshotAt,
          )
        : null;
      const ancestorRows = anchor.focus
        ? await this.readAncestors(tx, actor.tenantId, anchor.focus, snapshotAt)
        : [];
      const rows = await this.readContextMembers(
        tx,
        actor.tenantId,
        anchor,
        input.depth,
        snapshotAt,
        ADMIN_CONTEXT_NODE_BUDGET - (anchor.focus ? 1 : 0),
      );
      const branchSummaries = await this.readContextBranchSummaries(
        tx,
        actor.tenantId,
        anchor,
        rows,
        input.depth,
        snapshotAt,
      );
      const performance = input.viewFinancials
        ? await this.readFinancials(
            tx,
            actor.tenantId,
            tenant.currency,
            tenant.timezone,
            [...(focusRecord ? [focusRecord] : []), ...ancestorRows, ...rows],
            snapshotAt,
          )
        : new Map<string, AdminMemberNode["performance"]>();
      const localTier = (row: MembershipRecord) =>
        anchor.focus ? row.depth - anchor.focus.depth + 1 : row.depth + 1;
      const memberItems = rows.map((row) =>
        this.toAdminNode(row, localTier(row), performance.get(row.id)),
      );
      const clusters = this.contextClusters(
        actor,
        anchor,
        rows,
        branchSummaries,
        snapshotAt,
      );
      const pageItems: AdminNetworkNode[] = [...memberItems, ...clusters];
      const focus = focusRecord
        ? this.toAdminNode(focusRecord, 1, performance.get(focusRecord.id))
        : null;
      const ancestors = ancestorRows.map((row) =>
        this.toAdminNode(row, localTier(row), performance.get(row.id)),
      );
      const totalNodes = focusRecord
        ? safeCount(focusRecord.subtreeCount) + 1
        : await this.totalTenantMembers(tx, actor.tenantId, snapshotAt);
      const loadedNodes = rows.length + (focus ? 1 : 0);
      const representedNodes =
        loadedNodes +
        clusters.reduce((sum, node) => sum + node.representedNodes, 0);

      return {
        root: { kind: "tenantRoot", label: tenant.name },
        focus,
        ancestors,
        initialPage: {
          parentRef: anchor.focus?.id ?? TENANT_ROOT_REF,
          items: pageItems,
          representedNodes: Math.max(0, representedNodes - (focus ? 1 : 0)),
          nextCursor: null,
          snapshotAt,
        },
        scope: {
          kind: input.scope,
          loadedNodes,
          representedNodes,
          totalNodes,
          complete: representedNodes === totalNodes,
          collapsedBranches: clusters.length,
          snapshotAt,
          structuralCountsCoverage: "exact",
          metricsCoverage: "fullSubtree",
        },
        capabilities: {
          viewIdentity: true,
          viewFinancials: input.viewFinancials,
          openMember: input.openMember,
          focusBranch: true,
        },
      };
    });
  }

  async memberContext(
    actor: ActorContext,
    input: MemberContextInput,
  ): Promise<MemberNetworkContext> {
    if (!UUID.test(input.rootMembershipId)) badRequest();
    const snapshotAt = new Date().toISOString();

    return this.repeatableRead(async (tx) => {
      const tenant = await this.tenant(tx, actor.tenantId);
      const root = await this.resolveMemberRoot(
        tx,
        actor,
        input.rootMembershipId,
        snapshotAt,
      );
      const [counts, sponsor, rows] = await Promise.all([
        this.readMemberRootCounts(tx, actor.tenantId, root, snapshotAt),
        this.readMemberSponsor(tx, actor.tenantId, root, snapshotAt),
        this.readMemberContextMembers(tx, actor.tenantId, root, snapshotAt),
      ]);
      const branchSummaries = await this.readMemberBranchSummaries(
        tx,
        actor.tenantId,
        root,
        rows,
        snapshotAt,
      );
      const performance = await this.readMemberPerformance(
        tx,
        actor.tenantId,
        root,
        [root, ...rows],
        tenant.timezone,
        snapshotAt,
      );
      const rootBinding = this.memberRootBinding(root.id);
      const rootParentRef = this.memberNodeRef(
        actor,
        rootBinding,
        root.id,
        snapshotAt,
      );
      const refsById = new Map<string, OpaqueMemberNodeRef>([
        [root.id, rootParentRef],
      ]);
      const memberItems = rows.map((row) => {
        const nodeRef = this.memberNodeRef(
          actor,
          rootBinding,
          row.id,
          snapshotAt,
        );
        const parentRef =
          row.localTier === 1
            ? "self"
            : refsById.get(row.sponsorMembershipId ?? "");
        if (!parentRef) throw new Error("visible hierarchy parent missing");
        refsById.set(row.id, nodeRef);
        return this.toMemberVisibleNode(
          row,
          nodeRef,
          parentRef,
          performance.get(row.id),
          tenant.currency,
          monthKey(new Date(snapshotAt), tenant.timezone),
        );
      });
      const clusters = this.memberContextClusters(
        actor,
        root,
        rows,
        branchSummaries,
        refsById,
        snapshotAt,
      );
      const items: MemberVisibleNode[] = [...memberItems, ...clusters];
      const rootPerformance = performance.get(root.id);
      const loadedNodes = rows.length + 1;
      const representedNodes =
        loadedNodes +
        clusters.reduce((sum, cluster) => sum + cluster.representedNodes, 0);
      const directRows = rows.filter((row) => row.localTier === 1);
      const initialPageNextCursor =
        safeCount(counts.directCount) > directRows.length && directRows.length
          ? this.memberCursorToken(
              actor,
              rootParentRef,
              snapshotAt,
              directRows.at(-1)!,
            )
          : null;

      return {
        sponsor,
        self: {
          kind: "self",
          nodeRef: "self",
          displayName: root.user.fullName,
          initials: initials(root.user.fullName),
          referralCode: root.referralCode,
          status: root.status,
          directCount: safeCount(counts.directCount),
          visibleDownlineCount: safeCount(counts.visibleDownlineCount),
          performance: {
            currency: tenant.currency,
            period: monthKey(new Date(snapshotAt), tenant.timezone),
            visibleApprovedSales: safeCount(
              rootPerformance?.approvedSales ?? 0n,
            ),
            visibleTeamVolumeCents: (
              rootPerformance?.teamVolumeCents ?? 0n
            ).toString(),
          },
        },
        initialPage: {
          parentRef: rootParentRef,
          items,
          representedNodes:
            rows.length +
            clusters.reduce(
              (sum, cluster) => sum + cluster.representedNodes,
              0,
            ),
          nextCursor: initialPageNextCursor,
          snapshotAt,
        },
        scope: {
          maxVisibleTier: MEMBER_MAX_VISIBLE_TIER,
          loadedNodes,
          representedNodes,
          completeWithinVisibleDepth:
            representedNodes === safeCount(counts.visibleDownlineCount) + 1,
          snapshotAt,
          structuralCountsCoverage: "visibleTiersExact",
          metricsCoverage: "visibleTiersExact",
        },
      };
    });
  }

  /**
   * Reads a member-visible sibling page. `cursor` accepts either an ordinary
   * page cursor or a cluster continuation so the public route needs no extra
   * query parameter for cluster expansion.
   */
  async memberChildren(
    actor: ActorContext,
    input: MemberChildrenInput,
  ): Promise<BranchPage<MemberVisibleNode>> {
    if (!UUID.test(input.rootMembershipId)) badRequest();
    const rootBinding = this.memberRootBinding(input.rootMembershipId);
    const after = this.memberContinuationAfter(actor, input);
    const parentPayload = verifyHierarchyReferenceToken(input.parentRef, {
      kind: "member",
      actor,
      parentRef: rootBinding,
      snapshotAt: input.snapshotAt,
    });

    return this.repeatableRead(async (tx) => {
      const root = await this.resolveMemberRoot(
        tx,
        actor,
        input.rootMembershipId,
        input.snapshotAt,
      );
      const parent = await this.resolveMemberParent(
        tx,
        actor,
        root,
        rootBinding,
        parentPayload.subject,
        input.snapshotAt,
      );
      const childLocalTier = parent.depth - root.depth + 1;
      if (
        !Number.isInteger(childLocalTier) ||
        childLocalTier < 1 ||
        childLocalTier > MEMBER_MAX_VISIBLE_TIER
      ) {
        badRequest("member network branch cannot be expanded");
      }
      const childTier = childLocalTier as 1 | 2 | 3;

      const rows = await this.readMemberChildren(
        tx,
        actor.tenantId,
        root,
        parent,
        childTier,
        after,
        input.snapshotAt,
      );
      const visible = rows.slice(0, ADMIN_HIERARCHY_PAGE_SIZE);
      const tenant = await this.tenant(tx, actor.tenantId);
      const performance = await this.readMemberPerformance(
        tx,
        actor.tenantId,
        root,
        visible,
        tenant.timezone,
        input.snapshotAt,
      );
      const parentRef = parseOpaqueMemberNodeRef(input.parentRef);
      const nodeParentRef = childTier === 1 ? "self" : parentRef;
      const period = monthKey(new Date(input.snapshotAt), tenant.timezone);
      const items: MemberVisibleNode[] = visible.map((row) =>
        this.toMemberVisibleNode(
          row,
          this.memberNodeRef(actor, rootBinding, row.id, input.snapshotAt),
          nodeParentRef,
          performance.get(row.id),
          tenant.currency,
          period,
        ),
      );
      const branchCount = rows[0]?.branchCount
        ? safeCount(rows[0].branchCount)
        : rows.length;
      const hasMore = branchCount > visible.length;
      const remaining = Math.max(0, branchCount - visible.length);
      if (hasMore && childTier !== 1 && visible.length) {
        const clusterTier = childTier as 2 | 3;
        items.push({
          kind: "cluster",
          clusterRef: this.memberClusterToken(
            actor,
            parentRef,
            input.snapshotAt,
            visible.at(-1)!,
          ),
          parentRef,
          localTier: clusterTier,
          label:
            clusterTier === 2 ? "Tier 2 members" : "Tier 3 members",
          representedNodes: remaining,
          canExpand: true,
        });
      }
      const nextCursor =
        hasMore && visible.length
          ? this.memberCursorToken(
              actor,
              parentRef,
              input.snapshotAt,
              visible.at(-1)!,
            )
          : null;

      return {
        parentRef,
        items,
        representedNodes:
          visible.length + (childTier >= 2 ? remaining : 0),
        nextCursor,
        snapshotAt: input.snapshotAt,
      };
    });
  }

  /** Searches named Tier 1 direct recruits only; deeper identities never enter this path. */
  async memberDirectSearch(
    actor: ActorContext,
    input: MemberDirectSearchInput,
  ): Promise<MemberDirectSearchPage> {
    if (!UUID.test(input.rootMembershipId)) badRequest();
    if (typeof input.query !== "string") badRequest();
    const query = input.query.trim();
    if (query.length < 2 || query.length > 120) badRequest();
    const binding = this.memberSearchBinding(input.rootMembershipId, query);
    const cursor = input.cursor;
    const hasCursor = cursor !== undefined;
    const snapshotAt = hasCursor
      ? extractUntrustedSnapshotAt(cursor)
      : new Date().toISOString();
    const after = hasCursor
      ? parseMemberKeyset(
          verifyHierarchyReferenceToken(cursor, {
            kind: "cursor",
            actor,
            parentRef: binding,
            snapshotAt,
          }).subject,
        )
      : undefined;

    return this.repeatableRead(async (tx) => {
      const root = await this.resolveMemberRoot(
        tx,
        actor,
        input.rootMembershipId,
        snapshotAt,
      );
      const [tenant, rows] = await Promise.all([
        this.tenant(tx, actor.tenantId),
        this.readMemberDirectSearch(
          tx,
          actor.tenantId,
          root,
          query,
          after,
          snapshotAt,
        ),
      ]);
      const visible = rows.slice(0, ADMIN_HIERARCHY_PAGE_SIZE);
      const performance = await this.readMemberPerformance(
        tx,
        actor.tenantId,
        root,
        visible,
        tenant.timezone,
        snapshotAt,
      );
      const period = monthKey(new Date(snapshotAt), tenant.timezone);
      const items = visible.map((row) =>
        this.toMemberVisibleNode(
          row,
          this.memberNodeRef(
            actor,
            this.memberRootBinding(root.id),
            row.id,
            snapshotAt,
          ),
          "self",
          performance.get(row.id),
          tenant.currency,
          period,
        ),
      );
      const directItems = items.filter(
        (item): item is MemberDirectNode => item.kind === "direct",
      );
      const branchCount = rows[0]?.branchCount
        ? safeCount(rows[0].branchCount)
        : rows.length;
      const hasMore = branchCount > visible.length;
      const nextCursor =
        hasMore && visible.length
          ? this.memberSearchCursorToken(
              actor,
              binding,
              snapshotAt,
              visible.at(-1)!,
            )
          : null;
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "network.member_direct_search",
          entity: "network",
          entityId: null,
          after: {
            queryLength: query.length,
            resultCount: directItems.length,
            scope: "tier1-direct",
            paginated: hasCursor,
          },
        },
      });
      return { items: directItems, nextCursor, snapshotAt };
    });
  }

  async adminChildren(
    actor: ActorContext,
    input: AdminChildrenInput,
  ): Promise<BranchPage<AdminNetworkNode>> {
    const binding = this.branchBinding(input.parentRef, input.focusId);
    const after = input.cursor
      ? parseKeyset(
          verifyHierarchyReferenceToken(input.cursor, {
            kind: "cursor",
            actor,
            parentRef: binding,
            snapshotAt: input.snapshotAt,
          }).subject,
        )
      : (this.assertActiveSnapshot(input.snapshotAt), undefined);

    return this.repeatableRead(async (tx) => {
      const parent = await this.resolveParent(
        tx,
        actor.tenantId,
        input.parentRef,
        input.focusId,
        input.snapshotAt,
      );
      return this.readBranchPage(
        tx,
        actor,
        parent,
        input.focusId,
        after,
        input.snapshotAt,
        input.viewFinancials,
      );
    });
  }

  async adminClusterChildren(
    actor: ActorContext,
    input: AdminClusterChildrenInput,
  ): Promise<BranchPage<AdminNetworkNode>> {
    const binding = this.branchBinding(input.parentRef, input.focusId);
    const payload = verifyHierarchyReferenceToken(input.clusterRef, {
      kind: "cluster",
      actor,
      parentRef: binding,
      snapshotAt: input.snapshotAt,
    });
    const after = parseKeyset(payload.subject);

    return this.repeatableRead(async (tx) => {
      const parent = await this.resolveParent(
        tx,
        actor.tenantId,
        input.parentRef,
        input.focusId,
        input.snapshotAt,
      );
      return this.readBranchPage(
        tx,
        actor,
        parent,
        input.focusId,
        after,
        input.snapshotAt,
        input.viewFinancials,
      );
    });
  }

  async adminList(
    actor: ActorContext,
    input: AdminListInput,
  ): Promise<BranchPage<AdminMemberNode>> {
    this.assertScope(input.scope, input.focusId);
    const binding = this.listBinding(input.scope, input.focusId);
    const after = input.cursor
      ? parseKeyset(
          verifyHierarchyReferenceToken(input.cursor, {
            kind: "cursor",
            actor,
            parentRef: binding,
            snapshotAt: input.snapshotAt,
          }).subject,
        )
      : (this.assertActiveSnapshot(input.snapshotAt), undefined);

    return this.repeatableRead(async (tx) => {
      const anchor = await this.resolveScope(
        tx,
        actor.tenantId,
        input.scope,
        input.focusId,
        input.snapshotAt,
      );
      const rows = await this.readListRows(
        tx,
        actor.tenantId,
        anchor,
        after,
        input.snapshotAt,
      );
      const visible = rows.slice(0, ADMIN_HIERARCHY_PAGE_SIZE);
      const tenant = input.viewFinancials
        ? await this.tenant(tx, actor.tenantId)
        : null;
      const performance = tenant
        ? await this.readFinancials(
            tx,
            actor.tenantId,
            tenant.currency,
            tenant.timezone,
            visible,
            input.snapshotAt,
          )
        : new Map<string, AdminMemberNode["performance"]>();
      const items = visible.map((row) =>
        this.toAdminNode(
          row,
          anchor.focus ? row.depth - anchor.focus.depth + 1 : row.depth + 1,
          performance.get(row.id),
        ),
      );
      const nextCursor =
        rows.length > ADMIN_HIERARCHY_PAGE_SIZE && visible.length
          ? this.cursorToken(actor, binding, input.snapshotAt, visible.at(-1)!)
          : null;
      return {
        parentRef: anchor.focus?.id ?? TENANT_ROOT_REF,
        items,
        representedNodes: items.length,
        nextCursor,
        snapshotAt: input.snapshotAt,
      };
    });
  }

  async adminSearch(
    actor: ActorContext,
    input: AdminSearchInput,
  ): Promise<AdminSearchPage> {
    const query = input.query.trim();
    if (query.length < 2 || query.length > 120) badRequest();
    const binding = `search:${sha256(query)}`;
    const snapshotAt = input.cursor
      ? extractUntrustedSnapshotAt(input.cursor)
      : new Date().toISOString();
    const after = input.cursor
      ? parseKeyset(
          verifyHierarchyReferenceToken(input.cursor, {
            kind: "cursor",
            actor,
            parentRef: binding,
            snapshotAt,
          }).subject,
        )
      : undefined;

    return this.repeatableRead(async (tx) => {
      const rows = await this.readSearchRows(
        tx,
        actor.tenantId,
        query,
        after,
        snapshotAt,
      );
      const visible = rows.slice(0, ADMIN_HIERARCHY_PAGE_SIZE);
      const tenant = input.viewFinancials
        ? await this.tenant(tx, actor.tenantId)
        : null;
      const performance = tenant
        ? await this.readFinancials(
            tx,
            actor.tenantId,
            tenant.currency,
            tenant.timezone,
            visible,
            snapshotAt,
          )
        : new Map<string, AdminMemberNode["performance"]>();
      const items = visible.map((row) =>
        this.toAdminNode(row, row.depth + 1, performance.get(row.id)),
      );
      const nextCursor =
        rows.length > ADMIN_HIERARCHY_PAGE_SIZE && visible.length
          ? this.cursorToken(actor, binding, snapshotAt, visible.at(-1)!)
          : null;
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "network.search",
          entity: "network",
          entityId: null,
          after: {
            queryLength: query.length,
            resultCount: items.length,
            scope: "full",
            paginated: Boolean(input.cursor),
          },
        },
      });
      return { items, nextCursor, snapshotAt };
    });
  }

  private repeatableRead<T>(
    callback: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  private memberRootBinding(rootMembershipId: string): string {
    return `member-tree:${rootMembershipId}`;
  }

  private memberSearchBinding(rootMembershipId: string, query: string): string {
    return `member-direct-search:${rootMembershipId}:${sha256(query)}`;
  }

  private memberNodeRef(
    actor: ActorContext,
    rootBinding: string,
    membershipId: string,
    snapshotAt: string,
  ): OpaqueMemberNodeRef {
    return createHierarchyMemberReferenceToken({
      actor,
      membershipId,
      parentRef: rootBinding,
      snapshotAt,
    });
  }

  private memberCursorToken(
    actor: ActorContext,
    parentRef: OpaqueMemberNodeRef,
    snapshotAt: string,
    row: Pick<MemberVisibleRecord, "joinedAt" | "id">,
  ): string {
    return createHierarchyReferenceToken("cursor", {
      actor,
      parentRef,
      snapshotAt,
      subject: encodeMemberKeyset({
        joinedAt: row.joinedAt.toISOString(),
        id: row.id,
      }),
    });
  }

  private memberSearchCursorToken(
    actor: ActorContext,
    binding: string,
    snapshotAt: string,
    row: Pick<MemberVisibleRecord, "joinedAt" | "id">,
  ): string {
    return createHierarchyReferenceToken("cursor", {
      actor,
      parentRef: binding,
      snapshotAt,
      subject: encodeMemberKeyset({
        joinedAt: row.joinedAt.toISOString(),
        id: row.id,
      }),
    });
  }

  private memberClusterToken(
    actor: ActorContext,
    parentRef: OpaqueMemberNodeRef,
    snapshotAt: string,
    row?: Pick<MemberVisibleRecord, "joinedAt" | "id">,
  ): OpaqueMemberNodeRef {
    return parseOpaqueMemberNodeRef(
      createHierarchyReferenceToken("cluster", {
        actor,
        parentRef,
        snapshotAt,
        subject: encodeMemberKeyset(
          row
            ? { joinedAt: row.joinedAt.toISOString(), id: row.id }
            : undefined,
        ),
      }),
    );
  }

  /** Validate continuation material before opening a transaction or resolving a member. */
  private memberContinuationAfter(
    actor: ActorContext,
    input: MemberChildrenInput,
  ): Keyset | undefined {
    if (input.cursor === undefined) return undefined;
    const binding = {
      actor,
      parentRef: input.parentRef,
      snapshotAt: input.snapshotAt,
    };
    try {
      return parseMemberKeyset(
        verifyHierarchyReferenceToken(input.cursor, {
          kind: "cursor",
          ...binding,
        }).subject,
      );
    } catch (error) {
      // A cluster is deliberately passed through the same strict `cursor`
      // query field. Invalid or replayed tokens remain generic and no DB work
      // has happened when this fallback is attempted.
      if (!(error instanceof BadRequestException)) throw error;
      return parseMemberKeyset(
        verifyHierarchyReferenceToken(input.cursor, {
          kind: "cluster",
          ...binding,
        }).subject,
      );
    }
  }

  private async resolveMemberRoot(
    tx: TransactionClient,
    actor: ActorContext,
    rootMembershipId: string,
    snapshotAt: string,
  ): Promise<MemberRootRecord> {
    const root = await tx.membership.findFirst({
      where: {
        id: rootMembershipId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        joinedAt: { lte: new Date(snapshotAt) },
      },
      select: {
        id: true,
        userId: true,
        sponsorMembershipId: true,
        referralCode: true,
        path: true,
        depth: true,
        status: true,
        joinedAt: true,
        user: { select: { fullName: true } },
      },
    });
    if (!root) throw new NotFoundException("member network root not found");
    return root;
  }

  /**
   * Resolves a signed opaque member reference from the only expandable scope:
   * self, Tier 1, and Tier 2. Tier 3 has no candidate here, so it is rejected
   * before a child query can ever inspect a non-visible tier.
   */
  private async resolveMemberParent(
    tx: TransactionClient,
    actor: ActorContext,
    root: MemberRootRecord,
    rootBinding: string,
    memberReference: string,
    snapshotAt: string,
  ): Promise<MemberParentRecord> {
    const candidates = await tx.$queryRaw<MemberParentRecord[]>(Prisma.sql`
      /* network-hierarchy:member-parent-candidates */
      SELECT m.id::text AS "id", m.path, m.depth
      FROM memberships m
      WHERE m.tenant_id = ${actor.tenantId}::uuid
        AND m.path::ltree <@ ${root.path}::ltree
        AND m.depth >= ${root.depth}
        AND m.depth <= ${root.depth + 2}
        AND m.joined_at <= ${new Date(snapshotAt)}
      ORDER BY m.depth ASC, m.joined_at ASC, m.id ASC`);
    let resolved: MemberParentRecord | undefined;
    for (const candidate of candidates) {
      const matches = hierarchyMemberReferenceMatches(memberReference, {
        actor,
        membershipId: candidate.id,
        parentRef: rootBinding,
        snapshotAt,
      });
      // Do every bounded candidate comparison so the response does not reveal
      // which candidate, if any, matched the opaque subject.
      if (matches && !resolved) resolved = candidate;
    }
    if (!resolved) {
      badRequest("member network branch cannot be expanded");
    }
    return resolved;
  }

  private async readMemberRootCounts(
    tx: TransactionClient,
    tenantId: string,
    root: MemberRootRecord,
    snapshotAt: string,
  ): Promise<MemberRootCounts> {
    const rows = await tx.$queryRaw<MemberRootCounts[]>(Prisma.sql`
      /* network-hierarchy:member-root-counts */
      SELECT
        (SELECT count(*)::bigint
           FROM memberships direct_member
          WHERE direct_member.tenant_id = ${tenantId}::uuid
            AND direct_member.sponsor_membership_id = ${root.id}::uuid
            AND direct_member.path::ltree <@ ${root.path}::ltree
            AND direct_member.depth = ${root.depth + 1}
            AND direct_member.joined_at <= ${new Date(snapshotAt)}) AS "directCount",
        (SELECT count(*)::bigint
           FROM memberships visible_member
          WHERE visible_member.tenant_id = ${tenantId}::uuid
            AND visible_member.path::ltree <@ ${root.path}::ltree
            AND visible_member.depth > ${root.depth}
            AND visible_member.depth <= ${root.depth + MEMBER_MAX_VISIBLE_TIER}
            AND visible_member.joined_at <= ${new Date(snapshotAt)})
          AS "visibleDownlineCount"`);
    return rows[0] ?? { directCount: 0n, visibleDownlineCount: 0n };
  }

  private async readMemberSponsor(
    tx: TransactionClient,
    tenantId: string,
    root: MemberRootRecord,
    snapshotAt: string,
  ): Promise<MemberSponsorNode | null> {
    if (!root.sponsorMembershipId) return null;
    const rows = await tx.$queryRaw<MemberSponsorRecord[]>(Prisma.sql`
      /* network-hierarchy:member-sponsor */
      SELECT m.referral_code AS "referralCode", m.status, u.full_name AS "fullName"
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId}::uuid
        AND m.id = ${root.sponsorMembershipId}::uuid
        AND m.joined_at <= ${new Date(snapshotAt)}
      LIMIT 1`);
    const sponsor = rows[0];
    return sponsor
      ? {
          kind: "sponsor",
          displayName: sponsor.fullName,
          initials: initials(sponsor.fullName),
          referralCode: sponsor.referralCode,
          status: sponsor.status,
        }
      : null;
  }

  private async readMemberContextMembers(
    tx: TransactionClient,
    tenantId: string,
    root: MemberRootRecord,
    snapshotAt: string,
  ): Promise<MemberVisibleRecord[]> {
    const rows: MemberVisibleRecord[] = [];
    let frontier = [root.id];

    for (
      let localTier = 1;
      localTier <= MEMBER_MAX_VISIBLE_TIER &&
      frontier.length > 0 &&
      rows.length < ADMIN_CONTEXT_NODE_BUDGET - 1;
      localTier += 1
    ) {
      const remaining = ADMIN_CONTEXT_NODE_BUDGET - 1 - rows.length;
      const levelRows = await this.readMemberLevel(
        tx,
        tenantId,
        root,
        frontier,
        localTier as 1 | 2 | 3,
        snapshotAt,
        remaining,
      );
      const accepted = levelRows.slice(0, remaining);
      rows.push(...accepted);
      frontier = accepted.map((row) => row.id);
    }

    return rows;
  }

  private readMemberBranchSummaries(
    tx: TransactionClient,
    tenantId: string,
    root: MemberRootRecord,
    rows: MemberVisibleRecord[],
    snapshotAt: string,
  ): Promise<MemberBranchSummaryRecord[]> {
    const parentIds = [
      root.id,
      ...rows
        .filter((row) => row.localTier < MEMBER_MAX_VISIBLE_TIER)
        .map((row) => row.id),
    ];
    const parents = Prisma.join(
      parentIds.map((parentId) => Prisma.sql`${parentId}::uuid`),
    );
    return tx.$queryRaw<MemberBranchSummaryRecord[]>(Prisma.sql`
      /* network-hierarchy:member-branch-summaries */
      SELECT m.sponsor_membership_id::text AS "parentMembershipId",
             count(*)::bigint AS "directCount"
      FROM memberships m
      WHERE m.tenant_id = ${tenantId}::uuid
        AND m.sponsor_membership_id IN (${parents})
        AND m.path::ltree <@ ${root.path}::ltree
        AND m.depth > ${root.depth}
        AND m.depth <= ${root.depth + MEMBER_MAX_VISIBLE_TIER}
        AND m.joined_at <= ${new Date(snapshotAt)}
      GROUP BY m.sponsor_membership_id`);
  }

  private memberContextClusters(
    actor: ActorContext,
    root: MemberRootRecord,
    rows: MemberVisibleRecord[],
    summaries: MemberBranchSummaryRecord[],
    refsById: ReadonlyMap<string, OpaqueMemberNodeRef>,
    snapshotAt: string,
  ): MemberVisibleClusterNode[] {
    const rowsByParent = new Map<string, MemberVisibleRecord[]>();
    for (const row of rows) {
      if (!row.sponsorMembershipId) continue;
      const siblings = rowsByParent.get(row.sponsorMembershipId) ?? [];
      siblings.push(row);
      rowsByParent.set(row.sponsorMembershipId, siblings);
    }
    const rowsById = new Map(rows.map((row) => [row.id, row] as const));
    const clusters: MemberVisibleClusterNode[] = [];
    for (const summary of summaries) {
      if (summary.parentMembershipId === root.id) continue;
      const parent = rowsById.get(summary.parentMembershipId);
      if (!parent || parent.localTier >= MEMBER_MAX_VISIBLE_TIER) continue;
      const localTier = (parent.localTier + 1) as 2 | 3;
      const parentRef = refsById.get(parent.id);
      if (!parentRef) continue;
      const loaded = rowsByParent.get(parent.id) ?? [];
      const remaining = Math.max(0, safeCount(summary.directCount) - loaded.length);
      if (remaining === 0) continue;
      const last = loaded.at(-1);
      const clusterRef = parseOpaqueMemberNodeRef(
        createHierarchyReferenceToken("cluster", {
          actor,
          parentRef,
          snapshotAt,
          subject: encodeMemberKeyset(
            last
              ? { joinedAt: last.joinedAt.toISOString(), id: last.id }
              : undefined,
          ),
        }),
      );
      clusters.push({
        kind: "cluster",
        clusterRef,
        parentRef,
        localTier,
        label: localTier === 2 ? "Tier 2 members" : "Tier 3 members",
        representedNodes: remaining,
        canExpand: true,
      });
    }
    return clusters;
  }

  private readMemberLevel(
    tx: TransactionClient,
    tenantId: string,
    root: MemberRootRecord,
    parentIds: string[],
    localTier: 1 | 2 | 3,
    snapshotAt: string,
    remaining: number,
  ): Promise<MemberVisibleRecord[]> {
    const parents = Prisma.join(
      parentIds.map((parentId) => Prisma.sql`(${parentId}::uuid)`),
    );
    const perParentLimit = Math.min(ADMIN_HIERARCHY_PAGE_SIZE, remaining);
    const structuralColumns =
      localTier === 1
        ? Prisma.sql`,
             (SELECT count(*)::bigint FROM memberships direct_child
                WHERE direct_child.tenant_id = ${tenantId}::uuid
                  AND direct_child.sponsor_membership_id = m.id
                  AND direct_child.path::ltree <@ ${root.path}::ltree
                  AND direct_child.depth = ${root.depth + 2}
                  AND direct_child.joined_at <= ${new Date(snapshotAt)}) AS "visibleDirectCount",
             (SELECT count(*)::bigint FROM memberships visible_descendant
                WHERE visible_descendant.tenant_id = ${tenantId}::uuid
                  AND visible_descendant.path::ltree <@ m.path::ltree
                  AND visible_descendant.depth > m.depth
                  AND visible_descendant.depth <= ${root.depth + MEMBER_MAX_VISIBLE_TIER}
                  AND visible_descendant.joined_at <= ${new Date(snapshotAt)}) AS "visibleBranchCount"`
        : localTier === 2
          ? Prisma.sql`,
             (SELECT count(*)::bigint FROM memberships visible_child
                WHERE visible_child.tenant_id = ${tenantId}::uuid
                  AND visible_child.sponsor_membership_id = m.id
                  AND visible_child.path::ltree <@ ${root.path}::ltree
                  AND visible_child.depth = ${root.depth + MEMBER_MAX_VISIBLE_TIER}
                  AND visible_child.joined_at <= ${new Date(snapshotAt)}) AS "visibleChildCount"`
          : Prisma.empty;

    return tx.$queryRaw<MemberVisibleRecord[]>(Prisma.sql`
      /* network-hierarchy:member-context-level */
      WITH parents(parent_id) AS (VALUES ${parents})
      SELECT m.id::text AS "id",
             m.sponsor_membership_id::text AS "sponsorMembershipId",
             m.referral_code AS "referralCode", m.path, m.depth, m.status,
             m.joined_at AS "joinedAt", u.full_name AS "fullName",
             ${localTier} AS "localTier"
             ${structuralColumns}
      FROM parents parent
      CROSS JOIN LATERAL (
        SELECT child.*
        FROM memberships child
        WHERE child.tenant_id = ${tenantId}::uuid
          AND child.sponsor_membership_id = parent.parent_id
          AND child.path::ltree <@ ${root.path}::ltree
          AND child.depth = ${root.depth + localTier}
          AND child.joined_at <= ${new Date(snapshotAt)}
        ORDER BY child.joined_at ASC, child.id ASC
        LIMIT ${perParentLimit}
      ) m
      JOIN users u ON u.id = m.user_id
      ORDER BY m.joined_at ASC, m.id ASC
      LIMIT ${remaining}`);
  }

  private readMemberChildren(
    tx: TransactionClient,
    tenantId: string,
    root: MemberRootRecord,
    parent: MemberParentRecord,
    localTier: 1 | 2 | 3,
    after: Keyset | undefined,
    snapshotAt: string,
  ): Promise<MemberVisibleRecord[]> {
    const keyset = after
      ? Prisma.sql`AND (m.joined_at, m.id) > (${new Date(after.joinedAt)}, ${after.id}::uuid)`
      : Prisma.empty;
    const structuralColumns =
      localTier === 1
        ? Prisma.sql`,
             (SELECT count(*)::bigint FROM memberships direct_child
                WHERE direct_child.tenant_id = ${tenantId}::uuid
                  AND direct_child.sponsor_membership_id = m.id
                  AND direct_child.path::ltree <@ ${root.path}::ltree
                  AND direct_child.depth = ${root.depth + 2}
                  AND direct_child.joined_at <= ${new Date(snapshotAt)}) AS "visibleDirectCount",
             (SELECT count(*)::bigint FROM memberships visible_descendant
                WHERE visible_descendant.tenant_id = ${tenantId}::uuid
                  AND visible_descendant.path::ltree <@ m.path::ltree
                  AND visible_descendant.depth > m.depth
                  AND visible_descendant.depth <= ${root.depth + MEMBER_MAX_VISIBLE_TIER}
                  AND visible_descendant.joined_at <= ${new Date(snapshotAt)}) AS "visibleBranchCount"`
        : localTier === 2
          ? Prisma.sql`,
             (SELECT count(*)::bigint FROM memberships visible_child
                WHERE visible_child.tenant_id = ${tenantId}::uuid
                  AND visible_child.sponsor_membership_id = m.id
                  AND visible_child.path::ltree <@ ${root.path}::ltree
                  AND visible_child.depth = ${root.depth + MEMBER_MAX_VISIBLE_TIER}
                  AND visible_child.joined_at <= ${new Date(snapshotAt)}) AS "visibleChildCount"`
          : Prisma.empty;

    return tx.$queryRaw<MemberVisibleRecord[]>(Prisma.sql`
      /* network-hierarchy:member-children */
      SELECT m.id::text AS "id",
             m.sponsor_membership_id::text AS "sponsorMembershipId",
             m.referral_code AS "referralCode", m.path, m.depth, m.status,
             m.joined_at AS "joinedAt", u.full_name AS "fullName",
             ${localTier} AS "localTier",
             count(*) OVER ()::bigint AS "branchCount"
             ${structuralColumns}
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId}::uuid
        AND m.sponsor_membership_id = ${parent.id}::uuid
        AND m.path::ltree <@ ${root.path}::ltree
        AND m.depth = ${root.depth + localTier}
        AND m.joined_at <= ${new Date(snapshotAt)}
        ${keyset}
      ORDER BY m.joined_at ASC, m.id ASC
      LIMIT ${ADMIN_HIERARCHY_PAGE_SIZE + 1}`);
  }

  private readMemberDirectSearch(
    tx: TransactionClient,
    tenantId: string,
    root: MemberRootRecord,
    query: string,
    after: Keyset | undefined,
    snapshotAt: string,
  ): Promise<MemberVisibleRecord[]> {
    const keyset = after
      ? Prisma.sql`AND (m.joined_at, m.id) > (${new Date(after.joinedAt)}, ${after.id}::uuid)`
      : Prisma.empty;
    const like = `%${query}%`;
    return tx.$queryRaw<MemberVisibleRecord[]>(Prisma.sql`
      /* network-hierarchy:member-direct-search */
      SELECT m.id::text AS "id",
             m.sponsor_membership_id::text AS "sponsorMembershipId",
             m.referral_code AS "referralCode", m.path, m.depth, m.status,
             m.joined_at AS "joinedAt", u.full_name AS "fullName",
             1 AS "localTier",
             count(*) OVER ()::bigint AS "branchCount",
             (SELECT count(*)::bigint FROM memberships direct_child
                WHERE direct_child.tenant_id = ${tenantId}::uuid
                  AND direct_child.sponsor_membership_id = m.id
                  AND direct_child.path::ltree <@ ${root.path}::ltree
                  AND direct_child.depth = ${root.depth + 2}
                  AND direct_child.joined_at <= ${new Date(snapshotAt)}) AS "visibleDirectCount",
             (SELECT count(*)::bigint FROM memberships visible_descendant
                WHERE visible_descendant.tenant_id = ${tenantId}::uuid
                  AND visible_descendant.path::ltree <@ m.path::ltree
                  AND visible_descendant.depth > m.depth
                  AND visible_descendant.depth <= ${root.depth + MEMBER_MAX_VISIBLE_TIER}
                  AND visible_descendant.joined_at <= ${new Date(snapshotAt)}) AS "visibleBranchCount"
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId}::uuid
        AND m.sponsor_membership_id = ${root.id}::uuid
        AND m.path::ltree <@ ${root.path}::ltree
        AND m.depth = ${root.depth + 1}
        AND m.joined_at <= ${new Date(snapshotAt)}
        AND (u.full_name ILIKE ${like} OR m.referral_code ILIKE ${like})
        ${keyset}
      ORDER BY m.joined_at ASC, m.id ASC
      LIMIT ${ADMIN_HIERARCHY_PAGE_SIZE + 1}`);
  }

  private async readMemberPerformance(
    tx: TransactionClient,
    tenantId: string,
    root: MemberRootRecord,
    members: Array<{ id: string; path: string }>,
    timezone: string,
    snapshotAt: string,
  ): Promise<Map<string, MemberPerformanceRecord>> {
    if (members.length === 0) return new Map();
    const roots = Prisma.join(
      members.map(
        (member) =>
          Prisma.sql`(${member.id}::uuid, ${member.path}::ltree)`,
      ),
    );
    const period = monthKey(new Date(snapshotAt), timezone);
    const rows = await tx.$queryRaw<MemberPerformanceRecord[]>(Prisma.sql`
      /* network-hierarchy:member-performance */
      WITH roots(membership_id, path) AS (VALUES ${roots})
      SELECT roots.membership_id::text AS "membershipId",
             count(DISTINCT visible_member.id)::bigint AS "cohortCount",
             count(s.id)::bigint AS "approvedSales",
             coalesce(sum(s.amount_cents), 0)::bigint AS "teamVolumeCents"
      FROM roots
      JOIN memberships visible_member
        ON visible_member.tenant_id = ${tenantId}::uuid
       AND visible_member.path::ltree <@ roots.path
       AND visible_member.depth >= ${root.depth}
       AND visible_member.depth <= ${root.depth + MEMBER_MAX_VISIBLE_TIER}
       AND visible_member.joined_at <= ${new Date(snapshotAt)}
      LEFT JOIN sales s
        ON s.tenant_id = ${tenantId}::uuid
       AND s.seller_membership_id = visible_member.id
       AND s.status = 'approved'
       AND s.summary_month = ${period}
       AND coalesce(s.approved_at, s.sale_date) <= ${new Date(snapshotAt)}
      GROUP BY roots.membership_id`);
    return new Map(rows.map((row) => [row.membershipId, row] as const));
  }

  private toMemberVisibleNode(
    row: MemberVisibleRecord,
    nodeRef: OpaqueMemberNodeRef,
    parentRef: "self" | OpaqueMemberNodeRef,
    performance: MemberPerformanceRecord | undefined,
    currency: string,
    period: string,
  ): MemberVisibleNode {
    if (row.localTier === 1) {
      const direct: MemberDirectNode = {
        kind: "direct",
        nodeRef,
        parentRef: "self",
        localTier: 1,
        displayName: row.fullName,
        initials: initials(row.fullName),
        referralCode: row.referralCode,
        status: row.status,
        visibleDirectCount: safeCount(row.visibleDirectCount ?? 0n),
        visibleBranchCount: safeCount(row.visibleBranchCount ?? 0n),
        canExpand: safeCount(row.visibleDirectCount ?? 0n) > 0,
        performance: {
          currency,
          period,
          approvedSales: safeCount(performance?.approvedSales ?? 0n),
          visibleBranchVolumeCents: (
            performance?.teamVolumeCents ?? 0n
          ).toString(),
        },
      };
      return direct;
    }

    if (parentRef === "self") {
      throw new Error("anonymous member parent reference missing");
    }
    const anonymousBase = {
      kind: "anonymous" as const,
      nodeRef,
      parentRef,
      initials: anonymousInitials(row.fullName),
      status: row.status,
      performanceBand: this.memberPerformanceBand(performance),
    };
    if (row.localTier === 2) {
      const tierTwo: MemberAnonymousNode = {
        ...anonymousBase,
        localTier: 2,
        label: "Tier 2 member",
        visibleChildCount: safeCount(row.visibleChildCount ?? 0n),
        canExpand: safeCount(row.visibleChildCount ?? 0n) > 0,
      };
      return tierTwo;
    }
    const tierThree: MemberAnonymousNode = {
      ...anonymousBase,
      localTier: 3,
      label: "Tier 3 member",
      canExpand: false,
    };
    return tierThree;
  }

  private memberPerformanceBand(
    performance: MemberPerformanceRecord | undefined,
  ): MemberPerformanceBand {
    if (!performance) return { suppressed: true, reason: "noData" };
    if (safeCount(performance.cohortCount) < 3) {
      return { suppressed: true, reason: "smallCohort" };
    }
    const approvedSales = safeCount(performance.approvedSales);
    const approvedSalesBand =
      approvedSales === 0
        ? "0"
        : approvedSales < 5
          ? "1-4"
          : approvedSales < 10
            ? "5-9"
            : "10+";
    const volumeBand =
      performance.teamVolumeCents === 0n
        ? "none"
        : performance.teamVolumeCents < 100_000n
          ? "under1k"
          : performance.teamVolumeCents < 500_000n
            ? "1k-5k"
            : performance.teamVolumeCents < 1_000_000n
              ? "5k-10k"
              : "10k+";
    return { suppressed: false, approvedSalesBand, volumeBand };
  }

  private assertScope(scope: AdminScope, focusId?: string): void {
    if (scope !== "full" && scope !== "focused") badRequest();
    if (scope === "focused" && (!focusId || !UUID.test(focusId))) badRequest();
    if (scope === "full" && focusId !== undefined) badRequest();
  }

  private assertActiveSnapshot(snapshotAt: string): void {
    if (!canonicalDate(snapshotAt)) badRequest();
    const snapshotMs = Date.parse(snapshotAt);
    const now = Date.now();
    if (snapshotMs > now) badRequest();
    if (now >= snapshotMs + HIERARCHY_REFERENCE_TTL_MS) {
      badRequest();
    }
  }

  private async tenant(tx: TransactionClient, tenantId: string) {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, currency: true, timezone: true },
    });
    if (!tenant) throw new NotFoundException("tenant not found");
    return tenant;
  }

  private async resolveScope(
    tx: TransactionClient,
    tenantId: string,
    scope: AdminScope,
    focusId: string | undefined,
    snapshotAt: string,
  ): Promise<ScopeAnchor> {
    if (scope === "full") return { scope, focus: null };
    const focus = await this.lookupMembership(
      tx,
      tenantId,
      focusId!,
      snapshotAt,
    );
    if (!focus) throw new NotFoundException("network focus not found");
    return { scope, focus };
  }

  private lookupMembership(
    tx: TransactionClient,
    tenantId: string,
    membershipId: string,
    snapshotAt: string,
  ): Promise<MembershipLookup | null> {
    return tx.membership.findFirst({
      where: {
        id: membershipId,
        tenantId,
        joinedAt: { lte: new Date(snapshotAt) },
      },
      select: {
        id: true,
        sponsorMembershipId: true,
        referralCode: true,
        path: true,
        depth: true,
        status: true,
        joinedAt: true,
        user: { select: { fullName: true } },
      },
    });
  }

  private async resolveParent(
    tx: TransactionClient,
    tenantId: string,
    parentRef: string,
    focusId: string | undefined,
    snapshotAt: string,
  ): Promise<MembershipLookup | null> {
    if (parentRef === TENANT_ROOT_REF) {
      if (focusId !== undefined) badRequest();
      return null;
    }
    if (!UUID.test(parentRef)) badRequest();
    const parent = await this.lookupMembership(
      tx,
      tenantId,
      parentRef,
      snapshotAt,
    );
    if (!parent) throw new NotFoundException("network parent not found");
    if (focusId) {
      if (!UUID.test(focusId)) badRequest();
      const focus = await this.lookupMembership(
        tx,
        tenantId,
        focusId,
        snapshotAt,
      );
      if (!focus) throw new NotFoundException("network focus not found");
      if (
        parent.path !== focus.path &&
        !parent.path.startsWith(`${focus.path}.`)
      ) {
        throw new NotFoundException("network parent not found");
      }
    }
    return parent;
  }

  private branchBinding(parentRef: string, focusId?: string): string {
    if (parentRef !== TENANT_ROOT_REF && !UUID.test(parentRef)) badRequest();
    if (focusId !== undefined && !UUID.test(focusId)) badRequest();
    if (focusId && parentRef === TENANT_ROOT_REF) badRequest();
    return `admin-children:${focusId ? `focused:${focusId}` : "full"}:${parentRef}`;
  }

  private listBinding(scope: AdminScope, focusId?: string): string {
    return `admin-list:${scope}:${focusId ?? TENANT_ROOT_REF}`;
  }

  private cursorToken(
    actor: ActorContext,
    binding: string,
    snapshotAt: string,
    row: Pick<MembershipRecord, "joinedAt" | "id">,
  ): string {
    return createHierarchyReferenceToken("cursor", {
      actor,
      parentRef: binding,
      snapshotAt,
      subject: encodeKeyset({
        joinedAt: row.joinedAt.toISOString(),
        id: row.id,
      }),
    });
  }

  private clusterToken(
    actor: ActorContext,
    binding: string,
    snapshotAt: string,
    row?: Pick<MembershipRecord, "joinedAt" | "id">,
  ): string {
    return createHierarchyReferenceToken("cluster", {
      actor,
      parentRef: binding,
      snapshotAt,
      subject: encodeKeyset(
        row ? { joinedAt: row.joinedAt.toISOString(), id: row.id } : undefined,
      ),
    });
  }

  private async readBranchPage(
    tx: TransactionClient,
    actor: ActorContext,
    parent: MembershipLookup | null,
    focusId: string | undefined,
    after: Keyset | undefined,
    snapshotAt: string,
    viewFinancials: boolean,
  ): Promise<BranchPage<AdminNetworkNode>> {
    const parentRef = parent?.id ?? TENANT_ROOT_REF;
    const parentPredicate = parent
      ? Prisma.sql`m.sponsor_membership_id = ${parent.id}::uuid`
      : Prisma.sql`m.sponsor_membership_id IS NULL`;
    const keyset = after
      ? Prisma.sql`AND (m.joined_at, m.id) > (${new Date(after.joinedAt)}, ${after.id}::uuid)`
      : Prisma.empty;
    const rows = await tx.$queryRaw<MembershipRecord[]>(Prisma.sql`
      /* network-hierarchy:branch */
      WITH branch_members AS (
        SELECT m.id, m.sponsor_membership_id, m.referral_code, m.path, m.depth,
               m.status, m.joined_at, u.full_name,
               (SELECT count(*)::bigint FROM memberships c
                 WHERE c.tenant_id = ${actor.tenantId}::uuid
                   AND c.sponsor_membership_id = m.id
                   AND c.joined_at <= ${new Date(snapshotAt)}) AS direct_count,
               (SELECT (count(*) - 1)::bigint FROM memberships d
                 WHERE d.tenant_id = ${actor.tenantId}::uuid
                   AND d.path::ltree <@ m.path::ltree
                   AND d.joined_at <= ${new Date(snapshotAt)}) AS subtree_count
        FROM memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = ${actor.tenantId}::uuid
          AND m.joined_at <= ${new Date(snapshotAt)}
          AND ${parentPredicate}
          ${keyset}
      )
      SELECT id::text AS "id",
             sponsor_membership_id::text AS "sponsorMembershipId",
             referral_code AS "referralCode", path, depth, status,
             joined_at AS "joinedAt", full_name AS "fullName",
             direct_count AS "directCount", subtree_count AS "subtreeCount",
             count(*) OVER ()::bigint AS "branchCount",
             sum(1 + subtree_count) OVER ()::bigint
               AS "branchRepresentedNodes"
      FROM branch_members
      ORDER BY joined_at ASC, id ASC
      LIMIT ${ADMIN_HIERARCHY_PAGE_SIZE + 1}`);
    const visible = rows.slice(0, ADMIN_HIERARCHY_PAGE_SIZE);
    const tenant = viewFinancials
      ? await this.tenant(tx, actor.tenantId)
      : null;
    const performance = tenant
      ? await this.readFinancials(
          tx,
          actor.tenantId,
          tenant.currency,
          tenant.timezone,
          visible,
          snapshotAt,
        )
      : new Map<string, AdminMemberNode["performance"]>();
    let focusDepth: number | null = null;
    if (focusId) {
      const focus = await this.lookupMembership(
        tx,
        actor.tenantId,
        focusId,
        snapshotAt,
      );
      if (!focus) throw new NotFoundException("network focus not found");
      focusDepth = focus.depth;
    }
    const items: AdminNetworkNode[] = visible.map((row) =>
      this.toAdminNode(
        row,
        focusDepth === null ? row.depth + 1 : row.depth - focusDepth + 1,
        performance.get(row.id),
      ),
    );
    const branchCount = rows[0]?.branchCount
      ? safeCount(rows[0].branchCount)
      : rows.length;
    const branchRepresentedNodes = rows[0]?.branchRepresentedNodes
      ? safeCount(rows[0].branchRepresentedNodes)
      : rows.reduce((sum, row) => sum + safeCount(row.subtreeCount) + 1, 0);
    const visibleRepresented = visible.reduce(
      (sum, row) => sum + safeCount(row.subtreeCount) + 1,
      0,
    );
    const remainingRepresented = Math.max(
      0,
      branchRepresentedNodes - visibleRepresented,
    );
    const hasMore = branchCount > visible.length;
    if (hasMore) {
      const last = visible.at(-1)!;
      items.push({
        kind: "cluster",
        clusterRef: this.clusterToken(
          actor,
          this.branchBinding(parentRef, focusId),
          snapshotAt,
          last,
        ),
        parentMembershipId: parent?.id ?? null,
        label: `${remainingRepresented} more members`,
        localTier:
          focusDepth === null
            ? (parent?.depth ?? -1) + 2
            : (parent?.depth ?? focusDepth) - focusDepth + 2,
        representedNodes: remainingRepresented,
        canExpand: true,
      });
    }
    const nextCursor =
      hasMore && visible.length
        ? this.cursorToken(
            actor,
            this.branchBinding(parentRef, focusId),
            snapshotAt,
            visible.at(-1)!,
          )
        : null;
    return {
      parentRef,
      items,
      representedNodes: visibleRepresented + remainingRepresented,
      nextCursor,
      snapshotAt,
    };
  }

  private async withAuthoritativeCounts(
    tx: TransactionClient,
    tenantId: string,
    member: MembershipLookup,
    snapshotAt: string,
  ): Promise<MembershipRecord> {
    const rows = await tx.$queryRaw<
      Array<{ directCount: bigint; subtreeCount: bigint }>
    >(
      Prisma.sql`
        /* network-hierarchy:member-counts */
        SELECT (SELECT count(*)::bigint FROM memberships c
                  WHERE c.tenant_id = ${tenantId}::uuid
                    AND c.sponsor_membership_id = ${member.id}::uuid
                    AND c.joined_at <= ${new Date(snapshotAt)}) AS "directCount",
               (SELECT (count(*) - 1)::bigint FROM memberships d
                  WHERE d.tenant_id = ${tenantId}::uuid
                    AND d.path::ltree <@ ${member.path}::ltree
                    AND d.joined_at <= ${new Date(snapshotAt)}) AS "subtreeCount"`,
    );
    return {
      ...member,
      fullName: member.user.fullName,
      directCount: rows[0]?.directCount ?? 0n,
      subtreeCount: rows[0]?.subtreeCount ?? 0n,
    };
  }

  private readAncestors(
    tx: TransactionClient,
    tenantId: string,
    focus: MembershipLookup,
    snapshotAt: string,
  ): Promise<MembershipRecord[]> {
    return tx.$queryRaw<MembershipRecord[]>(Prisma.sql`
      /* network-hierarchy:ancestors */
      SELECT m.id::text AS "id",
             m.sponsor_membership_id::text AS "sponsorMembershipId",
             m.referral_code AS "referralCode", m.path, m.depth, m.status,
             m.joined_at AS "joinedAt", u.full_name AS "fullName",
             (SELECT count(*)::bigint FROM memberships c
               WHERE c.tenant_id = ${tenantId}::uuid
                 AND c.sponsor_membership_id = m.id
                 AND c.joined_at <= ${new Date(snapshotAt)}) AS "directCount",
             (SELECT (count(*) - 1)::bigint FROM memberships d
               WHERE d.tenant_id = ${tenantId}::uuid
                 AND d.path::ltree <@ m.path::ltree
                 AND d.joined_at <= ${new Date(snapshotAt)}) AS "subtreeCount"
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId}::uuid
        AND m.id <> ${focus.id}::uuid
        AND m.path::ltree @> ${focus.path}::ltree
        AND m.joined_at <= ${new Date(snapshotAt)}
      ORDER BY m.depth ASC, m.joined_at ASC, m.id ASC`);
  }

  private async readContextMembers(
    tx: TransactionClient,
    tenantId: string,
    anchor: ScopeAnchor,
    depth: number,
    snapshotAt: string,
    nodeBudget: number,
  ): Promise<MembershipRecord[]> {
    const rows: MembershipRecord[] = [];
    let localTier = anchor.focus ? 2 : 1;
    let rootRound = !anchor.focus;
    let frontier = anchor.focus ? [anchor.focus.id] : [];

    while (
      localTier <= depth &&
      rows.length < nodeBudget &&
      (rootRound || frontier.length > 0)
    ) {
      const remaining = nodeBudget - rows.length;
      const levelRows = rootRound
        ? await this.readContextRootLevel(tx, tenantId, snapshotAt, remaining)
        : await this.readContextChildrenLevel(
            tx,
            tenantId,
            frontier,
            snapshotAt,
            remaining,
          );
      const accepted = levelRows.slice(0, remaining);
      rows.push(...accepted);
      frontier = accepted.map((row) => row.id);
      rootRound = false;
      localTier += 1;
    }

    return rows;
  }

  private readContextRootLevel(
    tx: TransactionClient,
    tenantId: string,
    snapshotAt: string,
    remaining: number,
  ): Promise<MembershipRecord[]> {
    return tx.$queryRaw<MembershipRecord[]>(Prisma.sql`
      /* network-hierarchy:context-level */
      SELECT m.id::text AS "id",
             m.sponsor_membership_id::text AS "sponsorMembershipId",
             m.referral_code AS "referralCode", m.path, m.depth, m.status,
             m.joined_at AS "joinedAt", u.full_name AS "fullName",
             (SELECT count(*)::bigint FROM memberships c
               WHERE c.tenant_id = ${tenantId}::uuid
                 AND c.sponsor_membership_id = m.id
                 AND c.joined_at <= ${new Date(snapshotAt)}) AS "directCount",
             (SELECT (count(*) - 1)::bigint FROM memberships d
               WHERE d.tenant_id = ${tenantId}::uuid
                 AND d.path::ltree <@ m.path::ltree
                 AND d.joined_at <= ${new Date(snapshotAt)}) AS "subtreeCount"
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId}::uuid
        AND m.sponsor_membership_id IS NULL
        AND m.joined_at <= ${new Date(snapshotAt)}
      ORDER BY m.joined_at ASC, m.id ASC
      LIMIT ${Math.min(ADMIN_HIERARCHY_PAGE_SIZE, remaining)}`);
  }

  private readContextChildrenLevel(
    tx: TransactionClient,
    tenantId: string,
    parentIds: string[],
    snapshotAt: string,
    remaining: number,
  ): Promise<MembershipRecord[]> {
    const perParentLimit = Math.min(ADMIN_HIERARCHY_PAGE_SIZE, remaining);
    const parents = Prisma.join(
      parentIds.map((parentId) => Prisma.sql`(${parentId}::uuid)`),
    );
    return tx.$queryRaw<MembershipRecord[]>(Prisma.sql`
      /* network-hierarchy:context-level */
      WITH parents(parent_id) AS (VALUES ${parents})
      SELECT child.id::text AS "id",
             child.sponsor_membership_id::text AS "sponsorMembershipId",
             child.referral_code AS "referralCode", child.path, child.depth,
             child.status, child.joined_at AS "joinedAt",
             child_user.full_name AS "fullName",
             (SELECT count(*)::bigint FROM memberships direct_child
               WHERE direct_child.tenant_id = ${tenantId}::uuid
                 AND direct_child.sponsor_membership_id = child.id
                 AND direct_child.joined_at <= ${new Date(snapshotAt)}) AS "directCount",
             (SELECT (count(*) - 1)::bigint FROM memberships descendant
               WHERE descendant.tenant_id = ${tenantId}::uuid
                 AND descendant.path::ltree <@ child.path::ltree
                 AND descendant.joined_at <= ${new Date(snapshotAt)}) AS "subtreeCount"
      FROM parents parent
      CROSS JOIN LATERAL (
        SELECT m.*
        FROM memberships m
        WHERE m.tenant_id = ${tenantId}::uuid
          AND m.sponsor_membership_id = parent.parent_id
          AND m.joined_at <= ${new Date(snapshotAt)}
        ORDER BY m.joined_at ASC, m.id ASC
        LIMIT ${perParentLimit}
      ) child
      JOIN users child_user ON child_user.id = child.user_id
      ORDER BY child.joined_at ASC, child.id ASC
      LIMIT ${remaining}`);
  }

  private readContextBranchSummaries(
    tx: TransactionClient,
    tenantId: string,
    anchor: ScopeAnchor,
    rows: MembershipRecord[],
    depth: number,
    snapshotAt: string,
  ): Promise<BranchSummaryRecord[]> {
    const parents = [
      ...(anchor.focus ? [anchor.focus.id] : []),
      ...rows
        .filter((row) => {
          const tier = anchor.focus
            ? row.depth - anchor.focus.depth + 1
            : row.depth + 1;
          return tier <= depth;
        })
        .map((row) => row.id),
    ];
    const parentPredicates: Prisma.Sql[] = parents.map(
      (id) => Prisma.sql`m.sponsor_membership_id = ${id}::uuid`,
    );
    if (!anchor.focus)
      parentPredicates.unshift(Prisma.sql`m.sponsor_membership_id IS NULL`);
    const parentPredicate = Prisma.join(parentPredicates, " OR ");
    return tx.$queryRaw<BranchSummaryRecord[]>(Prisma.sql`
      /* network-hierarchy:context-branches */
      WITH branch_members AS (
        SELECT m.sponsor_membership_id,
               1 + (SELECT (count(*) - 1)::bigint FROM memberships d
                 WHERE d.tenant_id = ${tenantId}::uuid
                   AND d.path::ltree <@ m.path::ltree
                   AND d.joined_at <= ${new Date(snapshotAt)}) AS represented_nodes
        FROM memberships m
        WHERE m.tenant_id = ${tenantId}::uuid
          AND m.joined_at <= ${new Date(snapshotAt)}
          AND (${parentPredicate})
      )
      SELECT sponsor_membership_id::text AS "parentMembershipId",
             count(*)::bigint AS "directCount",
             sum(represented_nodes)::bigint AS "representedNodes"
      FROM branch_members
      GROUP BY sponsor_membership_id`);
  }

  private contextClusters(
    actor: ActorContext,
    anchor: ScopeAnchor,
    rows: MembershipRecord[],
    summaries: BranchSummaryRecord[],
    snapshotAt: string,
  ): AdminClusterNode[] {
    const loadedByParent = new Map<string, MembershipRecord[]>();
    for (const row of rows) {
      const key = row.sponsorMembershipId ?? TENANT_ROOT_REF;
      loadedByParent.set(key, [...(loadedByParent.get(key) ?? []), row]);
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    const clusters: AdminClusterNode[] = [];
    for (const summary of summaries) {
      const parentRef = summary.parentMembershipId ?? TENANT_ROOT_REF;
      const loaded = loadedByParent.get(parentRef) ?? [];
      const loadedRepresented = loaded.reduce(
        (sum, row) => sum + safeCount(row.subtreeCount) + 1,
        0,
      );
      const remaining = Math.max(
        0,
        safeCount(summary.representedNodes) - loadedRepresented,
      );
      if (remaining === 0) continue;
      const parent = summary.parentMembershipId
        ? (byId.get(summary.parentMembershipId) ??
          (anchor.focus?.id === summary.parentMembershipId
            ? anchor.focus
            : undefined))
        : undefined;
      const parentDepth = parent?.depth ?? -1;
      const focusDepth = anchor.focus?.depth;
      clusters.push({
        kind: "cluster",
        clusterRef: this.clusterToken(
          actor,
          this.branchBinding(parentRef, anchor.focus?.id),
          snapshotAt,
          loaded.at(-1),
        ),
        parentMembershipId: summary.parentMembershipId,
        label: `${remaining} more members`,
        localTier:
          focusDepth === undefined
            ? parentDepth + 2
            : parentDepth - focusDepth + 2,
        representedNodes: remaining,
        canExpand: true,
      });
    }
    return clusters;
  }

  private async totalTenantMembers(
    tx: TransactionClient,
    tenantId: string,
    snapshotAt: string,
  ): Promise<number> {
    return tx.membership.count({
      where: { tenantId, joinedAt: { lte: new Date(snapshotAt) } },
    });
  }

  private readListRows(
    tx: TransactionClient,
    tenantId: string,
    anchor: ScopeAnchor,
    after: Keyset | undefined,
    snapshotAt: string,
  ): Promise<MembershipRecord[]> {
    const scope = anchor.focus
      ? Prisma.sql`AND m.path::ltree <@ ${anchor.focus.path}::ltree`
      : Prisma.empty;
    const keyset = after
      ? Prisma.sql`AND (m.joined_at, m.id) > (${new Date(after.joinedAt)}, ${after.id}::uuid)`
      : Prisma.empty;
    return tx.$queryRaw<MembershipRecord[]>(Prisma.sql`
      /* network-hierarchy:list */
      SELECT m.id::text AS "id", m.sponsor_membership_id::text AS "sponsorMembershipId",
             m.referral_code AS "referralCode", m.path, m.depth, m.status,
             m.joined_at AS "joinedAt", u.full_name AS "fullName",
             (SELECT count(*)::bigint FROM memberships c
               WHERE c.tenant_id = ${tenantId}::uuid AND c.sponsor_membership_id = m.id
                 AND c.joined_at <= ${new Date(snapshotAt)}) AS "directCount",
             (SELECT (count(*) - 1)::bigint FROM memberships d
               WHERE d.tenant_id = ${tenantId}::uuid AND d.path::ltree <@ m.path::ltree
                 AND d.joined_at <= ${new Date(snapshotAt)}) AS "subtreeCount"
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId}::uuid
        AND m.joined_at <= ${new Date(snapshotAt)} ${scope} ${keyset}
      ORDER BY m.joined_at ASC, m.id ASC
      LIMIT ${ADMIN_HIERARCHY_PAGE_SIZE + 1}`);
  }

  private readSearchRows(
    tx: TransactionClient,
    tenantId: string,
    query: string,
    after: Keyset | undefined,
    snapshotAt: string,
  ): Promise<MembershipRecord[]> {
    const keyset = after
      ? Prisma.sql`AND (m.joined_at, m.id) > (${new Date(after.joinedAt)}, ${after.id}::uuid)`
      : Prisma.empty;
    return tx.$queryRaw<MembershipRecord[]>(Prisma.sql`
      /* network-hierarchy:search */
      SELECT m.id::text AS "id", m.sponsor_membership_id::text AS "sponsorMembershipId",
             m.referral_code AS "referralCode", m.path, m.depth, m.status,
             m.joined_at AS "joinedAt", u.full_name AS "fullName",
             (SELECT count(*)::bigint FROM memberships c
               WHERE c.tenant_id = ${tenantId}::uuid AND c.sponsor_membership_id = m.id
                 AND c.joined_at <= ${new Date(snapshotAt)}) AS "directCount",
             (SELECT (count(*) - 1)::bigint FROM memberships d
               WHERE d.tenant_id = ${tenantId}::uuid AND d.path::ltree <@ m.path::ltree
                 AND d.joined_at <= ${new Date(snapshotAt)}) AS "subtreeCount"
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId}::uuid
        AND m.joined_at <= ${new Date(snapshotAt)}
        AND (u.full_name ILIKE ${`%${query}%`} OR m.referral_code ILIKE ${`%${query}%`})
        ${keyset}
      ORDER BY m.joined_at ASC, m.id ASC
      LIMIT ${ADMIN_HIERARCHY_PAGE_SIZE + 1}`);
  }

  private async readFinancials(
    tx: TransactionClient,
    tenantId: string,
    currency: string,
    timezone: string,
    rows: MembershipRecord[],
    snapshotAt: string,
  ): Promise<Map<string, AdminMemberNode["performance"]>> {
    if (rows.length === 0) return new Map();
    const ids = rows.map((row) => row.id);
    const period = monthKey(new Date(snapshotAt), timezone);
    const financialRows = await tx.$queryRaw<FinancialRecord[]>(Prisma.sql`
      /* network-hierarchy:financials */
      SELECT roots.id::text AS "membershipId",
             count(s.id)::bigint AS "approvedSales",
             coalesce(sum(s.amount_cents), 0)::bigint AS "teamVolumeCents"
      FROM memberships roots
      LEFT JOIN memberships d
        ON d.tenant_id = roots.tenant_id
       AND d.path::ltree <@ roots.path::ltree
       AND d.joined_at <= ${new Date(snapshotAt)}
      LEFT JOIN sales s
        ON s.tenant_id = roots.tenant_id
       AND s.seller_membership_id = d.id
       AND s.status = 'approved'
       AND s.summary_month = ${period}
       AND coalesce(s.approved_at, s.sale_date) <= ${new Date(snapshotAt)}
      WHERE roots.tenant_id = ${tenantId}::uuid
        AND roots.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY roots.id`);
    const values = new Map(
      financialRows.map((row) => [row.membershipId, row] as const),
    );
    return new Map(
      rows.map((row) => {
        const value = values.get(row.id);
        return [
          row.id,
          {
            currency,
            period,
            approvedSales: safeCount(value?.approvedSales ?? 0n),
            teamVolumeCents: (value?.teamVolumeCents ?? 0n).toString(),
          },
        ];
      }),
    );
  }

  private toAdminNode(
    row: MembershipRecord,
    localTier: number,
    performance?: AdminMemberNode["performance"],
  ): AdminMemberNode {
    return {
      kind: "member",
      membershipId: row.id,
      parentMembershipId: row.sponsorMembershipId,
      displayName: row.fullName,
      initials: initials(row.fullName),
      referralCode: row.referralCode,
      status: row.status,
      rank: null,
      globalTier: row.depth + 1,
      localTier,
      directCount: safeCount(row.directCount),
      subtreeCount: safeCount(row.subtreeCount),
      canExpand: safeCount(row.directCount) > 0,
      ...(performance ? { performance } : {}),
    };
  }
}
