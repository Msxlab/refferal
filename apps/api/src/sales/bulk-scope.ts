import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authConfig } from '../auth/auth.config';
import { ActorContext } from '../common/actor';
import { sha256 } from '../common/crypto';
import { BulkAction, BulkPreviewTotal, BulkScope } from './sales.types';

export const BULK_PREVIEW_DOMAIN = 'bulk-preview:v1' as const;
export const BULK_PREVIEW_TTL_MS = 5 * 60 * 1000;
const BULK_PREVIEW_TOKEN_MAX_LENGTH = 4096;
const BULK_PREVIEW_SIGNATURE_LENGTH = 43;
const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const CANONICAL_POSITIVE_INTEGER = /^[1-9]\d*$/;

export type NormalizedBulkFilters = {
  status?: 'draft' | 'approved' | 'void';
  summaryMonth?: string;
  q?: string;
  from?: string;
  to?: string;
  minCents?: number;
  maxCents?: number;
};

export type NormalizedBulkScope =
  | { mode: 'selected'; ids: string[] }
  | { mode: 'all-results'; filters: NormalizedBulkFilters };

export interface BulkPreviewTokenPayload {
  domain: typeof BULK_PREVIEW_DOMAIN;
  actorUserId: string;
  tenantId: string;
  action: BulkAction;
  scopeFingerprint: string;
  eligibleCount: number;
  excludedCount: number;
  totals: BulkPreviewTotal[];
  selectionFingerprint: string;
  expiresAt: string;
}

function canonicalDate(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new BadRequestException('invalid sales bulk scope');
  }
  return value.toISOString();
}

/** Canonical bulk scope. Page controls never narrow an all-results selection. */
export function normalizeBulkScope(scope: BulkScope): NormalizedBulkScope {
  if (scope.mode === 'selected') {
    return {
      mode: 'selected',
      ids: [...new Set(scope.ids.map((id) => id.toLowerCase()))].sort(),
    };
  }

  const filters: NormalizedBulkFilters = {};
  if (scope.filters.status !== undefined) filters.status = scope.filters.status;
  if (scope.filters.summaryMonth !== undefined) filters.summaryMonth = scope.filters.summaryMonth;
  const query = scope.filters.q?.trim().toLowerCase();
  if (query) filters.q = query;
  if (scope.filters.from !== undefined) filters.from = canonicalDate(scope.filters.from);
  if (scope.filters.to !== undefined) filters.to = canonicalDate(scope.filters.to);
  if (scope.filters.minCents !== undefined) filters.minCents = scope.filters.minCents;
  if (scope.filters.maxCents !== undefined) filters.maxCents = scope.filters.maxCents;
  return { mode: 'all-results', filters };
}

export function bulkScopeFingerprint(scope: NormalizedBulkScope): string {
  return sha256(JSON.stringify(scope));
}

export function bulkSelectionFingerprint(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function invalidToken(): never {
  throw new BadRequestException('invalid sales bulk preview token');
}

function previewSignature(encodedPayload: string): Buffer {
  const derivedKey = createHmac('sha256', authConfig.accessSecret()).update(BULK_PREVIEW_DOMAIN).digest();
  return createHmac('sha256', derivedKey).update(encodedPayload).digest();
}

export function signBulkPreviewToken(payload: BulkPreviewTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const token = `${encodedPayload}.${previewSignature(encodedPayload).toString('base64url')}`;
  if (token.length > BULK_PREVIEW_TOKEN_MAX_LENGTH) invalidToken();
  return token;
}

function hasExactPayloadKeys(value: Record<string, unknown>): boolean {
  const expected = [
    'action',
    'actorUserId',
    'domain',
    'eligibleCount',
    'excludedCount',
    'expiresAt',
    'scopeFingerprint',
    'selectionFingerprint',
    'tenantId',
    'totals',
  ];
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function hasCanonicalTotals(value: unknown): value is BulkPreviewTotal[] {
  if (!Array.isArray(value)) return false;
  let previousCurrency = '';
  for (const total of value) {
    if (
      !total ||
      typeof total !== 'object' ||
      Array.isArray(total) ||
      JSON.stringify(Object.keys(total).sort()) !== JSON.stringify(['amountCents', 'currency'])
    ) {
      return false;
    }
    const candidate = total as Record<string, unknown>;
    if (
      typeof candidate.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(candidate.currency) ||
      candidate.currency <= previousCurrency ||
      typeof candidate.amountCents !== 'string' ||
      !CANONICAL_POSITIVE_INTEGER.test(candidate.amountCents)
    ) {
      return false;
    }
    previousCurrency = candidate.currency;
  }
  return true;
}

/** Verifies signature, canonical payload, actor/tenant binding, and expiry with one generic failure. */
export function verifyBulkPreviewToken(
  token: string,
  actor: ActorContext,
  now: number = Date.now(),
): BulkPreviewTokenPayload {
  if (typeof token !== 'string' || token.length > BULK_PREVIEW_TOKEN_MAX_LENGTH) invalidToken();
  const parts = token.split('.');
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    !UNPADDED_BASE64URL.test(parts[0]) ||
    !UNPADDED_BASE64URL.test(parts[1]) ||
    parts[1].length !== BULK_PREVIEW_SIGNATURE_LENGTH
  ) {
    invalidToken();
  }

  let encodedPayload: Buffer;
  let actualSignature: Buffer;
  try {
    encodedPayload = Buffer.from(parts[0], 'base64url');
    actualSignature = Buffer.from(parts[1], 'base64url');
  } catch {
    invalidToken();
  }
  if (
    encodedPayload.toString('base64url') !== parts[0] ||
    actualSignature.toString('base64url') !== parts[1]
  ) {
    invalidToken();
  }
  const expectedSignature = previewSignature(parts[0]);
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
    invalidToken();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(encodedPayload.toString('utf8'));
  } catch {
    invalidToken();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalidToken();
  const payload = parsed as Record<string, unknown>;
  if (
    !hasExactPayloadKeys(payload) ||
    payload.domain !== BULK_PREVIEW_DOMAIN ||
    typeof payload.actorUserId !== 'string' ||
    !UUID.test(payload.actorUserId) ||
    typeof payload.tenantId !== 'string' ||
    !UUID.test(payload.tenantId) ||
    (payload.action !== 'approve' && payload.action !== 'void') ||
    typeof payload.scopeFingerprint !== 'string' ||
    !SHA256_HEX.test(payload.scopeFingerprint) ||
    !Number.isSafeInteger(payload.eligibleCount) ||
    (payload.eligibleCount as number) < 0 ||
    !Number.isSafeInteger(payload.excludedCount) ||
    (payload.excludedCount as number) < 0 ||
    !hasCanonicalTotals(payload.totals) ||
    typeof payload.selectionFingerprint !== 'string' ||
    !SHA256_HEX.test(payload.selectionFingerprint) ||
    typeof payload.expiresAt !== 'string' ||
    Number.isNaN(Date.parse(payload.expiresAt)) ||
    new Date(payload.expiresAt).toISOString() !== payload.expiresAt
  ) {
    invalidToken();
  }
  if (
    payload.actorUserId !== actor.userId ||
    payload.tenantId !== actor.tenantId ||
    now >= Date.parse(payload.expiresAt as string)
  ) {
    invalidToken();
  }
  return payload as unknown as BulkPreviewTokenPayload;
}
