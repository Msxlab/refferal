import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerStatus, LedgerType, MembershipStatus, Prisma, Sale, SaleStatus } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { sha256 } from '../common/crypto';
import { EngineService } from '../engine/engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import {
  BULK_PREVIEW_DOMAIN,
  BULK_PREVIEW_TTL_MS,
  BulkPreviewTokenPayload,
  NormalizedBulkFilters,
  NormalizedBulkScope,
  bulkScopeFingerprint,
  bulkSelectionFingerprint,
  normalizeBulkScope,
  signBulkPreviewToken,
  verifyBulkPreviewToken,
} from './bulk-scope';
import { parseCsv } from './csv';
import {
  BulkAction,
  BulkPreview,
  ConfirmBulkInput,
  CreateSaleInput,
  ImportMapping,
  ListSalesInput,
  PreviewBulkInput,
} from './sales.types';

function isCentsColumn(headerName: string | undefined): boolean {
  const normalized = (headerName ?? '').trim().toLowerCase();
  return normalized === 'amount_cents' || normalized === 'cents' || normalized.endsWith('_cents');
}

const MAX_SAFE_CENTS_TEXT = String(Number.MAX_SAFE_INTEGER);

function parsePositiveSafeCents(value: string, error: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(error);
  const normalized = value.replace(/^0+/, '') || '0';
  if (
    normalized === '0' ||
    normalized.length > MAX_SAFE_CENTS_TEXT.length ||
    (normalized.length === MAX_SAFE_CENTS_TEXT.length && normalized > MAX_SAFE_CENTS_TEXT)
  ) {
    throw new Error(error);
  }
  return BigInt(normalized);
}

function parseMoneyAmountToCents(raw: string | undefined, assumeCents: boolean): bigint {
  const value = (raw ?? '').trim();
  if (!value) throw new Error('amount is blank');

  if (assumeCents) {
    return parsePositiveSafeCents(value, `invalid amount_cents: ${value}`);
  }

  const normalized = value.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`invalid amount: ${value}`);
  }
  const [dollars, cents = ''] = normalized.split('.');
  return parsePositiveSafeCents(`${dollars}${cents.padEnd(2, '0')}`, `invalid amount: ${value}`);
}

function normalizeExternalRef(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function compareLexically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type SaleFilterInput = {
  status?: 'draft' | 'approved' | 'void';
  q?: string;
  from?: Date | string;
  to?: Date | string;
  minCents?: number;
  maxCents?: number;
};

/** One tenant-bound filter builder keeps list and all-results bulk semantics aligned. */
function saleWhereFromFilters(tenantId: string, filters: SaleFilterInput): Prisma.SaleWhereInput {
  const where: Prisma.SaleWhereInput = { tenantId, status: filters.status };
  if (filters.from || filters.to) {
    where.saleDate = {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(filters.to) } : {}),
    };
  }
  if (filters.minCents !== undefined || filters.maxCents !== undefined) {
    where.amountCents = {
      ...(filters.minCents !== undefined ? { gte: BigInt(filters.minCents) } : {}),
      ...(filters.maxCents !== undefined ? { lte: BigInt(filters.maxCents) } : {}),
    };
  }
  const term = filters.q?.trim();
  if (term) {
    where.OR = [
      { customerRef: { contains: term, mode: 'insensitive' } },
      { externalRef: { contains: term, mode: 'insensitive' } },
      { seller: { referralCode: { contains: term, mode: 'insensitive' } } },
      { seller: { user: { fullName: { contains: term, mode: 'insensitive' } } } },
    ];
  }
  return where;
}

const bulkReviewSaleSelect = {
  id: true,
  sellerMembershipId: true,
  amountCents: true,
  currency: true,
  saleDate: true,
  summaryMonth: true,
  status: true,
  createdBy: true,
  approvedAt: true,
  deliveredAt: true,
  ledger: {
    where: { type: LedgerType.commission },
    select: {
      id: true,
      beneficiaryMembershipId: true,
      level: true,
      rateBpsUsed: true,
      amountCents: true,
      status: true,
    },
  },
} satisfies Prisma.SaleSelect;

