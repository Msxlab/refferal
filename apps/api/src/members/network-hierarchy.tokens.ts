import { BadRequestException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { authConfig } from "../auth/auth.config";
import { ActorContext } from "../common/actor";
import { sha256 } from "../common/crypto";

export const HIERARCHY_TOKEN_DOMAIN = "referral-network-hierarchy:v1" as const;
export const HIERARCHY_REFERENCE_TTL_MS = 15 * 60 * 1000;
export const HIERARCHY_TOKEN_MAX_LENGTH = 2048;

const HIERARCHY_SIGNATURE_LENGTH = 43;
const HIERARCHY_SUBJECT_MAX_LENGTH = 512;
const HIERARCHY_PARENT_REF_MAX_LENGTH = 2048;
const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const HIERARCHY_SUBJECT = /^[A-Za-z0-9_-]+$/;
const HIERARCHY_PARENT_REF = /^[\x21-\x7e]+$/;

export type HierarchyReferenceKind = "parent" | "cursor" | "cluster" | "member";
export type NonMemberHierarchyReferenceKind = Exclude<
  HierarchyReferenceKind,
  "member"
>;

export interface HierarchyReferenceTokenPayload {
  domain: typeof HIERARCHY_TOKEN_DOMAIN;
  kind: HierarchyReferenceKind;
  viewerUserId: string;
  tenantId: string;
  parentFingerprint: string;
  snapshotAt: string;
  subject: string;
  expiresAt: string;
}

interface HierarchyReferenceBinding {
  actor: ActorContext;
  parentRef: string;
  snapshotAt: string;
}

export interface CreateHierarchyReferenceInput extends HierarchyReferenceBinding {
  subject: string;
  expiresAt?: string;
}

export interface HierarchyMemberReferenceInput extends HierarchyReferenceBinding {
  membershipId: string;
}

export interface CreateHierarchyMemberReferenceInput extends HierarchyMemberReferenceInput {
  expiresAt?: string;
}

export interface VerifyHierarchyReferenceBinding extends HierarchyReferenceBinding {
  kind: HierarchyReferenceKind;
}

function invalidToken(): never {
  throw new BadRequestException("invalid hierarchy reference token");
}

function isCanonicalDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function validateActor(actor: ActorContext): void {
  if (!actor || !UUID.test(actor.userId) || !UUID.test(actor.tenantId))
    invalidToken();
}

function validateParentRef(parentRef: string): void {
  if (
    typeof parentRef !== "string" ||
    parentRef.length === 0 ||
    parentRef.length > HIERARCHY_PARENT_REF_MAX_LENGTH ||
    !HIERARCHY_PARENT_REF.test(parentRef)
  ) {
    invalidToken();
  }
}

function validateSnapshot(snapshotAt: string): void {
  if (!isCanonicalDate(snapshotAt)) invalidToken();
}

function parentFingerprint(parentRef: string): string {
  validateParentRef(parentRef);
  return sha256(parentRef);
}

function expiresAtFor(snapshotAt: string, expiresAt?: string): string {
  validateSnapshot(snapshotAt);
  const snapshotMs = Date.parse(snapshotAt);
  const canonicalExpiry =
    expiresAt ??
    new Date(snapshotMs + HIERARCHY_REFERENCE_TTL_MS).toISOString();
  if (
    !isCanonicalDate(canonicalExpiry) ||
    Date.parse(canonicalExpiry) <= snapshotMs ||
    Date.parse(canonicalExpiry) > snapshotMs + HIERARCHY_REFERENCE_TTL_MS
  ) {
    invalidToken();
  }
  return canonicalExpiry;
}

function hierarchySignature(encodedPayload: string): Buffer {
  const derivedKey = createHmac("sha256", authConfig.accessSecret())
    .update(`${HIERARCHY_TOKEN_DOMAIN}:signature`)
    .digest();
  return createHmac("sha256", derivedKey).update(encodedPayload).digest();
}

function canonicalPayload(
  payload: HierarchyReferenceTokenPayload,
): HierarchyReferenceTokenPayload {
  return {
    domain: payload.domain,
    kind: payload.kind,
    viewerUserId: payload.viewerUserId,
    tenantId: payload.tenantId,
    parentFingerprint: payload.parentFingerprint,
    snapshotAt: payload.snapshotAt,
    subject: payload.subject,
    expiresAt: payload.expiresAt,
  };
}

function signHierarchyReferenceToken(
  payload: HierarchyReferenceTokenPayload,
): string {
  const encodedPayload = Buffer.from(
    JSON.stringify(canonicalPayload(payload)),
    "utf8",
  ).toString("base64url");
  const token = `${encodedPayload}.${hierarchySignature(encodedPayload).toString("base64url")}`;
  if (token.length > HIERARCHY_TOKEN_MAX_LENGTH) invalidToken();
  return token;
}

function validateSubject(subject: string): void {
  if (
    typeof subject !== "string" ||
    subject.length === 0 ||
    subject.length > HIERARCHY_SUBJECT_MAX_LENGTH ||
    !HIERARCHY_SUBJECT.test(subject)
  ) {
    invalidToken();
  }
}

function buildPayload(
  kind: HierarchyReferenceKind,
  input: CreateHierarchyReferenceInput,
): HierarchyReferenceTokenPayload {
  validateActor(input.actor);
  validateSnapshot(input.snapshotAt);
  validateSubject(input.subject);
  return {
    domain: HIERARCHY_TOKEN_DOMAIN,
    kind,
    viewerUserId: input.actor.userId,
    tenantId: input.actor.tenantId,
    parentFingerprint: parentFingerprint(input.parentRef),
    snapshotAt: input.snapshotAt,
    subject: input.subject,
    expiresAt: expiresAtFor(input.snapshotAt, input.expiresAt),
  };
}

export function createHierarchyReferenceToken(
  kind: NonMemberHierarchyReferenceKind,
  input: CreateHierarchyReferenceInput,
): string {
  if (kind !== "parent" && kind !== "cursor" && kind !== "cluster")
    invalidToken();
  return signHierarchyReferenceToken(buildPayload(kind, input));
}

function memberReferenceKey(): Buffer {
  return createHmac("sha256", authConfig.accessSecret())
    .update(`${HIERARCHY_TOKEN_DOMAIN}:member-reference`)
    .digest();
}

/**
 * Produces a deterministic, viewer-scoped handle for one candidate membership.
 * The membership UUID is HMAC input only and is never placed in the reference payload.
 */
export function deriveHierarchyMemberReference(
  input: HierarchyMemberReferenceInput,
): string {
  validateActor(input.actor);
  validateSnapshot(input.snapshotAt);
  validateParentRef(input.parentRef);
  if (!UUID.test(input.membershipId)) invalidToken();
  const canonicalInput = JSON.stringify({
    domain: HIERARCHY_TOKEN_DOMAIN,
    viewerUserId: input.actor.userId,
    tenantId: input.actor.tenantId,
    parentFingerprint: parentFingerprint(input.parentRef),
    snapshotAt: input.snapshotAt,
    membershipId: input.membershipId,
  });
  return createHmac("sha256", memberReferenceKey())
    .update(canonicalInput)
    .digest("base64url");
}

/** Timing-safe candidate comparison for resolving a visible member server-side. */
export function hierarchyMemberReferenceMatches(
  reference: string,
  candidate: HierarchyMemberReferenceInput,
): boolean {
  if (
    typeof reference !== "string" ||
    reference.length !== HIERARCHY_SIGNATURE_LENGTH ||
    !UNPADDED_BASE64URL.test(reference)
  ) {
    return false;
  }
  const actual = Buffer.from(reference, "base64url");
  if (actual.toString("base64url") !== reference) return false;
  const expected = Buffer.from(
    deriveHierarchyMemberReference(candidate),
    "base64url",
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createHierarchyMemberReferenceToken(
  input: CreateHierarchyMemberReferenceInput,
): string {
  const subject = deriveHierarchyMemberReference(input);
  return signHierarchyReferenceToken(
    buildPayload("member", { ...input, subject }),
  );
}

function hasExactPayloadKeys(value: Record<string, unknown>): boolean {
  const expected = [
    "domain",
    "expiresAt",
    "kind",
    "parentFingerprint",
    "snapshotAt",
    "subject",
    "tenantId",
    "viewerUserId",
  ];
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function isReferenceKind(value: unknown): value is HierarchyReferenceKind {
  return (
    value === "parent" ||
    value === "cursor" ||
    value === "cluster" ||
    value === "member"
  );
}

/** Verifies canonical encoding, signature, viewer/tenant/parent/snapshot binding, and expiry. */
export function verifyHierarchyReferenceToken(
  token: string,
  binding: VerifyHierarchyReferenceBinding,
  now: number = Date.now(),
): HierarchyReferenceTokenPayload {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > HIERARCHY_TOKEN_MAX_LENGTH ||
    !Number.isFinite(now)
  ) {
    invalidToken();
  }
  validateActor(binding.actor);
  validateSnapshot(binding.snapshotAt);
  const expectedParentFingerprint = parentFingerprint(binding.parentRef);

  const parts = token.split(".");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    !UNPADDED_BASE64URL.test(parts[0]) ||
    !UNPADDED_BASE64URL.test(parts[1]) ||
    parts[1].length !== HIERARCHY_SIGNATURE_LENGTH
  ) {
    invalidToken();
  }

  let encodedPayload: Buffer;
  let actualSignature: Buffer;
  try {
    encodedPayload = Buffer.from(parts[0], "base64url");
    actualSignature = Buffer.from(parts[1], "base64url");
  } catch {
    invalidToken();
  }
  if (
    encodedPayload.toString("base64url") !== parts[0] ||
    actualSignature.toString("base64url") !== parts[1]
  ) {
    invalidToken();
  }
  const expectedSignature = hierarchySignature(parts[0]);
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    invalidToken();
  }

  const decodedPayload = encodedPayload.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodedPayload);
  } catch {
    invalidToken();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    invalidToken();
  const payload = parsed as Record<string, unknown>;
  if (
    !hasExactPayloadKeys(payload) ||
    payload.domain !== HIERARCHY_TOKEN_DOMAIN ||
    !isReferenceKind(payload.kind) ||
    typeof payload.viewerUserId !== "string" ||
    !UUID.test(payload.viewerUserId) ||
    typeof payload.tenantId !== "string" ||
    !UUID.test(payload.tenantId) ||
    typeof payload.parentFingerprint !== "string" ||
    !SHA256_HEX.test(payload.parentFingerprint) ||
    !isCanonicalDate(payload.snapshotAt) ||
    typeof payload.subject !== "string" ||
    payload.subject.length === 0 ||
    payload.subject.length > HIERARCHY_SUBJECT_MAX_LENGTH ||
    !HIERARCHY_SUBJECT.test(payload.subject) ||
    (payload.kind === "member" &&
      payload.subject.length !== HIERARCHY_SIGNATURE_LENGTH) ||
    !isCanonicalDate(payload.expiresAt) ||
    Date.parse(payload.expiresAt) <= Date.parse(payload.snapshotAt) ||
    Date.parse(payload.expiresAt) >
      Date.parse(payload.snapshotAt) + HIERARCHY_REFERENCE_TTL_MS
  ) {
    invalidToken();
  }

  const typedPayload = payload as unknown as HierarchyReferenceTokenPayload;
  if (JSON.stringify(canonicalPayload(typedPayload)) !== decodedPayload)
    invalidToken();
  if (
    typedPayload.kind !== binding.kind ||
    typedPayload.viewerUserId !== binding.actor.userId ||
    typedPayload.tenantId !== binding.actor.tenantId ||
    typedPayload.parentFingerprint !== expectedParentFingerprint ||
    typedPayload.snapshotAt !== binding.snapshotAt ||
    now >= Date.parse(typedPayload.expiresAt)
  ) {
    invalidToken();
  }
  return typedPayload;
}
