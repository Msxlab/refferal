import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerStatus, PayoutSettlementBatchStatus, PayoutMethod, PayoutStatus, Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authConfig } from '../auth/auth.config';
import { ActorContext } from '../common/actor';
import { sha256 } from '../common/crypto';
import {
  EngineService,
  PayoutBatchReview,
  PayoutBatchReviewDriftError,
  PayoutBatchSelectionScope,
  payoutActiveKey,
} from '../engine/engine.service';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { csvCell } from '../sales/csv';
import { evaluatePayoutReadiness } from './payout-readiness';
import { PayoutComplianceService } from './payout-compliance.service';
import { mapLegacyPayoutPresentation } from './payout-presentation';
import {
  PayoutBatchPreview,
  PayoutScope,
  PreviewPayoutBatchInput,
  StartPayoutBatchInput,
} from './payouts.types';

const PAYOUT_PREVIEW_DOMAIN = 'payout-batch-preview:v1';
const PAYOUT_PREVIEW_TTL_MS = 5 * 60 * 1000;
const PAYOUT_PREVIEW_TOKEN_MAX_LENGTH = 4096;
const PAYOUT_PREVIEW_SIGNATURE_LENGTH = 43;
const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;
type ReviewedPayoutMethod = typeof PayoutMethod.manual | typeof PayoutMethod.csv;