type BulkReviewSale = Prisma.SaleGetPayload<{ select: typeof bulkReviewSaleSelect }>;

interface BulkReview {
  eligibleIds: string[];
  excludedIds: string[];
  eligibleCount: number;
  excludedCount: number;
  totals: Array<{ currency: string; amountCents: bigint }>;
  selectionFingerprint: string;
}

const BULK_EXECUTION_DOMAIN = 'sales-bulk-execution:v1' as const;
const BULK_IDEMPOTENCY_KEY_DOMAIN = 'bulk-action-idempotency-key:v1' as const;
const BULK_NOT_ELIGIBLE_MESSAGE = 'sale was excluded by the reviewed eligibility rules' as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface BulkExecutionResponse {
  action: BulkAction;
  succeeded: number;
  succeededIds: string[];
  failed: Array<{
    id: string;
    code: 'not_eligible';
    message: typeof BULK_NOT_ELIGIBLE_MESSAGE;
  }>;
  retryScope?: { mode: 'selected'; ids: string[] };
}

interface BulkExecutionRow {
  id: string;
  requestHash: string;
  status: string;
  response: unknown;
}

function hasExactObjectKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function isSortedUniqueUuidList(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  let previous = '';
  for (const item of value) {
    if (typeof item !== 'string' || !UUID.test(item) || item <= previous) return false;
    previous = item;
  }
  return true;
}

/** A persisted response is untrusted recovery state; malformed or review-inconsistent JSON must never replay. */
function validatedBulkExecutionResponse(
  value: unknown,
  token: BulkPreviewTokenPayload,
  scope: NormalizedBulkScope,
): BulkExecutionResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  const failed = response.failed;
  if (!Array.isArray(failed)) return null;
  const expectedKeys = failed.length > 0
    ? ['action', 'succeeded', 'succeededIds', 'failed', 'retryScope']
    : ['action', 'succeeded', 'succeededIds', 'failed'];
  if (
    !hasExactObjectKeys(response, expectedKeys) ||
    response.action !== token.action ||
    !Number.isSafeInteger(response.succeeded) ||
    (response.succeeded as number) < 0 ||
    !isSortedUniqueUuidList(response.succeededIds)
  ) {
    return null;
  }
  const succeededIds = response.succeededIds;
  if (response.succeeded !== succeededIds.length || succeededIds.length !== token.eligibleCount) return null;

  const failedIds: string[] = [];
  for (const item of failed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const failure = item as Record<string, unknown>;
    if (
      !hasExactObjectKeys(failure, ['id', 'code', 'message']) ||
      typeof failure.id !== 'string' ||
      !UUID.test(failure.id) ||
      failure.id <= (failedIds.at(-1) ?? '') ||
      failure.code !== 'not_eligible' ||
      failure.message !== BULK_NOT_ELIGIBLE_MESSAGE
    ) {
      return null;
    }
    failedIds.push(failure.id);
  }
  if (
    failedIds.length !== token.excludedCount ||
    failedIds.some((id) => succeededIds.includes(id))
  ) {
    return null;
  }
  if (
    scope.mode === 'selected' &&
    JSON.stringify([...succeededIds, ...failedIds].sort(compareLexically)) !== JSON.stringify(scope.ids)
  ) {
    return null;
  }

  if (failedIds.length > 0) {
    const retryScope = response.retryScope;
    if (
      !retryScope ||
      typeof retryScope !== 'object' ||
      Array.isArray(retryScope) ||
      !hasExactObjectKeys(retryScope as Record<string, unknown>, ['mode', 'ids']) ||
      (retryScope as Record<string, unknown>).mode !== 'selected' ||
      !isSortedUniqueUuidList((retryScope as Record<string, unknown>).ids) ||
      JSON.stringify((retryScope as Record<string, unknown>).ids) !== JSON.stringify(failedIds)
    ) {
      return null;
    }
  }

  try {
    if (JSON.stringify(JSON.parse(JSON.stringify(value))) !== JSON.stringify(value)) return null;
  } catch {
    return null;
  }
  return value as BulkExecutionResponse;
}

