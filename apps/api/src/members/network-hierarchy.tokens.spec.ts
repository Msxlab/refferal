import { BadRequestException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { authConfig } from "../auth/auth.config";
import { ActorContext } from "../common/actor";
import {
  createHierarchyMemberReferenceToken,
  createHierarchyReferenceToken,
  deriveHierarchyMemberReference,
  HIERARCHY_REFERENCE_TTL_MS,
  HIERARCHY_TOKEN_DOMAIN,
  HIERARCHY_TOKEN_MAX_LENGTH,
  hierarchyMemberReferenceMatches,
  NETWORK_SNAPSHOT_EXPIRED,
  NetworkSnapshotExpiredException,
  verifyHierarchyReferenceToken,
} from "./network-hierarchy.tokens";
import type { OpaqueMemberNodeRef } from "./network-hierarchy.types";

const ACTOR: ActorContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
};
const OTHER_VIEWER: ActorContext = {
  ...ACTOR,
  userId: "33333333-3333-4333-8333-333333333333",
};
const OTHER_TENANT: ActorContext = {
  ...ACTOR,
  tenantId: "44444444-4444-4444-8444-444444444444",
};
const MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";
const SNAPSHOT_AT = "2026-07-20T12:00:00.000Z";
const EXPIRES_AT = new Date(
  Date.parse(SNAPSHOT_AT) + HIERARCHY_REFERENCE_TTL_MS,
).toISOString();
const PARENT_REF = "self";