interface PayoutPreviewTokenPayload {
  domain: typeof PAYOUT_PREVIEW_DOMAIN;
  actorUserId: string;
  tenantId: string;
  scopeFingerprint: string;
  period: string;
  method: 'manual' | 'csv';
  eligibleCount: number;
  excludedCount: number;
  totals: Array<{ currency: string; amountCents: string }>;
  selectionFingerprint: string;
  expiresAt: string;
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly tenantContext: TenantContextService,
    private readonly compliance: PayoutComplianceService,
  ) {}

  private async currentPeriod(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return monthKey(new Date(), tenant.timezone);
  }

  private previewSignature(encodedPayload: string): Buffer {
    const derivedKey = createHmac('sha256', authConfig.accessSecret()).update(PAYOUT_PREVIEW_DOMAIN).digest();
    return createHmac('sha256', derivedKey).update(encodedPayload).digest();
  }

  private signPreviewPayload(payload: PayoutPreviewTokenPayload): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${encodedPayload}.${this.previewSignature(encodedPayload).toString('base64url')}`;
  }

  private verifyPreviewToken(token: string, actor: ActorContext): PayoutPreviewTokenPayload {
    if (token.length > PAYOUT_PREVIEW_TOKEN_MAX_LENGTH) {
      throw new BadRequestException('invalid payout batch preview token');
    }
    const parts = token.split('.');
    if (
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1] ||
      !UNPADDED_BASE64URL.test(parts[0]) ||
      !UNPADDED_BASE64URL.test(parts[1]) ||
      parts[1].length !== PAYOUT_PREVIEW_SIGNATURE_LENGTH
    ) {
      throw new BadRequestException('invalid payout batch preview token');
    }
    let encodedPayload: Buffer;
    let actualSignature: Buffer;
    try {
      encodedPayload = Buffer.from(parts[0], 'base64url');
      actualSignature = Buffer.from(parts[1], 'base64url');
    } catch {
      throw new BadRequestException('invalid payout batch preview token');
    }
    if (
      encodedPayload.toString('base64url') !== parts[0] ||
      actualSignature.toString('base64url') !== parts[1]
    ) {
      throw new BadRequestException('invalid payout batch preview token');
    }
    const expectedSignature = this.previewSignature(parts[0]);
    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
      throw new BadRequestException('invalid payout batch preview token');
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(encodedPayload.toString('utf8'));
    } catch {
      throw new BadRequestException('invalid payout batch preview token');
    }
    const payload = candidate as Partial<PayoutPreviewTokenPayload> | null;
    if (
      !payload ||
      payload.domain !== PAYOUT_PREVIEW_DOMAIN ||
      typeof payload.actorUserId !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.scopeFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(payload.scopeFingerprint) ||
      typeof payload.period !== 'string' ||
      !/^\d{4}-\d{2}$/.test(payload.period) ||
      (payload.method !== 'manual' && payload.method !== 'csv') ||
      !Number.isInteger(payload.eligibleCount) ||
      (payload.eligibleCount as number) < 0 ||
      !Number.isInteger(payload.excludedCount) ||
      (payload.excludedCount as number) < 0 ||
      !Array.isArray(payload.totals) ||
      payload.totals.some(
        (total) =>
          !total ||
          typeof total.currency !== 'string' ||
          !/^[A-Z]{3}$/.test(total.currency) ||
          typeof total.amountCents !== 'string' ||
          !/^\d+$/.test(total.amountCents),
      ) ||
      typeof payload.selectionFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(payload.selectionFingerprint) ||
      typeof payload.expiresAt !== 'string' ||
      Number.isNaN(Date.parse(payload.expiresAt))
    ) {
      throw new BadRequestException('invalid payout batch preview token');
    }
    if (
      payload.actorUserId !== actor.userId ||
      payload.tenantId !== actor.tenantId ||
      Date.now() >= Date.parse(payload.expiresAt)
    ) {
      throw new BadRequestException('invalid payout batch preview token');
    }
    return payload as PayoutPreviewTokenPayload;
  }

  private async normalizeScope(tenantId: string, scope: PayoutScope): Promise<PayoutScope> {
    if (scope.mode === 'selected') {
      const membershipIds = [...new Set(scope.membershipIds)].sort();
      const memberships = await this.prisma.membership.findMany({
        where: { id: { in: membershipIds }, tenantId },
        select: { id: true },
      });
      if (memberships.length !== membershipIds.length) throw new NotFoundException('membership not found');
      return { mode: 'selected', membershipIds };
    }
    return {
      mode: 'all_eligible',
      filters: {
        period: scope.filters.period ?? (await this.currentPeriod(tenantId)),
        method: scope.filters.method,
      },
    };
  }

  private executionForScope(scope: PayoutScope): {
    scope: PayoutBatchSelectionScope;
    period: string;
    method: ReviewedPayoutMethod;
  } {
    if (scope.mode === 'selected') {
      throw new Error('selected payout scope execution requires its preview-bound period');
    }
    return {
      scope: { mode: 'all_eligible' },
      period: scope.filters.period as string,
      method: scope.filters.method === 'csv' ? PayoutMethod.csv : PayoutMethod.manual,
    };
  }

  private previewFromReview(
    actor: ActorContext,
    normalizedScope: PayoutScope,
    period: string,
    method: ReviewedPayoutMethod,
    review: PayoutBatchReview,
  ): PayoutBatchPreview {
    const expiresAt = new Date(Date.now() + PAYOUT_PREVIEW_TTL_MS).toISOString();
    const totals = review.totals.map((total) => ({
      currency: total.currency,
      amountCents: total.amountCents.toString(),
    }));
    const payload: PayoutPreviewTokenPayload = {
      domain: PAYOUT_PREVIEW_DOMAIN,
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      scopeFingerprint: sha256(JSON.stringify(normalizedScope)),
      period,
      method,
      eligibleCount: review.eligibleCount,
      excludedCount: review.excludedCount,
      totals,
      selectionFingerprint: review.selectionFingerprint,
      expiresAt,
    };
    return {
      previewToken: this.signPreviewPayload(payload),
      expiresAt,
      eligibleCount: review.eligibleCount,
      excludedCount: review.excludedCount,
      totals,
      normalizedScope,
    };
  }

  private async calculatePreview(
    actor: ActorContext,
    normalizedScope: PayoutScope,
    expectedReview?: PayoutBatchReview,
  ): Promise<PayoutBatchPreview> {
    const execution =
      normalizedScope.mode === 'selected'
        ? {
            scope: { mode: 'selected' as const, membershipIds: normalizedScope.membershipIds },
            period: await this.currentPeriod(actor.tenantId),
            method: PayoutMethod.manual,
          }
        : this.executionForScope(normalizedScope);
    let review: PayoutBatchReview;
    try {
      review = await this.engine.previewPayoutBatch({ tenantId: actor.tenantId, ...execution, expectedReview });
    } catch (error) {
      if (!expectedReview || !(error instanceof PayoutBatchReviewDriftError)) throw error;
      review = error.review;
    }
    return this.previewFromReview(actor, normalizedScope, execution.period, execution.method, review);
  }

  async previewBatch(actor: ActorContext, input: PreviewPayoutBatchInput): Promise<PayoutBatchPreview> {
    this.tenantContext.assertActor(actor);
    const normalizedScope = await this.normalizeScope(actor.tenantId, input.scope);
    return this.calculatePreview(actor, normalizedScope);
  }

  /** Members above the threshold (net payable >= payout_min), for the admin payable list. */
  async payable(tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const rows = await this.prisma.$queryRaw<
      Array<{ membershipId: string; referralCode: string; fullName: string; netCents: bigint }>
    >`
      SELECT le.beneficiary_membership_id AS "membershipId",
             m.referral_code              AS "referralCode",
             u.full_name                  AS "fullName",
             SUM(le.amount_cents)::bigint AS "netCents"
      FROM ledger_entries le
      JOIN memberships m ON m.id = le.beneficiary_membership_id
      JOIN users u       ON u.id = m.user_id
      WHERE le.tenant_id = ${tenantId}::uuid
        AND le.status = 'payable'
      GROUP BY le.beneficiary_membership_id, m.referral_code, u.full_name
      HAVING SUM(le.amount_cents) >= ${tenant.payoutMinCents}
      ORDER BY SUM(le.amount_cents) DESC`;
    return {
      payoutMinCents: tenant.payoutMinCents.toString(),
      currency: tenant.currency,
      members: rows.map((row) => ({
        membershipId: row.membershipId,
        referralCode: row.referralCode,
        fullName: row.fullName,
        netCents: row.netCents.toString(),
      })),
    };
  }

  /** Starts a bounded processing batch. It never marks money paid. */
  async startBatch(actor: ActorContext, input: StartPayoutBatchInput) {
    this.tenantContext.assertActor(actor);
    const tokenPayload = this.verifyPreviewToken(input.previewToken, actor);
    const normalizedScope = await this.normalizeScope(actor.tenantId, input.scope);
    const expectedReview: PayoutBatchReview = {
      eligibleCount: tokenPayload.eligibleCount,
      excludedCount: tokenPayload.excludedCount,
      totals: tokenPayload.totals.map((total) => ({
        currency: total.currency,
        amountCents: BigInt(total.amountCents),
      })),
      selectionFingerprint: tokenPayload.selectionFingerprint,
    };
    if (tokenPayload.scopeFingerprint !== sha256(JSON.stringify(normalizedScope))) {
      const freshPreview = await this.calculatePreview(actor, normalizedScope, expectedReview);
      throw new ConflictException({ message: 'review_required', code: 'review_required', preview: freshPreview });
    }
    const method: ReviewedPayoutMethod =
      tokenPayload.method === 'csv' ? PayoutMethod.csv : PayoutMethod.manual;
    const selectionScope: PayoutBatchSelectionScope =
      normalizedScope.mode === 'selected'
        ? { mode: 'selected', membershipIds: normalizedScope.membershipIds }
        : { mode: 'all_eligible' };
    let result: Awaited<ReturnType<EngineService['reservePayoutBatch']>>;
    try {
      result = await this.engine.reservePayoutBatch({
        tenantId: actor.tenantId,
        scope: selectionScope,
        period: tokenPayload.period,
        method,
        actorUserId: actor.userId,
        expectedReview,
      });
    } catch (error) {
      if (!(error instanceof PayoutBatchReviewDriftError)) throw error;
      const freshPreview = this.previewFromReview(
        actor,
        normalizedScope,
        tokenPayload.period,
        method,
        error.review,
      );
      throw new ConflictException({ message: 'review_required', code: 'review_required', preview: freshPreview });
    }
    return {
      id: result.batchId,
      status: result.batchId ? PayoutSettlementBatchStatus.processing : null,
      period: result.period,
      method,
      processingCount: result.processing.length,
      skippedCount: result.skipped.length,
      processing: result.processing.map((payout) => ({
        membershipId: payout.membershipId,
        payoutId: payout.payoutId,
        totalCents: payout.totalCents.toString(),
        entryCount: payout.entryCount,
      })),
      skipped: result.skipped.map((item) => ({
        ...item,
        netCents: item.netCents.toString(),
      })),
    };
  }

  /** Legacy /run compatibility: reserve only; explicit settle is required to mark paid. */
  async run(actor: ActorContext, input: StartPayoutBatchInput) {
    return this.startBatch(actor, input);
  }

  /** Legacy approval compatibility: it starts processing for exactly one requested payout. */
  async approveRequest(actor: ActorContext, payoutId: string, methodInput: 'manual' | 'csv' = 'manual') {
    this.tenantContext.assertActor(actor);
    const request = await this.prisma.payout.findFirst({
      where: { id: payoutId, tenantId: actor.tenantId, status: PayoutStatus.requested },
      select: { id: true, membershipId: true, period: true },
    });
    if (!request) throw new NotFoundException('open payout request not found');
    const result = await this.engine.reservePayoutBatch({
      tenantId: actor.tenantId,
      scope: { mode: 'selected', membershipIds: [request.membershipId] },
      period: request.period,
      method: methodInput === 'csv' ? PayoutMethod.csv : PayoutMethod.manual,
      actorUserId: actor.userId,
      requestedPayoutId: request.id,
    });
    const processing = result.processing[0];
    return processing
      ? {
          processing: true as const,
          batchId: result.batchId,
          payoutId: processing.payoutId,
          totalCents: processing.totalCents.toString(),
          entryCount: processing.entryCount,
        }
      : {
          processing: false as const,
          reason: result.skipped[0]?.reason ?? 'nothing_payable',
          netCents: (result.skipped[0]?.netCents ?? 0n).toString(),
        };
  }

  async settleBatch(
    actor: ActorContext,
    batchId: string,
    input: { settlementReference: string; settlementEvidence: string },
  ) {
    this.tenantContext.assertActor(actor);
    return this.engine.settlePayoutBatch({
      tenantId: actor.tenantId,
      batchId,
      settlementReference: input.settlementReference,
      settlementEvidence: input.settlementEvidence,
      actorUserId: actor.userId,
    });
  }

  async failBatch(actor: ActorContext, batchId: string, reason: string) {
    this.tenantContext.assertActor(actor);
    return this.engine.failPayoutBatch({ tenantId: actor.tenantId, batchId, reason, actorUserId: actor.userId });
  }

  async rejectRequest(actor: ActorContext, payoutId: string, reason: string) {
    this.tenantContext.assertActor(actor);
    await this.engine.rejectPayoutRequest({ tenantId: actor.tenantId, payoutId, reason, actorUserId: actor.userId });
    return { ok: true as const };
  }

  async list(tenantId: string, q: { status?: PayoutStatus; period?: string; page: number; pageSize: number }) {
    this.tenantContext.assertTenant(tenantId);
    const where: Prisma.PayoutWhereInput = { tenantId, status: q.status, period: q.period };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payout.count({ where }),
      this.prisma.payout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          membership: { select: { referralCode: true, user: { select: { fullName: true } } } },
          tenant: { select: { currency: true } },
        },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((payout) => ({
        id: payout.id,
        batchId: payout.batchId,
        membershipId: payout.membershipId,
        referralCode: payout.membership.referralCode,
        fullName: payout.membership.user.fullName,
        totalCents: payout.totalCents.toString(),
        method: payout.method,
        status: payout.status,
        period: payout.period,
        processingStartedAt: payout.processingStartedAt,
        paidAt: payout.paidAt,
        settledAt: payout.settledAt,
        settlementReference: payout.settlementReference,
        rejectionReason: payout.rejectionReason,
        failureReason: payout.failureReason,
        presentation: mapLegacyPayoutPresentation({ ...payout, currency: payout.tenant.currency }),
      })),
    };
  }

  /** Deterministic, formula-safe payment instruction scoped to exactly one immutable batch. */
  async exportBatchCsv(tenantId: string, batchId: string): Promise<string> {
    this.tenantContext.assertTenant(tenantId);
    return this.prisma.$transaction(async (tx) => {
      const batchRows = await tx.$queryRaw<
        Array<{ id: string; period: string; status: PayoutSettlementBatchStatus; csvChecksum: string | null }>
      >`
        SELECT id, period, status, csv_checksum AS "csvChecksum"
        FROM payout_settlement_batches
        WHERE id = ${batchId}::uuid
          AND tenant_id = ${tenantId}::uuid
        FOR UPDATE`;
      if (batchRows.length === 0) throw new NotFoundException('payout batch not found');
      const batch = batchRows[0];
      if (
        batch.status !== PayoutSettlementBatchStatus.processing &&
        batch.status !== PayoutSettlementBatchStatus.settled
      ) {
        throw new ConflictException('failed payout batches cannot be exported as payment instructions');
      }
      const payouts = await tx.$queryRaw<
        Array<{
          id: string;
          membershipId: string;
          totalCents: bigint;
          recipientReferralCode: string | null;
          recipientFullName: string | null;
          recipientEmail: string | null;
          recipientSnapshotAt: Date | null;
        }>
      >`
        SELECT *
        FROM (
          SELECT DISTINCT ON (item.payout_id)
                 item.payout_id               AS id,
                 payout.membership_id         AS "membershipId",
                 payout.total_cents           AS "totalCents",
                 item.recipient_referral_code AS "recipientReferralCode",
                 item.recipient_full_name     AS "recipientFullName",
                 item.recipient_email         AS "recipientEmail",
                 item.recipient_snapshot_at   AS "recipientSnapshotAt"
          FROM payout_settlement_batch_items item
          JOIN payouts payout ON payout.id = item.payout_id
          WHERE item.batch_id = ${batch.id}::uuid
          ORDER BY item.payout_id, item.id
        ) AS payout_snapshots
        ORDER BY "membershipId", id`;
      if (payouts.length === 0) throw new ConflictException('payout batch has no payouts');
      if (
        payouts.some(
          (payout) =>
            payout.recipientReferralCode === null ||
            payout.recipientFullName === null ||
            payout.recipientEmail === null ||
            payout.recipientSnapshotAt === null,
        )
      ) {
        throw new ConflictException('payout batch is missing its immutable recipient snapshot');
      }
      const header = 'batch_id,payout_id,period,referral_code,full_name,email,amount_cents';
      const lines = payouts.map((payout) =>
        [
          csvCell(batch.id),
          csvCell(payout.id),
          csvCell(batch.period),
          csvCell(payout.recipientReferralCode),
          csvCell(payout.recipientFullName),
          csvCell(payout.recipientEmail),
          csvCell(payout.totalCents.toString()),
        ].join(','),
      );
      const csv = [header, ...lines].join('\n') + '\n';
      const checksum = sha256(csv);
      if (batch.csvChecksum && batch.csvChecksum !== checksum) {
        throw new ConflictException('payout batch CSV no longer matches its immutable settlement set');
      }
      if (!batch.csvChecksum) {
        await tx.payoutBatch.update({ where: { id: batch.id }, data: { csvChecksum: checksum } });
      }
      return csv;
    });
  }

  /** Historical paid export is period-bounded so it cannot silently become an unbounded data dump. */
  async exportPaidCsv(tenantId: string, period: string): Promise<string> {
    this.tenantContext.assertTenant(tenantId);
    const payouts = await this.prisma.payout.findMany({
      where: { tenantId, status: PayoutStatus.paid, period },
      orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
      include: { membership: { select: { referralCode: true, user: { select: { fullName: true, email: true } } } } },
    });
    const header = 'payout_id,batch_id,period,referral_code,full_name,email,amount_cents,settlement_reference,paid_at';
    const lines = payouts.map((payout) =>
      [
        csvCell(payout.id),
        csvCell(payout.batchId),
        csvCell(payout.period),
        csvCell(payout.membership.referralCode),
        csvCell(payout.membership.user.fullName),
        csvCell(payout.membership.user.email),
        csvCell(payout.totalCents.toString()),
        csvCell(payout.settlementReference),
        csvCell(payout.paidAt?.toISOString() ?? ''),
      ].join(','),
    );
    return [header, ...lines].join('\n') + '\n';
  }

  /** Member intent is serialized on the membership row and cannot create a fake failed transfer. */
  async requestPayout(membershipId: string, tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
    this.tenantContext.assertMembership(membershipId);
    return this.prisma.$transaction(async (tx) => {
      const members = await tx.$queryRaw<Array<{ id: string; emailVerifiedAt: Date | null }>>`
        SELECT m.id, u.email_verified_at AS "emailVerifiedAt"
        FROM memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.id = ${membershipId}::uuid
          AND m.tenant_id = ${tenantId}::uuid
        FOR UPDATE OF m`;
      if (members.length === 0) throw new BadRequestException('membership not found');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const period = monthKey(new Date(), tenant.timezone);
      const activeKey = payoutActiveKey(tenantId, membershipId, period);
      const active = await tx.$queryRaw<
        Array<{ id: string; status: PayoutStatus; totalCents: bigint }>
      >`
        SELECT id, status, total_cents AS "totalCents"
        FROM payouts
        WHERE tenant_id = ${tenantId}::uuid
          AND membership_id = ${membershipId}::uuid
          AND period = ${period}
          AND (active_key = ${activeKey} OR status IN ('requested', 'processing'))
        ORDER BY created_at ASC
        FOR UPDATE`;
      const existing = active.find((payout) => payout.status === PayoutStatus.processing) ?? active[0];
      const ledger = await tx.$queryRaw<Array<{ amountCents: bigint }>>`
        SELECT amount_cents AS "amountCents"
        FROM ledger_entries
        WHERE tenant_id = ${tenantId}::uuid
          AND beneficiary_membership_id = ${membershipId}::uuid
          AND status = 'payable'
        ORDER BY id
        FOR UPDATE`;
      const net = ledger.reduce((total, row) => total + row.amountCents, 0n);
      const readinessActivePayout = existing
        ? { id: existing.id, status: existing.status === PayoutStatus.processing ? ('processing' as const) : ('requested' as const) }
        : null;
      const complianceInput = await this.compliance.readInput(tx, tenantId, membershipId);
      const payoutReadiness = evaluatePayoutReadiness({
        emailVerified: members[0].emailVerifiedAt !== null,
        payableCents: net,
        threshold: { amountCents: tenant.payoutMinCents, currency: tenant.currency },
        activePayout: readinessActivePayout,
        mfa: { requirement: 'unknown' },
        manualChecks: complianceInput.manualChecks,
        destination: complianceInput.destination,
      });
      if (existing) {
        return {
          id: existing.id,
          status: existing.status,
          period,
          requestedCents: existing.totalCents.toString(),
          currency: tenant.currency,
          payoutReadiness,
        };
      }
      if (!payoutReadiness.requestable) {
        throw new BadRequestException({
          message: 'payout_not_ready',
          code: 'payout_not_ready',
          payoutReadiness,
        });
      }
      const payout = await tx.payout.create({
        data: {
          tenantId,
          membershipId,
          totalCents: net,
          method: PayoutMethod.manual,
          status: PayoutStatus.requested,
          period,
          activeKey,
        },
      });
      return {
        id: payout.id,
        status: payout.status,
        period,
        requestedCents: payout.totalCents.toString(),
        currency: tenant.currency,
        payoutReadiness,
      };
    });
  }

  async listMine(membershipId: string) {
    this.tenantContext.assertMembership(membershipId);
    const membership = await this.prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      select: { tenant: { select: { currency: true } } },
    });
    const rows = await this.prisma.payout.findMany({
      where: { membershipId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((payout) => {
      const snapshot = { ...payout, currency: membership.tenant.currency };
      return {
        id: payout.id,
        batchId: payout.batchId,
        totalCents: payout.totalCents.toString(),
        status: payout.status,
        method: payout.method,
        period: payout.period,
        processingStartedAt: payout.processingStartedAt,
        paidAt: payout.paidAt,
        settledAt: payout.settledAt,
        currency: membership.tenant.currency,
        presentation: mapLegacyPayoutPresentation(snapshot),
      };
    });
  }
}
