import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LedgerStatus, NotificationChannel, PayoutSettlementBatchStatus, PayoutMethod, PayoutStatus, Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authConfig } from '../auth/auth.config';
import { ActorContext } from '../common/actor';
import { sha256 } from '../common/crypto';
import { SecretCipher } from '../common/secret-cipher';
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
import { kycPayoutBlock } from '../kyc/kyc.types';
import { fraudPayoutBlock } from '../fraud/fraud.types';
import { WebhooksService } from '../webhooks/webhooks.service';
import { EventsService } from '../events/events.service';
import { SanctionsService } from '../sanctions/sanctions.service';
import { centsToDecimalString } from '@refearn/shared';
import { achConfigFromEnv, AchEntry, buildNachaFile } from './nacha';
import { mailingAddressComplete } from '../account/account.types';
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

type Tx = Prisma.TransactionClient;

/** decide/retry transaction'lari icin kilitlenen ledger satiri (ay anahtari summary kaydirmasi icin). */
interface PayoutLineRow {
  id: string;
  level: number;
  amountCents: bigint;
  status: LedgerStatus;
  month: string;
}

/** FOR UPDATE ile kilitlenen payout satiri. */
interface LockedPayoutRow {
  id: string;
  membershipId: string;
  status: PayoutStatus;
  totalCents: bigint;
  period: string;
  ref: string | null;
}