function tokenWithValidSignature(payloadJson: string): string {
  const encoded = Buffer.from(payloadJson, "utf8").toString("base64url");
  const key = createHmac("sha256", authConfig.accessSecret())
    .update(`${HIERARCHY_TOKEN_DOMAIN}:signature`)
    .digest();
  const signature = createHmac("sha256", key)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

describe("network hierarchy reference tokens", () => {
  it.each(["parent", "cursor", "cluster"] as const)(
    "round-trips a canonical %s token bound to viewer, tenant, parent, and snapshot",
    (kind) => {
      const token = createHierarchyReferenceToken(kind, {
        actor: ACTOR,
        parentRef: PARENT_REF,
        snapshotAt: SNAPSHOT_AT,
        subject: `${kind}_subject`,
      });

      const payload = verifyHierarchyReferenceToken(
        token,
        { kind, actor: ACTOR, parentRef: PARENT_REF, snapshotAt: SNAPSHOT_AT },
        Date.parse(SNAPSHOT_AT),
      );

      expect(payload).toMatchObject({
        domain: HIERARCHY_TOKEN_DOMAIN,
        kind,
        viewerUserId: ACTOR.userId,
        tenantId: ACTOR.tenantId,
        snapshotAt: SNAPSHOT_AT,
        subject: `${kind}_subject`,
        expiresAt: EXPIRES_AT,
      });
      expect(token.length).toBeLessThanOrEqual(HIERARCHY_TOKEN_MAX_LENGTH);
    },
  );

  it("never places a raw membership UUID or name in a decodable member token payload", () => {
    const token: OpaqueMemberNodeRef = createHierarchyMemberReferenceToken({
      actor: ACTOR,
      membershipId: MEMBERSHIP_ID,
      parentRef: PARENT_REF,
      snapshotAt: SNAPSHOT_AT,
    });
    const decodedJson = Buffer.from(token.split(".")[0], "base64url").toString(
      "utf8",
    );
    const payload = verifyHierarchyReferenceToken(
      token,
      {
        kind: "member",
        actor: ACTOR,
        parentRef: PARENT_REF,
        snapshotAt: SNAPSHOT_AT,
      },
      Date.parse(SNAPSHOT_AT),
    );

    expect(decodedJson).not.toContain(MEMBERSHIP_ID);
    expect(decodedJson).not.toContain("Sensitive Member Name");
    expect(payload.subject).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      hierarchyMemberReferenceMatches(payload.subject, {
        actor: ACTOR,
        membershipId: MEMBERSHIP_ID,
        parentRef: PARENT_REF,
        snapshotAt: SNAPSHOT_AT,
      }),
    ).toBe(true);
    expect(
      hierarchyMemberReferenceMatches(payload.subject, {
        actor: ACTOR,
        membershipId: "66666666-6666-4666-8666-666666666666",
        parentRef: PARENT_REF,
        snapshotAt: SNAPSHOT_AT,
      }),
    ).toBe(false);
  });

  it("derives member references from every security and snapshot binding", () => {
    const base = {
      actor: ACTOR,
      membershipId: MEMBERSHIP_ID,
      parentRef: PARENT_REF,
      snapshotAt: SNAPSHOT_AT,
    };
    const reference = deriveHierarchyMemberReference(base);

    expect(deriveHierarchyMemberReference(base)).toBe(reference);
    expect(
      deriveHierarchyMemberReference({ ...base, actor: OTHER_VIEWER }),
    ).not.toBe(reference);
    expect(
      deriveHierarchyMemberReference({ ...base, actor: OTHER_TENANT }),
    ).not.toBe(reference);
    expect(
      deriveHierarchyMemberReference({ ...base, parentRef: "other-parent" }),
    ).not.toBe(reference);
    expect(
      deriveHierarchyMemberReference({
        ...base,
        snapshotAt: "2026-07-20T12:00:01.000Z",
      }),
    ).not.toBe(reference);
  });

  it.each([
    ["viewer", { actor: OTHER_VIEWER }],
    ["tenant", { actor: OTHER_TENANT }],
    ["parent", { parentRef: "other-parent" }],
    ["snapshot", { snapshotAt: "2026-07-20T12:00:01.000Z" }],
    ["kind", { kind: "cluster" as const }],
  ])(
    "rejects a token replayed against another %s binding",
    (_label, override) => {
      const token = createHierarchyMemberReferenceToken({
        actor: ACTOR,
        membershipId: MEMBERSHIP_ID,
        parentRef: PARENT_REF,
        snapshotAt: SNAPSHOT_AT,
      });

      expect(() =>
        verifyHierarchyReferenceToken(
          token,
          {
            kind: "member",
            actor: ACTOR,
            parentRef: PARENT_REF,
            snapshotAt: SNAPSHOT_AT,
            ...override,
          },
          Date.parse(SNAPSHOT_AT),
        ),
      ).toThrow(BadRequestException);
    },
  );

  it("returns a dedicated conflict only for a valid, bound token with an expired snapshot", () => {
    const token = createHierarchyReferenceToken("cursor", {
      actor: ACTOR,
      parentRef: PARENT_REF,
      snapshotAt: SNAPSHOT_AT,
      subject: "cursor_subject",
    });
    const verify = (
      candidate: string,
      now: number,
      actor: ActorContext = ACTOR,
    ) =>
      verifyHierarchyReferenceToken(
        candidate,
        {
          kind: "cursor",
          actor,
          parentRef: PARENT_REF,
          snapshotAt: SNAPSHOT_AT,
        },
        now,
      );

    let error: unknown;
    try {
      verify(token, Date.parse(EXPIRES_AT));
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeInstanceOf(NetworkSnapshotExpiredException);
    expect((error as NetworkSnapshotExpiredException).getStatus()).toBe(409);
    expect(
      (error as NetworkSnapshotExpiredException).getResponse(),
    ).toMatchObject({
      statusCode: 409,
      code: NETWORK_SNAPSHOT_EXPIRED,
    });
  });

  it("keeps tampered and replayed expired tokens on the generic bad-request path", () => {
    const token = createHierarchyReferenceToken("cursor", {
      actor: ACTOR,
      parentRef: PARENT_REF,
      snapshotAt: SNAPSHOT_AT,
      subject: "cursor_subject",
    });
    const [encoded, signature] = token.split(".");
    const tampered = `${encoded.slice(0, -1)}${encoded.endsWith("A") ? "B" : "A"}.${signature}`;
    const verify = (candidate: string, actor: ActorContext) =>
      verifyHierarchyReferenceToken(
        candidate,
        {
          kind: "cursor",
          actor,
          parentRef: PARENT_REF,
          snapshotAt: SNAPSHOT_AT,
        },
        Date.parse(EXPIRES_AT),
      );

    expect(() => verify(tampered, ACTOR)).toThrow(BadRequestException);
    expect(() => verify(tampered, ACTOR)).not.toThrow(
      NetworkSnapshotExpiredException,
    );
    expect(() => verify(token, OTHER_VIEWER)).toThrow(BadRequestException);
    expect(() => verify(token, OTHER_VIEWER)).not.toThrow(
      NetworkSnapshotExpiredException,
    );
  });

  it("rejects validly signed but non-canonical or overlong payloads", () => {
    const token = createHierarchyReferenceToken("parent", {
      actor: ACTOR,
      parentRef: PARENT_REF,
      snapshotAt: SNAPSHOT_AT,
      subject: "parent_subject",
    });
    const payload = JSON.parse(
      Buffer.from(token.split(".")[0], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const reordered = JSON.stringify({
      ...payload,
      domain: undefined,
      extra: undefined,
    }).replace(/}$/, `,"domain":"${HIERARCHY_TOKEN_DOMAIN}"}`);
    const withExtraKey = JSON.stringify({ ...payload, unexpected: true });

    expect(() =>
      verifyHierarchyReferenceToken(
        tokenWithValidSignature(reordered),
        {
          kind: "parent",
          actor: ACTOR,
          parentRef: PARENT_REF,
          snapshotAt: SNAPSHOT_AT,
        },
        Date.parse(SNAPSHOT_AT),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      verifyHierarchyReferenceToken(
        tokenWithValidSignature(withExtraKey),
        {
          kind: "parent",
          actor: ACTOR,
          parentRef: PARENT_REF,
          snapshotAt: SNAPSHOT_AT,
        },
        Date.parse(SNAPSHOT_AT),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      verifyHierarchyReferenceToken(
        "A".repeat(HIERARCHY_TOKEN_MAX_LENGTH + 1),
        {
          kind: "parent",
          actor: ACTOR,
          parentRef: PARENT_REF,
          snapshotAt: SNAPSHOT_AT,
        },
        Date.parse(SNAPSHOT_AT),
      ),
    ).toThrow(BadRequestException);
  });

  it("rejects padded and otherwise non-canonical base64url sections", () => {
    const token = createHierarchyReferenceToken("cluster", {
      actor: ACTOR,
      parentRef: PARENT_REF,
      snapshotAt: SNAPSHOT_AT,
      subject: "cluster_subject",
    });
    const [encoded, signature] = token.split(".");

    expect(() =>
      verifyHierarchyReferenceToken(
        `${encoded}=.${signature}`,
        {
          kind: "cluster",
          actor: ACTOR,
          parentRef: PARENT_REF,
          snapshotAt: SNAPSHOT_AT,
        },
        Date.parse(SNAPSHOT_AT),
      ),
    ).toThrow(BadRequestException);
  });
});