class BulkReviewDriftError extends Error {
  constructor(readonly review: BulkReview) {
    super('sales bulk selection changed after preview');
    this.name = 'BulkReviewDriftError';
  }
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Resolves the seller membership inside the tenant by id or referral code. */
  private async resolveSeller(tenantId: string, input: { sellerMembershipId?: string; sellerReferralCode?: string }) {
    const seller = await this.prisma.membership.findFirst({
      where: {
        tenantId,
        ...(input.sellerMembershipId
          ? { id: input.sellerMembershipId }
          : { referralCode: input.sellerReferralCode }),
      },
      select: { id: true, status: true },
    });
    if (!seller) {
      throw new NotFoundException('seller membership was not found in this business');
    }
    return seller;
  }

  async create(actor: ActorContext, input: CreateSaleInput) {
    this.tenantContext.assertActor(actor);
    const externalRef = normalizeExternalRef(input.externalRef);
    if (externalRef) {
      const existing = await this.findByExternalRef(actor.tenantId, externalRef);
      if (existing) return this.serialize(existing);
    }
    const seller = await this.resolveSeller(actor.tenantId, input);
    if (seller.status !== MembershipStatus.active) {
      throw new BadRequestException('sales cannot be created for inactive members');
    }
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: actor.tenantId },
      select: { currency: true },
    });
    const result = await this.createDraftSale(actor, {
      sellerMembershipId: seller.id,
      amountCents: BigInt(input.amountCents),
      currency: tenant.currency,
      saleDate: input.saleDate ?? new Date(),
      customerRef: input.customerRef,
      externalRef,
    });
    if (result.created) {
      await this.audit(actor, 'sale.create', result.sale.id, { amountCents: result.sale.amountCents.toString() });
    }
    return this.serialize(result.sale);
  }

  async list(actor: ActorContext, q: ListSalesInput) {
    this.tenantContext.assertActor(actor);
    const where = saleWhereFromFilters(actor.tenantId, q);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({
        where,
        orderBy: { saleDate: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { seller: { select: { referralCode: true, user: { select: { fullName: true } } } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((s) => ({
        ...this.serialize(s),
        sellerReferralCode: s.seller.referralCode,
        sellerName: s.seller.user.fullName,
      })),
    };
  }

  /** Verifies tenant ownership, then triggers the idempotent engine path. */
  async approve(actor: ActorContext, saleId: string) {
    this.tenantContext.assertActor(actor);
    await this.assertInTenant(actor.tenantId, saleId);
    return this.engine.approveSale(saleId, actor.userId);
  }

  async void(actor: ActorContext, saleId: string) {
    this.tenantContext.assertActor(actor);
    await this.assertInTenant(actor.tenantId, saleId);
    return this.engine.voidSale(saleId, actor.userId);
  }

  async deliver(actor: ActorContext, saleId: string, deliveredAt?: Date) {
    this.tenantContext.assertActor(actor);
    await this.assertInTenant(actor.tenantId, saleId);
    return this.engine.markDelivered(saleId, deliveredAt);
  }

  private async salesForBulkScope(
    db: Prisma.TransactionClient,
    tenantId: string,
    scope: NormalizedBulkScope,
  ): Promise<BulkReviewSale[]> {
    if (scope.mode === 'selected') {
      const rows = await db.sale.findMany({
        where: { tenantId, id: { in: scope.ids } },
        orderBy: { id: 'asc' },
        select: bulkReviewSaleSelect,
      });
      if (rows.length !== scope.ids.length) {
        throw new NotFoundException('sale was not found in this business');
      }
      return rows;
    }

    const filters: NormalizedBulkFilters = scope.filters;
    const rows = await db.sale.findMany({
      where: saleWhereFromFilters(tenantId, filters),
      orderBy: { id: 'asc' },
      take: 201,
      select: bulkReviewSaleSelect,
    });
    if (rows.length > 200) {
      throw new BadRequestException('sales bulk scope exceeds 200 results; narrow the filters');
    }
    return rows;
  }

  private async calculateBulkReview(
    db: Prisma.TransactionClient,
    actor: ActorContext,
    action: BulkAction,
    scope: NormalizedBulkScope,
  ): Promise<BulkReview> {
    const [tenant, rows] = await Promise.all([
      db.tenant.findUniqueOrThrow({
        where: { id: actor.tenantId },
        select: { requireSeparateApprover: true },
      }),
      this.salesForBulkScope(db, actor.tenantId, scope),
    ]);
    const eligibleIds: string[] = [];
    const excludedIds: string[] = [];
    const selectionMaterial: unknown[] = [];
    const totalsByCurrency = new Map<string, bigint>();

    for (const sale of rows) {
      if (!/^[A-Z]{3}$/.test(sale.currency)) {
        throw new BadRequestException('a sale in this scope has an invalid currency');
      }
      if (sale.amountCents <= 0n) {
        throw new BadRequestException('a sale in this scope has an invalid amount');
      }

      let eligible = false;
      let approvalInputs: Awaited<ReturnType<EngineService['reviewSaleApprovalInputs']>> = null;
      if (action === 'approve') {
        const makerCheckerExcluded = tenant.requireSeparateApprover && sale.createdBy === actor.userId;
        if (sale.status === SaleStatus.draft && !makerCheckerExcluded) {
          approvalInputs = await this.engine.reviewSaleApprovalInputs(db, {
            tenantId: actor.tenantId,
            sellerMembershipId: sale.sellerMembershipId,
            amountCents: sale.amountCents,
            saleDate: sale.saleDate,
          });
          eligible = approvalInputs !== null;
        }
      } else {
        const hasProcessingCommission = sale.ledger.some((entry) => entry.status === LedgerStatus.processing);
        eligible =
          (sale.status === SaleStatus.draft || sale.status === SaleStatus.approved) &&
          !hasProcessingCommission;
      }

      selectionMaterial.push({
        id: sale.id,
        decision: eligible ? 'eligible' : 'not_eligible',
        status: sale.status,
        amountCents: sale.amountCents.toString(),
        currency: sale.currency,
        sellerMembershipId: sale.sellerMembershipId,
        saleDate: sale.saleDate.toISOString(),
        summaryMonth: sale.summaryMonth,
        createdBy: sale.createdBy,
        approvedAt: sale.approvedAt?.toISOString() ?? null,
        deliveredAt: sale.deliveredAt?.toISOString() ?? null,
        commissionLedger: [...sale.ledger]
          .sort((left, right) => compareLexically(left.id, right.id))
          .map((entry) => ({
            id: entry.id,
            beneficiaryMembershipId: entry.beneficiaryMembershipId,
            level: entry.level,
            rateBpsUsed: entry.rateBpsUsed,
            amountCents: entry.amountCents.toString(),
            status: entry.status,
          })),
        ...(action === 'approve' ? { approvalInputs } : {}),
      });
      if (eligible) {
        eligibleIds.push(sale.id);
        totalsByCurrency.set(sale.currency, (totalsByCurrency.get(sale.currency) ?? 0n) + sale.amountCents);
      } else {
        excludedIds.push(sale.id);
      }
    }

    eligibleIds.sort();
    excludedIds.sort();
    const totals = [...totalsByCurrency.entries()]
      .sort(([left], [right]) => compareLexically(left, right))
      .map(([currency, amountCents]) => ({ currency, amountCents }));
    return {
      eligibleIds,
      excludedIds,
      eligibleCount: eligibleIds.length,
      excludedCount: rows.length - eligibleIds.length,
      totals,
      selectionFingerprint: bulkSelectionFingerprint({
        action,
        requireSeparateApprover: tenant.requireSeparateApprover,
        sales: selectionMaterial,
      }),
    };
  }

  private previewFromBulkReview(
    actor: ActorContext,
    action: BulkAction,
    scope: NormalizedBulkScope,
    review: BulkReview,
  ): BulkPreview {
    const expiresAt = new Date(Date.now() + BULK_PREVIEW_TTL_MS).toISOString();
    const totals = review.totals.map((total) => ({
      currency: total.currency,
      amountCents: total.amountCents.toString(),
    }));
    const payload: BulkPreviewTokenPayload = {
      domain: BULK_PREVIEW_DOMAIN,
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      action,
      scopeFingerprint: bulkScopeFingerprint(scope),
      eligibleCount: review.eligibleCount,
      excludedCount: review.excludedCount,
      totals,
      selectionFingerprint: review.selectionFingerprint,
      expiresAt,
    };
    return {
      previewToken: signBulkPreviewToken(payload),
      expiresAt,
      action,
      eligibleCount: review.eligibleCount,
      excludedCount: review.excludedCount,
      totals,
    };
  }

  private async calculateBulkPreview(
    actor: ActorContext,
    action: BulkAction,
    scope: NormalizedBulkScope,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<BulkPreview> {
    const review = await this.calculateBulkReview(db, actor, action, scope);
    return this.previewFromBulkReview(actor, action, scope, review);
  }

  private bulkReviewMatchesToken(review: BulkReview, token: BulkPreviewTokenPayload): boolean {
    return (
      review.eligibleCount === token.eligibleCount &&
      review.excludedCount === token.excludedCount &&
      review.selectionFingerprint === token.selectionFingerprint &&
      JSON.stringify(review.totals.map((total) => ({
        currency: total.currency,
        amountCents: total.amountCents.toString(),
      }))) === JSON.stringify(token.totals)
    );
  }

  private bulkIdempotencyKeyHash(idempotencyKey: string): string {
    return sha256(JSON.stringify({ domain: BULK_IDEMPOTENCY_KEY_DOMAIN, key: idempotencyKey }));
  }

  private bulkExecutionRequestHash(
    actor: ActorContext,
    action: BulkAction,
    scope: NormalizedBulkScope,
    previewToken: string,
  ): string {
    return sha256(JSON.stringify({
      domain: BULK_EXECUTION_DOMAIN,
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      action,
      scope,
      previewTokenDigest: sha256(previewToken),
    }));
  }

  private idempotencyConflict(): never {
    throw new ConflictException({
      message: 'idempotency_key_conflict',
      code: 'idempotency_key_conflict',
    });
  }

  private executionRecoveryRequired(): never {
    throw new ConflictException({
      message: 'execution_recovery_required',
      code: 'execution_recovery_required',
    });
  }

  private async beginBulkExecution(
    db: Prisma.TransactionClient,
    actor: ActorContext,
    token: BulkPreviewTokenPayload,
    scope: NormalizedBulkScope,
    idempotencyKeyHash: string,
    requestHash: string,
  ): Promise<{ id: string; replay?: BulkExecutionResponse }> {
    const inserted = await db.$executeRaw`
      INSERT INTO bulk_action_executions (
        tenant_id,
        actor_user_id,
        idempotency_key_hash,
        request_hash,
        status,
        updated_at
      )
      VALUES (
        ${actor.tenantId}::uuid,
        ${actor.userId}::uuid,
        ${idempotencyKeyHash},
        ${requestHash},
        'processing',
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (tenant_id, actor_user_id, idempotency_key_hash) DO NOTHING`;
    const rows = await db.$queryRaw<BulkExecutionRow[]>`
      SELECT id,
             request_hash AS "requestHash",
             status,
             response
      FROM bulk_action_executions
      WHERE tenant_id = ${actor.tenantId}::uuid
        AND actor_user_id = ${actor.userId}::uuid
        AND idempotency_key_hash = ${idempotencyKeyHash}
      FOR UPDATE`;
    if (rows.length !== 1) this.executionRecoveryRequired();
    const execution = rows[0];
    if (execution.requestHash !== requestHash) this.idempotencyConflict();
    if (execution.status === 'completed') {
      const replay = validatedBulkExecutionResponse(execution.response, token, scope);
      if (!replay) this.executionRecoveryRequired();
      return { id: execution.id, replay };
    }
    if (execution.status !== 'processing' || execution.response !== null || inserted !== 1) {
      this.executionRecoveryRequired();
    }
    return { id: execution.id };
  }

  private async completeBulkExecution(
    db: Prisma.TransactionClient,
    executionId: string,
    response: BulkExecutionResponse,
  ): Promise<void> {
    const json = JSON.stringify(response);
    const updated = await db.$executeRaw`
      UPDATE bulk_action_executions
      SET status = 'completed',
          response = ${json}::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${executionId}::uuid
        AND status = 'processing'
        AND response IS NULL`;
    if (updated !== 1) this.executionRecoveryRequired();
  }

  async previewBulk(actor: ActorContext, input: PreviewBulkInput): Promise<BulkPreview> {
    this.tenantContext.assertActor(actor);
    const normalizedScope = normalizeBulkScope(input.scope);
    return this.calculateBulkPreview(actor, input.action, normalizedScope);
  }

  /** Reads the signed action without the TTL gate so completed replays still receive the live permission check. */
  reviewedBulkAction(actor: ActorContext, previewToken: string): BulkAction {
    this.tenantContext.assertActor(actor);
    return verifyBulkPreviewToken(previewToken, actor, Number.NEGATIVE_INFINITY).action;
  }

  /** Durable replay and all financial effects share one serializable, all-or-nothing transaction. */
  async bulk(actor: ActorContext, input: ConfirmBulkInput, idempotencyKey: string) {
    this.tenantContext.assertActor(actor);
    if (!/^[\x21-\x7e]{16,200}$/.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must be 16-200 printable characters');
    }
    const token = verifyBulkPreviewToken(input.previewToken, actor, Number.NEGATIVE_INFINITY);
    const normalizedScope = normalizeBulkScope(input.scope);
    const idempotencyKeyHash = this.bulkIdempotencyKeyHash(idempotencyKey);
    const requestHash = this.bulkExecutionRequestHash(actor, token.action, normalizedScope, input.previewToken);

    try {
      return await this.engine.runSaleMutationTransaction(actor.tenantId, async (capability) => {
        const execution = await this.beginBulkExecution(
          capability.db,
          actor,
          token,
          normalizedScope,
          idempotencyKeyHash,
          requestHash,
        );
        if (execution.replay) return execution.replay;

        // A first execution must still use an unexpired review. Any failure rolls the processing row back.
        verifyBulkPreviewToken(input.previewToken, actor);
        if (token.scopeFingerprint !== bulkScopeFingerprint(normalizedScope)) {
          const review = await this.calculateBulkReview(capability.db, actor, token.action, normalizedScope);
          throw new BulkReviewDriftError(review);
        }
        const review = await this.calculateBulkReview(capability.db, actor, token.action, normalizedScope);
        if (!this.bulkReviewMatchesToken(review, token)) {
          throw new BulkReviewDriftError(review);
        }
        const lockedIds = await capability.lockSales(review.eligibleIds);
        if (
          lockedIds.length !== review.eligibleIds.length ||
          lockedIds.some((id, index) => id !== review.eligibleIds[index])
        ) {
          throw new BulkReviewDriftError(review);
        }

        const succeededIds: string[] = [];
        for (const saleId of review.eligibleIds) {
          if (token.action === 'approve') {
            await capability.approveSale(saleId, actor.userId);
          } else {
            await capability.voidSale(saleId, actor.userId);
          }
          succeededIds.push(saleId);
        }
        const failed: BulkExecutionResponse['failed'] = review.excludedIds.map((id) => ({
          id,
          code: 'not_eligible',
          message: BULK_NOT_ELIGIBLE_MESSAGE,
        }));
        const response: BulkExecutionResponse = {
          action: token.action,
          succeeded: succeededIds.length,
          succeededIds,
          failed,
          ...(failed.length > 0 ? { retryScope: { mode: 'selected' as const, ids: review.excludedIds } } : {}),
        };
        await this.completeBulkExecution(capability.db, execution.id, response);
        return response;
      });
    } catch (error) {
      if (!(error instanceof BulkReviewDriftError)) throw error;
      const preview = this.previewFromBulkReview(actor, token.action, normalizedScope, error.review);
      throw new ConflictException({ message: 'review_required', code: 'review_required', preview });
    }
  }

  /** Sale detail drawer: seller and commission breakdown for this sale. */
  async detail(actor: ActorContext, saleId: string) {
    this.tenantContext.assertActor(actor);
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, tenantId: actor.tenantId },
      include: {
        seller: { select: { referralCode: true, user: { select: { fullName: true, email: true } } } },
        ledger: {
          orderBy: [{ level: 'asc' }],
          include: { beneficiary: { select: { referralCode: true, user: { select: { fullName: true } } } } },
        },
      },
    });
    if (!sale) throw new NotFoundException('sale was not found in this business');
    return {
      ...this.serialize(sale),
      sellerReferralCode: sale.seller.referralCode,
      sellerName: sale.seller.user.fullName,
      sellerEmail: sale.seller.user.email,
      createdAt: sale.createdAt,
      approvedBy: sale.approvedBy,
      ledger: sale.ledger.map((e) => ({
        id: e.id,
        level: e.level,
        type: e.type,
        status: e.status,
        rateBpsUsed: e.rateBpsUsed,
        amountCents: e.amountCents.toString(),
        beneficiaryName: e.beneficiary.user.fullName,
        beneficiaryCode: e.beneficiary.referralCode,
        maturesAt: e.maturesAt,
      })),
    };
  }

  /**
   * CSV import wizard -> draft sales. Mapping chooses which headers to read.
   * Defaults to referral_code, amount_cents, sale_date, customer_ref, external_ref when mapping is omitted.
   * When preview=true, writes nothing and returns validation plus resolved seller data for each row.
   */
  async importCsv(actor: ActorContext, csv: string, mapping?: ImportMapping, preview = false) {
    this.tenantContext.assertActor(actor);
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      throw new BadRequestException('CSV is empty or only contains headers');
    }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name?: string, fallbacks: string[] = []): number => {
      const candidates = [name, ...fallbacks]
        .map((candidate) => (candidate ?? '').trim().toLowerCase())
        .filter(Boolean);
      for (const target of candidates) {
        const found = header.indexOf(target);
        if (found >= 0) return found;
      }
      return -1;
    };
    const idx = {
      code: col(mapping?.code, ['referral_code', 'code', 'seller']),
      amount: col(mapping?.amount, ['amount', 'amount_cents', 'cents']),
      date: col(mapping?.date, ['sale_date']),
      customer: col(mapping?.customer, ['customer_ref']),
      external: col(mapping?.external, ['external_ref']),
    };
    if (idx.code < 0 || idx.amount < 0) {
      throw new BadRequestException('Invalid mapping: referral_code and amount columns were not found');
    }
    const amountIsCents = isCentsColumn(header[idx.amount]);

    const created: string[] = [];
    const skipped: Array<{ line: number; reason: string; saleId?: string }> = [];
    const errors: Array<{ line: number; reason: string }> = [];
    const previewRows: Array<{
      line: number; ok: boolean; code: string; amountCents?: string; saleDate?: string;
      customerRef?: string; sellerName?: string; reason?: string;
    }> = [];
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: actor.tenantId },
      select: { currency: true },
    });

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (cells.length === 1 && !cells[0]?.trim()) continue; // blank row
      const code = cells[idx.code]?.trim() ?? '';
      const amountRaw = cells[idx.amount]?.trim();
      try {
        if (!code) throw new Error('referral_code is blank');
        const amountCents = parseMoneyAmountToCents(amountRaw, amountIsCents);

        const seller = await this.resolveSeller(actor.tenantId, { sellerReferralCode: code });
        if (seller.status !== MembershipStatus.active) throw new Error('inactive member');
        const sellerInfo = await this.prisma.membership.findUnique({
          where: { id: seller.id },
          select: { user: { select: { fullName: true } } },
        });

        const saleDate = idx.date >= 0 && cells[idx.date]?.trim() ? new Date(cells[idx.date].trim()) : new Date();
        if (Number.isNaN(saleDate.getTime())) throw new Error('invalid sale_date');
        const customerRef = idx.customer >= 0 ? cells[idx.customer]?.trim() || undefined : undefined;
        const externalRef = normalizeExternalRef(idx.external >= 0 ? cells[idx.external] : undefined);
        const existing = externalRef ? await this.findByExternalRef(actor.tenantId, externalRef) : null;

        if (preview) {
          previewRows.push({
            line: r + 1, ok: true, code, amountCents: amountCents.toString(),
            saleDate: saleDate.toISOString(), customerRef, sellerName: sellerInfo?.user.fullName,
            reason: existing ? 'external_ref already exists' : undefined,
          });
          continue;
        }

        if (existing) {
          skipped.push({ line: r + 1, reason: 'external_ref already exists', saleId: existing.id });
          continue;
        }

        const result = await this.createDraftSale(actor, {
          sellerMembershipId: seller.id,
          amountCents,
          currency: tenant.currency,
          saleDate,
          customerRef,
          externalRef,
        });
        if (!result.created) {
          skipped.push({ line: r + 1, reason: 'external_ref already exists', saleId: result.sale.id });
          continue;
        }
        created.push(result.sale.id);
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'unknown error';
        errors.push({ line: r + 1, reason });
        if (preview) previewRows.push({ line: r + 1, ok: false, code, reason });
      }
    }

    if (preview) {
      return {
        preview: true as const,
        currency: tenant.currency,
        okCount: previewRows.filter((p) => p.ok).length,
        errorCount: previewRows.filter((p) => !p.ok).length,
        rows: previewRows,
      };
    }

    await this.audit(actor, 'sale.import', undefined, { created: created.length, skipped: skipped.length, errors: errors.length });
    return { created: created.length, skipped, errors };
  }

  private async findByExternalRef(tenantId: string, externalRef: string) {
    return this.prisma.sale.findUnique({ where: { tenantId_externalRef: { tenantId, externalRef } } });
  }

  private async createDraftSale(
    actor: ActorContext,
    input: {
      sellerMembershipId: string;
      amountCents: bigint;
      currency: string;
      saleDate: Date;
      customerRef?: string;
      externalRef?: string;
    },
  ): Promise<{ sale: Sale; created: boolean }> {
    const externalRef = normalizeExternalRef(input.externalRef);
    try {
      const sale = await this.prisma.sale.create({
        data: {
          tenantId: actor.tenantId,
          sellerMembershipId: input.sellerMembershipId,
          amountCents: input.amountCents,
          currency: input.currency,
          saleDate: input.saleDate,
          customerRef: input.customerRef,
          externalRef,
          createdBy: actor.userId,
          status: SaleStatus.draft,
        },
      });
      return { sale, created: true };
    } catch (e) {
      if (externalRef && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.findByExternalRef(actor.tenantId, externalRef);
        if (existing) return { sale: existing, created: false };
      }
      throw e;
    }
  }

  private async assertInTenant(tenantId: string, saleId: string): Promise<void> {
    const sale = await this.prisma.sale.findFirst({ where: { id: saleId, tenantId }, select: { id: true } });
    if (!sale) {
      throw new NotFoundException('sale was not found in this business');
    }
  }

  private serialize(s: {
    id: string;
    sellerMembershipId: string;
    amountCents: bigint;
    currency: string;
    saleDate: Date;
    status: SaleStatus;
    customerRef: string | null;
    externalRef: string | null;
    approvedAt: Date | null;
    deliveredAt: Date | null;
  }) {
    return {
      id: s.id,
      sellerMembershipId: s.sellerMembershipId,
      amountCents: s.amountCents.toString(),
      currency: s.currency,
      saleDate: s.saleDate,
      status: s.status,
      customerRef: s.customerRef,
      externalRef: s.externalRef,
      approvedAt: s.approvedAt,
      deliveredAt: s.deliveredAt,
    };
  }

  private async audit(actor: ActorContext, action: string, entityId: string | undefined, after: object): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action,
        entity: 'sale',
        entityId: entityId ?? null,
        after,
      },
    });
  }
}