const TX_OPTS: { timeout: number; maxWait: number } = { timeout: 20_000, maxWait: 15_000 };

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly tenantContext: TenantContextService,
    private readonly compliance: PayoutComplianceService,
    private readonly webhooks: WebhooksService,
    private readonly events: EventsService,
    private readonly sanctions: SanctionsService,
    private readonly secretCipher: SecretCipher,
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
    // her uyenin BU AY kendi cirosu (sattigi) — odeme ekraninda "sattigi vs kazandigi"
    const month = monthKey(new Date(), tenant.timezone);
    const ids = rows.map((r) => r.membershipId);
    const soldAgg = ids.length
      ? await this.prisma.sale.groupBy({
          by: ['sellerMembershipId'],
          where: { tenantId, status: 'approved', summaryMonth: month, sellerMembershipId: { in: ids } },
          _sum: { amountCents: true },
        })
      : [];
    const soldBy = new Map(soldAgg.map((s) => [s.sellerMembershipId, s._sum.amountCents ?? 0n]));

    return {
      payoutMinCents: tenant.payoutMinCents.toString(),
      currency: tenant.currency,
      members: rows.map((r) => ({
        membershipId: r.membershipId,
        referralCode: r.referralCode,
        fullName: r.fullName,
        netCents: r.netCents.toString(),
        soldThisMonthCents: (soldBy.get(r.membershipId) ?? 0n).toString(),
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
  // ---- maker-checker batch'leri ----

  /** Bekleyen (proposed) batch'ler — onay kuyrugu. */
  async listBatches(tenantId: string) {
    const rows = await this.prisma.payoutBatch.findMany({ where: { tenantId, status: 'proposed' }, orderBy: { createdAt: 'desc' } });
    return rows.map((b) => ({ id: b.id, period: b.period, method: b.method, count: b.membershipIds.length, estimateCents: b.estimateCents.toString(), proposedByUserId: b.proposedByUserId, createdAt: b.createdAt }));
  }

  /** Onayla + yurut. Maker≠checker: oneren kisi onaylayamaz. */
  async approveBatch(actor: ActorContext, batchId: string) {
    const batch = await this.prisma.payoutBatch.findFirst({ where: { id: batchId, tenantId: actor.tenantId } });
    if (!batch) throw new NotFoundException('payout onerisi bulunamadi');
    if (batch.status !== 'proposed') throw new ConflictException('yalnizca bekleyen oneri onaylanabilir');
    if (batch.proposedByUserId === actor.userId) throw new BadRequestException('oneriyi yapan kisi onaylayamaz (4-goz)');

    const result = await this.engine.reservePayoutBatch({
      tenantId: actor.tenantId,
      scope: batch.membershipIds.length > 0
        ? { mode: 'selected', membershipIds: batch.membershipIds }
        : { mode: 'all_eligible' },
      period: batch.period,
      method: batch.method,
      actorUserId: actor.userId,
    });
    await this.prisma.payoutBatch.update({ where: { id: batch.id }, data: { status: 'executed', approvedByUserId: actor.userId, executedAt: new Date() } });
    const actualProcessingCents = result.processing.reduce((total, payout) => total + payout.totalCents, 0n);
    await this.audit2(actor, 'payout.batch_approve', batch.id, {
      processingCount: result.processing.length,
      skippedCount: result.skipped.length,
      estimateCents: batch.estimateCents.toString(),
      actualProcessingCents: actualProcessingCents.toString(),
    });
    return {
      batchId: batch.id,
      settlementBatchId: result.batchId,
      estimateCents: batch.estimateCents.toString(),
      actualProcessingCents: actualProcessingCents.toString(),
      processingCount: result.processing.length,
      skippedCount: result.skipped.length,
      processing: result.processing.map((payout) => ({
        membershipId: payout.membershipId,
        payoutId: payout.payoutId,
        totalCents: payout.totalCents.toString(),
        entryCount: payout.entryCount,
      })),
      skipped: result.skipped.map((item) => ({ ...item, netCents: item.netCents.toString() })),
    };
  }

  async rejectBatch(actor: ActorContext, batchId: string) {
    const batch = await this.prisma.payoutBatch.findFirst({ where: { id: batchId, tenantId: actor.tenantId } });
    if (!batch) throw new NotFoundException('payout onerisi bulunamadi');
    if (batch.status !== 'proposed') throw new ConflictException('yalnizca bekleyen oneri reddedilebilir');
    await this.prisma.payoutBatch.update({ where: { id: batch.id }, data: { status: 'rejected', approvedByUserId: actor.userId } });
    await this.audit2(actor, 'payout.batch_reject', batch.id, {});
    return { rejected: true };
  }

  private async audit2(actor: ActorContext, action: string, entityId: string, after: object): Promise<void> {
    await this.prisma.auditLog.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, action, entity: 'payout', entityId, after } });
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
        ref: payout.ref,
        clearedAt: payout.clearedAt,
        bankRef: payout.bankRef,
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
        await tx.payoutSettlementBatch.update({ where: { id: batch.id }, data: { csvChecksum: checksum } });
      }
      return csv;
    });
  }

  /** Historical paid export is period-bounded so it cannot silently become an unbounded data dump. */
  async exportPaidCsv(tenantId: string, period: string): Promise<string> {
    this.tenantContext.assertTenant(tenantId);
    return this.exportCsv(tenantId, period);
  }

  /** Payout dekontu (SPEC 9): payout + uye bilgisi + bagli ledger satirlari. */
  async detail(tenantId: string, payoutId: string) {
    const p = await this.prisma.payout.findFirst({
      where: { id: payoutId, tenantId },
      include: {
        membership: { select: { referralCode: true, user: { select: { fullName: true, email: true } } } },
        entries: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, saleId: true, level: true, type: true, amountCents: true, createdAt: true },
        },
      },
    });
    if (!p) {
      throw new NotFoundException('odeme bulunamadi');
    }
    return {
      id: p.id,
      membershipId: p.membershipId,
      member: {
        fullName: p.membership.user.fullName,
        referralCode: p.membership.referralCode,
        email: p.membership.user.email,
      },
      totalCents: p.totalCents.toString(),
      method: p.method,
      status: p.status,
      period: p.period,
      paidAt: p.paidAt,
      ref: p.ref,
      clearedAt: p.clearedAt,
      bankRef: p.bankRef,
      createdAt: p.createdAt,
      lines: p.entries.map((e) => ({
        id: e.id,
        saleId: e.saleId,
        level: e.level,
        type: e.type,
        amountCents: e.amountCents.toString(),
        createdAt: e.createdAt,
      })),
    };
  }

  /**
   * Talep karari (SPEC 9). Yalnizca 'requested'|'processing' payout icin, TEK transaction:
   * - approve: requestPayout satir BAGLAMAZ (yalnizca tutari snapshot'lar); once bu payout'a
   *   bagli satirlara bakilir, yoksa requestPayout'un sectigi kume uygulanir — uyenin TUM
   *   payable satirlari (negatif reversal/mahsup dahil, engine.payoutMember ile ayni mantik).
   *   Satirlar 'paid' + payout_id, summary payable→paid, payout paid + paidAt + ref.
   * - reject: bagli satirlar 'payable'a geri doner + payout_id=null (bakiye uyeye iade),
   *   payout 'failed' + ref'e sebep.
   */
  async decide(actor: ActorContext, payoutId: string, input: { action: 'approve' | 'reject'; ref?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      const payout = await this.lockPayout(tx, actor.tenantId, payoutId);
      if (payout.status !== PayoutStatus.requested && payout.status !== PayoutStatus.processing) {
        throw new ConflictException('yalnizca requested/processing durumundaki odeme karara baglanabilir');
      }

      if (input.action === 'approve') {
        // Faz B2: para HAREKETINDEN once kapilari CANLI dogrula — sanctions/kyc/fraud durumu talep
        // aninda temiz olsa bile onaya kadar degismis olabilir (executeTargets ile ayni guvenlik).
        const gate = await this.payoutGateBlock(tx, tenant, payout.membershipId);
        if (gate) throw new ForbiddenException(`odeme onaylanamaz — ${gate}`);

        let lines = await this.lockBoundLines(tx, tenant.timezone, payoutId);
        if (lines.length === 0) {
          // requestPayout'un secimi: uyenin tum payable satirlari (mahsup dahil)
          lines = await this.lockPayableLines(tx, tenant.timezone, actor.tenantId, payout.membershipId);
        }
        if (lines.length === 0) {
          throw new BadRequestException('odenebilir ledger satiri kalmamis — talep onaylanamaz');
        }
        const net = lines.reduce((a, l) => a + l.amountCents, 0n);
        if (net <= 0n) {
          throw new BadRequestException('net odenebilir tutar pozitif degil — talep onaylanamaz');
        }

        // maker-checker: onaylayan, talep aninda gozden gecirilen snapshot'tan (payout.totalCents)
        // FAZLASINI odeyemez. Talep-onay arasinda yeni komisyon olgunlasip net artmissa bakiye
        // degismis demektir — yeni tutar tekrar gozden gecirilmeli (talebi yenile). Net dustuyse
        // (clawback) snapshot'tan az oldugu icin sorun yok; gercek (dusuk) net odenir.
        if (net > payout.totalCents) {
          throw new ConflictException(
            `odenebilir bakiye talep anindan beri artti (onaylanan ${payout.totalCents.toString()} → guncel ${net.toString()}); lutfen talebi yenileyin`,
          );
        }

        // kilitli aya ait payable payout edilemez (o ayin summary'sini degistirir) — engine.payoutMember ile ayni guard
        await this.assertPeriodsOpen(tx, actor.tenantId, lines.map((l) => l.month));

        await tx.ledgerEntry.updateMany({
          where: { id: { in: lines.map((l) => l.id) } },
          data: { status: LedgerStatus.paid, payoutId },
        });
        // summary kaydirma yalnizca su an payable olan satirlar icin (zaten paid olan no-op)
        await this.shiftSummaries(
          tx,
          actor.tenantId,
          payout.membershipId,
          lines.filter((l) => l.status === LedgerStatus.payable),
          'payableToPaid',
        );

        const updated = await tx.payout.update({
          where: { id: payoutId },
          // totalCents talep anindaki snapshot'ti; fiilen odenen satirlarin netiyle esitle
          data: {
            status: PayoutStatus.paid,
            paidAt: new Date(),
            totalCents: net,
            ...(input.ref !== undefined ? { ref: input.ref } : {}),
          },
        });

        await tx.notification.create({
          data: {
            tenantId: actor.tenantId,
            recipientMembershipId: payout.membershipId,
            channel: NotificationChannel.push,
            template: 'payout_sent',
            payload: { payoutId, totalCents: net.toString(), period: payout.period },
          },
        });
        await this.audit(tx, actor, 'payout.approve', payoutId,
          { status: payout.status, totalCents: payout.totalCents.toString() },
          { status: 'paid', totalCents: net.toString(), entryCount: lines.length, ref: input.ref ?? null });

        return this.serializeDecision(updated, lines.length);
      }

      // reject — bagli satirlari serbest birak (bakiye uyeye iade)
      const lines = await this.lockBoundLines(tx, tenant.timezone, payoutId);
      // Yalnizca su an 'paid' olan bagli satirlar serbest birakilir: ledger updateMany ile
      // summary geri alma AYNI kume uzerinde calismali (asimetri = ledger/summary sapmasi).
      const paidLines = lines.filter((l) => l.status === LedgerStatus.paid);
      if (paidLines.length > 0) {
        // kilitli ayin summary'sini (paid→payable) geri almak da donem kilidini ihlal eder
        await this.assertPeriodsOpen(tx, actor.tenantId, paidLines.map((l) => l.month));
        // kaynak durum 'paid' degilse dokunma (status'u korumasiz ezme) — summary filtresini birebir yansit
        await tx.ledgerEntry.updateMany({
          where: { id: { in: paidLines.map((l) => l.id) }, status: LedgerStatus.paid },
          data: { status: LedgerStatus.payable, payoutId: null },
        });
        // paid'e gecmis satirlarin summary'sini geri al
        await this.shiftSummaries(
          tx,
          actor.tenantId,
          payout.membershipId,
          paidLines,
          'paidToPayable',
        );
      }
      const updated = await tx.payout.update({
        where: { id: payoutId },
        data: { status: PayoutStatus.failed, ...(input.ref !== undefined ? { ref: input.ref } : {}) },
      });
      await this.audit(tx, actor, 'payout.reject', payoutId,
        { status: payout.status },
        { status: 'failed', releasedCount: paidLines.length, ref: input.ref ?? null });

      return this.serializeDecision(updated, paidLines.length);
    }, TX_OPTS);
  }

  /**
   * Basarisiz odemeyi yeniden dene (SPEC 9). Yalnizca status='failed' VE hala bu payout'a
   * bagli ledger satirlari varsa: satirlar 'paid', payout 'paid' + paidAt. Reject bagli
   * satirlari serbest biraktigi icin reddedilmis talep retry edilemez — yeni odeme calistirilir.
   */
  async retry(actor: ActorContext, payoutId: string) {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      const payout = await this.lockPayout(tx, actor.tenantId, payoutId);
      if (payout.status !== PayoutStatus.failed) {
        throw new ConflictException('yalnizca failed durumundaki odeme yeniden denenebilir');
      }

      const lines = await this.lockBoundLines(tx, tenant.timezone, payoutId);
      if (lines.length === 0) {
        throw new BadRequestException('bu odeme reddedilmis; bakiye uyeye iade edildi — yeni odeme calistirin');
      }

      // Faz B2: yeniden odeme de para hareketidir — kapilari CANLI dogrula (decide ile ayni)
      const gate = await this.payoutGateBlock(tx, tenant, payout.membershipId);
      if (gate) throw new ForbiddenException(`odeme yeniden denenemez — ${gate}`);

      // kilitli aya ait payable yeniden payout edilemez — engine.payoutMember/decide ile ayni guard
      await this.assertPeriodsOpen(tx, actor.tenantId, lines.map((l) => l.month));

      await tx.ledgerEntry.updateMany({
        where: { id: { in: lines.map((l) => l.id) } },
        data: { status: LedgerStatus.paid },
      });
      await this.shiftSummaries(
        tx,
        actor.tenantId,
        payout.membershipId,
        lines.filter((l) => l.status === LedgerStatus.payable),
        'payableToPaid',
      );

      const updated = await tx.payout.update({
        where: { id: payoutId },
        data: { status: PayoutStatus.paid, paidAt: new Date() },
      });

      await tx.notification.create({
        data: {
          tenantId: actor.tenantId,
          recipientMembershipId: payout.membershipId,
          channel: NotificationChannel.push,
          template: 'payout_sent',
          payload: { payoutId, totalCents: payout.totalCents.toString(), period: payout.period },
        },
      });
      await this.audit(tx, actor, 'payout.retry', payoutId,
        { status: payout.status },
        { status: 'paid', totalCents: payout.totalCents.toString(), entryCount: lines.length });

      return this.serializeDecision(updated, lines.length);
    }, TX_OPTS);
  }

  /** Banka CSV exportu (SPEC 9): odenmis payout'lar. */
  async exportCsv(tenantId: string, period?: string): Promise<string> {
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

  /**
   * Banka mutabakati (Dalga 3): banka ACH'i isleyip parayi gonderdikten sonra admin ekstreyi
   * import eder. Her satir, henuz mutabik olmayan 'paid' bir payout ile TUTARA gore eslenir
   * (her payout en fazla bir kez). Eslesenler 'cleared' isaretlenir; eslesmeyenler raporlanir.
   */
  async reconcile(
    actor: ActorContext,
    rows: Array<{ amountCents: number; ref?: string }>,
  ): Promise<{
    clearedCount: number;
    matched: Array<{ payoutId: string; membershipId: string; amountCents: string; bankRef: string | null }>;
    unmatched: Array<{ amountCents: number; ref?: string }>;
    remainingUncleared: number;
  }> {
    const matched: Array<{ payoutId: string; membershipId: string; amountCents: string; bankRef: string | null }> = [];
    const unmatched: Array<{ amountCents: number; ref?: string }> = [];

    // TEK transaction: eszamanli reconcile / cift-tik ayni payout'u iki kez temizleyemesin.
    // FOR UPDATE SKIP LOCKED → paralel calisan reconcile bu satirlari atlar (uzerine binmez);
    // her eslesme updateMany WHERE clearedAt IS NULL ile kosullu (0-count = baska run temizledi → unmatched).
    await this.prisma.$transaction(async (tx) => {
      const open = await tx.$queryRaw<Array<{ id: string; membershipId: string; totalCents: bigint }>>`
        SELECT id, membership_id AS "membershipId", total_cents AS "totalCents"
        FROM payouts
        WHERE tenant_id = ${actor.tenantId}::uuid
          AND status = 'paid'
          AND cleared_at IS NULL
        ORDER BY paid_at ASC
        FOR UPDATE SKIP LOCKED`;

      const byAmount = new Map<string, Array<{ id: string; membershipId: string }>>();
      for (const p of open) {
        const key = p.totalCents.toString();
        const arr = byAmount.get(key) ?? [];
        arr.push({ id: p.id, membershipId: p.membershipId });
        byAmount.set(key, arr);
      }

      const now = new Date();
      for (const row of rows) {
        const key = BigInt(Math.round(row.amountCents)).toString();
        const bucket = byAmount.get(key);
        const hit = bucket?.shift(); // ayni tutarda birden cok varsa FIFO
        if (!hit) {
          unmatched.push(row);
          continue;
        }
        // kosullu: yalnizca hala uncleared ise temizle (yaris durumuna karsi idempotent)
        const res = await tx.payout.updateMany({
          where: { id: hit.id, clearedAt: null },
          data: { clearedAt: now, bankRef: row.ref ?? null, reconciledByUserId: actor.userId },
        });
        if (res.count === 0) {
          unmatched.push(row); // baska transaction bu arada temizledi
          continue;
        }
        matched.push({ payoutId: hit.id, membershipId: hit.membershipId, amountCents: key, bankRef: row.ref ?? null });
      }

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'payout.reconcile',
          entity: 'payout',
          after: { clearedCount: matched.length, unmatchedCount: unmatched.length } as Prisma.InputJsonValue,
        },
      });
    }, TX_OPTS);

    const remainingUncleared = await this.prisma.payout.count({
      where: { tenantId: actor.tenantId, status: PayoutStatus.paid, clearedAt: null },
    });
    return { clearedCount: matched.length, matched, unmatched, remainingUncleared };
  }

  /**
   * Self-hosted ACH/NACHA dosyasi (Dalga 3): donemin odenmis payout'lari icin banka dosyasi.
   * Dis servis YOK — admin bunu kendi bankasina yukler. Banka bilgisi (sifreli) decrypt edilir.
   *
   * Banka bilgisi (payoutProfile/accountEnc) olmayan 'paid' payout'lar dosyaya GIREMEZ; sessizce
   * dusurulurse admin herkesi odedigini sanir ama dosya eksik fonludur. Bu yuzden atlananlari
   * toplayip dondururuz (controller X-Refearn-Skipped header'i ile yuzeye cikarir) ve uyari loglariz.
   */
  async achFile(
    tenantId: string,
    period?: string,
  ): Promise<{ file: string; skipped: Array<{ membershipId: string; name: string; reason: string }> }> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const payouts = await this.prisma.payout.findMany({
      where: { tenantId, status: PayoutStatus.paid, period },
      orderBy: { paidAt: 'asc' },
      include: { membership: { select: { id: true, user: { select: { fullName: true } }, payoutProfile: true } } },
    });
    const entries: AchEntry[] = [];
    const skipped: Array<{ membershipId: string; name: string; reason: string }> = [];
    for (const p of payouts) {
      const prof = p.membership.payoutProfile;
      if (!prof || !prof.accountEnc) {
        // banka bilgisi yoksa atla — sessizce degil: topla + uyar (eksik fonlu dosya riski)
        skipped.push({
          membershipId: p.membership.id,
          name: prof?.legalName ?? p.membership.user.fullName,
          reason: !prof ? 'no_payout_profile' : 'no_bank_account',
        });
        continue;
      }
      // NACHA entry tutar alani 10 hane = max 9_999_999_999 cent ($99,999,999.99).
      // Sinir asilirsa bozuk/kesilmis dosya yerine hata firlat (BigInt sinir kontrolu).
      if (p.totalCents < 0n || p.totalCents > 9_999_999_999n) {
        throw new BadRequestException(
          `payout ${p.id} tutari NACHA entry siniri disinda ($99,999,999.99) — ACH dosyasi olusturulamaz`,
        );
      }
      entries.push({
        routingNumber: prof.routingNumber,
        accountNumber: await this.secretCipher.decrypt(prof.accountEnc, {
          purpose: 'payout-account',
          tenantId: p.tenantId,
          recordId: p.membership.id,
        }),
        accountType: prof.accountType === 'savings' ? 'savings' : 'checking',
        amountCents: Number(p.totalCents),
        name: prof.legalName ?? p.membership.user.fullName,
        id: p.membership.id,
      });
    }
    if (skipped.length) {
      this.logger.warn(
        `ACH dosyasi: ${skipped.length} odenmis payout banka bilgisi olmadan atlandi (dosya eksik fonlu) ` +
          `tenant=${tenantId} period=${period ?? 'all'} membershipIds=${skipped.map((s) => s.membershipId).join(',')}`,
      );
    }
    const file = buildNachaFile(entries, achConfigFromEnv(tenant.name), new Date());
    return { file, skipped };
  }

  /** Uye payout talebi (SPEC 8): net payable >= esik ise 'requested' kayit. */
  async requestPayout(membershipId: string, tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const assessed = await this.assessPayout(membershipId, tenant);
    if ('block' in assessed) {
      throw new BadRequestException(assessed.block);
    }
    const period = monthKey(new Date(), tenant.timezone);
    const r = await this.createCheckRequest(membershipId, tenantId, assessed.net, period);
    return { id: r.id, status: r.status, period: r.period, requestedCents: r.requestedCents };
  }

  /**
   * Payout uygunluk kapilari (requestPayout + auto-request A3 ORTAK kaynagi). Tum kapilar gecerse
   * { net } doner, biri takilirsa { block: <sebep> }. Para HAREKETI / KAYIT YOK — yalniz degerlendirme.
   * Kapilar: uyelik var + e-posta dogrulu + cek adresi tam + sanctions(canli) + KYC(bayrak) + fraud + esik.
   */
  private async assessPayout(
    membershipId: string,
    tenant: { id: string; payoutMinCents: bigint; requireKycForPayout: boolean },
  ): Promise<{ net: bigint } | { block: string }> {
    const tenantId = tenant.id;
    // Dolandiricilik kapisi: dogrulanmamis (sybil) hesap kazanc cekemesin.
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: {
        user: { select: { emailVerifiedAt: true } },
        mailingName: true, mailingLine1: true, mailingCity: true, mailingState: true, mailingPostal: true,
      },
    });
    if (!membership) return { block: 'uyelik bulunamadi' };
    if (!membership.user.emailVerifiedAt) return { block: 'odeme talebi icin e-posta adresinizi dogrulamaniz gerekir' };

    // sanctions (her zaman) + KYC kapisi (tenant bayragi)
    const profile = await this.prisma.payoutProfile.findUnique({
      where: { membershipId },
      select: { status: true, lastChangedAt: true, sanctionsHit: true, legalName: true },
    });
    // CANLI yeniden tara: talep aninda yaptirim eslesmesi (submit'ten sonra listeye girmis olabilir)
    if (profile && !profile.sanctionsHit && (await this.sanctions.isHit(profile.legalName))) {
      await this.markSanctionsHit(tenantId, membershipId);
      profile.sanctionsHit = true;
    }
    if (profile?.sanctionsHit) return { block: 'sanctions match — compliance review' };
    if (tenant.requireKycForPayout) {
      const block = kycPayoutBlock(profile);
      if (block) return { block };
    }
    // fraud bayragi: bloklu uye odeme talebi acamaz (her zaman acik)
    const flag = await this.prisma.fraudFlag.findUnique({ where: { membershipId }, select: { status: true, score: true } });
    const fraudBlock = fraudPayoutBlock(flag);
    if (fraudBlock) return { block: fraudBlock };

    const agg = await this.prisma.ledgerEntry.aggregate({
      where: { tenantId, beneficiaryMembershipId: membershipId, status: LedgerStatus.payable },
      _sum: { amountCents: true },
    });
    const net = agg._sum.amountCents ?? 0n;
    if (net < tenant.payoutMinCents) {
      return {
        block: `odenebilir bakiye ($${(Number(net) / 100).toFixed(2)}) minimum esigin ($${(Number(tenant.payoutMinCents) / 100).toFixed(2)}) altinda`,
      };
    }
    // Cek-odeme kapisi (Faz A2): cek bir adrese postalanir — esigi gecse bile eksik adresle talep
    // acilamaz. Guvenlik/esik kapilarindan SONRA: yaptirimlı/bloklu uyeye "adresini tamamla" denmez.
    if (!mailingAddressComplete(membership)) return { block: 'odeme talebi icin once cek posta adresinizi tamamlayin (Account)' };
    return { net };
  }

  /**
   * Tek ACIK (requested|processing) talep kurali: varsa onu don (created=false), yoksa method=check
   * 'requested' talep olustur (created=true). P2002 (uye basina tek-acik kismi unique) yarisinda kazanani don.
   * donemden BAGIMSIZ dedupe (tenant scope) — ay donerken baglanmamis bakiye cift sayilmasin.
   */
  private async createCheckRequest(
    membershipId: string,
    tenantId: string,
    net: bigint,
    period: string,
  ): Promise<{ id: string; status: PayoutStatus; period: string; requestedCents: string; created: boolean }> {
    const existing = await this.prisma.payout.findFirst({
      where: { tenantId, membershipId, status: { in: [PayoutStatus.requested, PayoutStatus.processing] } },
    });
    if (existing) {
      return { id: existing.id, status: existing.status, period: existing.period, requestedCents: existing.totalCents.toString(), created: false };
    }
    try {
      const payout = await this.prisma.payout.create({
        data: { tenantId, membershipId, totalCents: net, method: PayoutMethod.check, status: PayoutStatus.requested, period },
      });
      return { id: payout.id, status: payout.status, period, requestedCents: net.toString(), created: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await this.prisma.payout.findFirst({
          where: { tenantId, membershipId, status: { in: [PayoutStatus.requested, PayoutStatus.processing] } },
        });
        if (winner) {
          return { id: winner.id, status: winner.status, period: winner.period, requestedCents: winner.totalCents.toString(), created: false };
        }
      }
      throw e;
    }
  }

  /**
   * Faz A3: gece job'u — esigi gecen uyelere OTOMATIK 'requested' cek talebi acar + uyeye bildirir.
   * PARA CIKMAZ: status='requested'; gercek odeme yine admin onayindan (decide/approve) gecer.
   * Tenant.autoRequestPayouts kapaliysa o tenant atlanir. Idempotent: zaten acik talebi olan uye
   * tekrar olusturmaz (createCheckRequest dedupe). assessPayout ile requestPayout ile AYNI kapilar.
   */
  async autoRequestPayouts(): Promise<{ tenants: number; created: number; skipped: number }> {
    const tenants = await this.prisma.tenant.findMany({
      where: { autoRequestPayouts: true },
      select: { id: true, payoutMinCents: true, requireKycForPayout: true, timezone: true },
    });
    let created = 0;
    let skipped = 0;
    for (const tenant of tenants) {
      // esigi gecen aday uyeler (payable net >= payoutMin) — payable() ile ayni esik mantigi
      const candidates = await this.prisma.$queryRaw<Array<{ membershipId: string }>>`
        SELECT le.beneficiary_membership_id AS "membershipId"
        FROM ledger_entries le
        WHERE le.tenant_id = ${tenant.id}::uuid AND le.status = 'payable'
        GROUP BY le.beneficiary_membership_id
        HAVING SUM(le.amount_cents) >= ${tenant.payoutMinCents}`;
      const period = monthKey(new Date(), tenant.timezone);
      for (const { membershipId } of candidates) {
        try {
          const assessed = await this.assessPayout(membershipId, tenant);
          if ('block' in assessed) { skipped++; continue; }
          const r = await this.createCheckRequest(membershipId, tenant.id, assessed.net, period);
          if (!r.created) { skipped++; continue; } // zaten acik talep vardi → cift olusturma
          created++;
          // bildirim AYRI sarmali: payout olustu (created++), bildirim insert'i patlarsa uyeyi
          // 'skipped' SAYMA (cift sayim olur) — outbox satiri uretilemedi diye sadece uyar.
          try {
            await this.notifyAutoRequest(tenant.id, membershipId, assessed.net, period, r.id);
          } catch (nerr) {
            this.logger.warn(`auto-request: uye ${membershipId} payout ${r.id} olustu ama bildirim yazilamadi — ${nerr instanceof Error ? nerr.message : String(nerr)}`);
          }
        } catch (err) {
          // tek uye hatasi tum job'u dusurmesin
          skipped++;
          this.logger.warn(`auto-request: uye ${membershipId} atlandi — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    if (created > 0) this.logger.log(`auto-request: ${created} cek talebi acildi (${tenants.length} tenant, ${skipped} atlandi)`);
    return { tenants: tenants.length, created, skipped };
  }

  /** A3 bildirimi: uyeye e-posta + in-app "cek hazirlaniyor (onay bekler)". Outbox worker gonderir. */
  private async notifyAutoRequest(tenantId: string, membershipId: string, net: bigint, period: string, payoutId: string): Promise<void> {
    const payload = { totalCents: net.toString(), period, payoutId } as Prisma.InputJsonValue;
    await this.prisma.notification.createMany({
      data: [
        { tenantId, recipientMembershipId: membershipId, channel: NotificationChannel.email, template: 'payout_auto_requested', payload },
        { tenantId, recipientMembershipId: membershipId, channel: NotificationChannel.in_app, template: 'payout_auto_requested', payload },
      ],
    });
  }

  /**
   * Uye cek geçmişi/makbuzu (Faz A4). Her payout'a uye-dostu bir 'checkStatus' türetir:
   * pending_review (onay bekler) → approved (onaylandı, cek hazirlaniyor) → printed (cek kesildi)
   * → mailed (postalandi). non-cek/eski paid = 'paid', failed = 'declined'. Para HAREKETI yok.
   */
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
    const checkStatusOf = (p: (typeof rows)[number]): string => {
      if (p.status === PayoutStatus.requested || p.status === PayoutStatus.processing) return 'pending_review';
      if (p.status === PayoutStatus.failed) return 'declined';
      if (p.status === PayoutStatus.paid && p.method === PayoutMethod.check) {
        if (p.mailedAt) return 'mailed';
        if (p.checkNumber != null) return 'printed';
        return 'approved';
      }
      return 'paid';
    };
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
        checkNumber: payout.checkNumber,
        mailedAt: payout.mailedAt,
        checkStatus: checkStatusOf(payout),
        currency: membership.tenant.currency,
        presentation: mapLegacyPayoutPresentation(snapshot),
      };
    });
  }

  // ---------------------------------------------------------------- internals

  /** CANLI yaptirim eslesmesinde profili kalici 'hit' isaretle (sonraki kapilar da bloklasin). */
  private async markSanctionsHit(tenantId: string, membershipId: string): Promise<void> {
    await this.prisma.payoutProfile.updateMany({
      where: { tenantId, membershipId },
      data: { sanctionsHit: true },
    });
  }

  /**
   * Para-cikis kapilari (Faz B2 — money-move aninda CANLI dogrulama): sanctions(canli yeniden-tara)
   * + KYC(tenant bayragi) + fraud. Bloklu ise sebep doner, temizse null. executeTargets (admin toplu)
   * AYNI kapilari uygular; bu, tek-payout decide/retry icin AYNI guvenligi para hareketinden ONCE saglar.
   * tx icinde calisir (sanctions mark dahil) — onay/odeme ile atomik.
   */
  private async payoutGateBlock(
    tx: Tx,
    tenant: { id: string; requireKycForPayout: boolean },
    membershipId: string,
  ): Promise<string | null> {
    const profile = await tx.payoutProfile.findUnique({
      where: { membershipId },
      select: { status: true, lastChangedAt: true, sanctionsHit: true, legalName: true },
    });
    let sanctionsHit = profile?.sanctionsHit ?? false;
    if (profile && !sanctionsHit && (await this.sanctions.isHit(profile.legalName))) {
      await tx.payoutProfile.updateMany({ where: { tenantId: tenant.id, membershipId }, data: { sanctionsHit: true } });
      sanctionsHit = true;
    }
    if (sanctionsHit) return 'sanctions match — compliance review';
    if (tenant.requireKycForPayout) {
      const b = kycPayoutBlock(profile);
      if (b) return b;
    }
    const flag = await tx.fraudFlag.findUnique({ where: { membershipId }, select: { status: true, score: true } });
    return fraudPayoutBlock(flag);
  }

  /**
   * Donem kilidi (muhasebe kapanisi): payout karari kilitli bir ayin summary'sine dokunamaz.
   * engine.assertPeriodsOpen ile AYNI kural — payable→paid / paid→payable her iki yon de kilitli aya yazamaz.
   *
   * TOCTOU kapanisi: engine.assertPeriodsOpen ile AYNI advisory anahtari — kilit okumasindan ONCE
   * (tenant, period) basina tx-scope advisory lock al; PeriodsService.lock/unlock ile seri calisir.
   * Anahtarlar SIRALI alinir (deadlock'a karsi: cok-donemli payout'lar ayni kuresel sirayla kilitler).
   */
  private async assertPeriodsOpen(tx: Tx, tenantId: string, periods: string[]): Promise<void> {
    const unique = [...new Set(periods)].sort();
    if (unique.length === 0) return;
    for (const period of unique) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${period}))`;
    }
    const lock = await tx.periodLock.findFirst({ where: { tenantId, period: { in: unique } } });
    if (lock) {
      throw new ConflictException(`donem kilitli (${lock.period}) — once muhasebe kilidini acin`);
    }
  }

  /** Payout'u FOR UPDATE ile kilitle — eszamanli decide/retry cift islemesin. Tenant-scoped. */
  private async lockPayout(tx: Tx, tenantId: string, payoutId: string): Promise<LockedPayoutRow> {
    const rows = await tx.$queryRaw<LockedPayoutRow[]>`
      SELECT id,
             membership_id AS "membershipId",
             status,
             total_cents   AS "totalCents",
             period,
             ref
      FROM payouts
      WHERE id = ${payoutId}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) {
      throw new NotFoundException('odeme bulunamadi');
    }
    return rows[0];
  }

  /** Bu payout'a bagli ledger satirlarini kilitle (ay anahtari engine ile ayni COALESCE kuralindan).
      LEFT JOIN: satisa bagli olmayan bonus/ayarlama satirlari da dahil (ay le.summary_month'tan). */
  private lockBoundLines(tx: Tx, timezone: string, payoutId: string): Promise<PayoutLineRow[]> {
    return tx.$queryRaw<PayoutLineRow[]>`
      SELECT le.id,
             le.level,
             le.amount_cents AS "amountCents",
             le.status,
             COALESCE(
               le.summary_month,
               s.summary_month,
               to_char(s.sale_date AT TIME ZONE ${timezone}, 'YYYY-MM')
             ) AS "month"
      FROM ledger_entries le
      LEFT JOIN sales s ON s.id = le.sale_id
      WHERE le.payout_id = ${payoutId}::uuid
      FOR UPDATE OF le`;
  }

  /** Uyenin TUM payable satirlarini kilitle — engine.payoutMember / requestPayout secimiyle ayni kume. */
  private lockPayableLines(tx: Tx, timezone: string, tenantId: string, membershipId: string): Promise<PayoutLineRow[]> {
    return tx.$queryRaw<PayoutLineRow[]>`
      SELECT le.id,
             le.level,
             le.amount_cents AS "amountCents",
             le.status,
             COALESCE(
               le.summary_month,
               s.summary_month,
               to_char(s.sale_date AT TIME ZONE ${timezone}, 'YYYY-MM')
             ) AS "month"
      FROM ledger_entries le
      LEFT JOIN sales s ON s.id = le.sale_id
      WHERE le.tenant_id = ${tenantId}::uuid
        AND le.beneficiary_membership_id = ${membershipId}::uuid
        AND le.status = 'payable'
      FOR UPDATE OF le`;
  }

  /** monthly_summaries kaydirma: (month, level) basina grupla, tek yonlu delta uygula. */
  private async shiftSummaries(
    tx: Tx,
    tenantId: string,
    membershipId: string,
    lines: PayoutLineRow[],
    direction: 'payableToPaid' | 'paidToPayable',
  ): Promise<void> {
    const byKey = new Map<string, { month: string; level: number; amount: bigint }>();
    for (const l of lines) {
      const key = `${l.month}|${l.level}`;
      const cur = byKey.get(key) ?? { month: l.month, level: l.level, amount: 0n };
      cur.amount += l.amountCents;
      byKey.set(key, cur);
    }
    for (const { month, level, amount } of byKey.values()) {
      const payable = direction === 'payableToPaid' ? -amount : amount;
      const paid = direction === 'payableToPaid' ? amount : -amount;
      // Raw ON CONFLICT upsert — engine.bumpSummary ile ayni kalip (yaris durumuna dayanikli)
      await tx.$executeRaw`
        INSERT INTO monthly_summaries
          (id, tenant_id, membership_id, month, level, pending_cents, payable_cents, paid_cents, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${tenantId}::uuid, ${membershipId}::uuid, ${month}, ${level}, 0, ${payable}, ${paid}, now(), now())
        ON CONFLICT (tenant_id, membership_id, month, level) DO UPDATE SET
          payable_cents = monthly_summaries.payable_cents + EXCLUDED.payable_cents,
          paid_cents    = monthly_summaries.paid_cents    + EXCLUDED.paid_cents,
          updated_at    = now()`;
    }
  }

  private serializeDecision(
    p: { id: string; status: PayoutStatus; period: string; totalCents: bigint; paidAt: Date | null; ref: string | null },
    lineCount: number,
  ) {
    return {
      id: p.id,
      status: p.status,
      period: p.period,
      totalCents: p.totalCents.toString(),
      paidAt: p.paidAt,
      ref: p.ref,
      lineCount,
    };
  }

  /** Para etkileyen payout kararlari audit log'a yazilir (sales.service.ts kalibi, tx icinde). */
  private async audit(
    tx: Tx,
    actor: ActorContext,
    action: string,
    entityId: string,
    before: object,
    after: object,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action,
        entity: 'payout',
        entityId,
        before,
        after,
      },
    });
  }
}
