import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  LedgerStatus,
  LedgerType,
  MembershipStatus,
  MaturationRule,
  NotificationChannel,
  PayoutSettlementBatchStatus,
  PayoutMethod,
  PayoutStatus,
  Prisma,
  SaleStatus,
  Tenant,
} from '@prisma/client';
import { bpsAmount, computeCommissionLines, PlanLevelRate } from '@refearn/shared';
import { sha256 } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  PayoutComplianceService,
  PayoutComplianceSnapshot,
} from '../payouts/payout-compliance.service';
import { evaluatePayoutReadiness } from '../payouts/payout-readiness';
import { RanksService } from '../ranks/ranks.service';
import { monthKey } from './month';

type Tx = Prisma.TransactionClient;

interface LockedSale {
  id: string;
  tenantId: string;
  sellerMembershipId: string;
  amountCents: bigint;
  currency: string;
  status: SaleStatus;
  saleDate: Date;
  summaryMonth: string | null;
  commissionPlanId: string | null;
  createdBy: string | null;
  approvedAt: Date | null;
  deliveredAt: Date | null;
}

/** Locked ledger row for voiding, with fresh status after FOR UPDATE. */
interface LockedLedgerRow {
  id: string;
  beneficiaryMembershipId: string;
  level: number;
  rateBpsUsed: number;
  amountCents: bigint;
  status: LedgerStatus;
}

interface SummaryDelta {
  pending?: bigint;
  payable?: bigint;
  processing?: bigint;
  paid?: bigint;
}

interface PayoutLedgerRow {
  id: string;
  membershipId: string;
  level: number;
  amountCents: bigint;
  month: string;
}

interface PayoutReservation {
  membershipId: string;
  requestedPayoutId: string | null;
  amountCents: bigint;
  rows: PayoutLedgerRow[];
  complianceSnapshot: PayoutComplianceSnapshot;
  recipient: {
    referralCode: string;
    fullName: string;
    email: string;
  };
}

export type PayoutBatchSelectionScope =
  | { mode: 'selected'; membershipIds: string[] }
  | { mode: 'all_eligible' };

export interface PayoutBatchReview {
  eligibleCount: number;
  excludedCount: number;
  totals: Array<{ currency: string; amountCents: bigint }>;
  selectionFingerprint: string;
}

export class PayoutBatchReviewDriftError extends Error {
  constructor(readonly review: PayoutBatchReview) {
    super('payout batch selection changed after preview');
    this.name = 'PayoutBatchReviewDriftError';
  }
}

export function payoutActiveKey(tenantId: string, membershipId: string, period: string): string {
  return `${tenantId}:${membershipId}:${period}`;
}

export interface ApplyResult {
  applied: boolean;
  reason?: 'not_approved' | 'already_applied';
  entryCount: number;
}

export interface VoidSaleResult {
  voided: boolean;
  reversalCount: number;
}

export interface SaleMutationTransaction {
  readonly db: Prisma.TransactionClient;
  lockSales(saleIds: readonly string[]): Promise<readonly string[]>;
  approveSale(saleId: string, actorUserId?: string): Promise<ApplyResult>;
  voidSale(saleId: string, actorUserId?: string): Promise<VoidSaleResult>;
}

export const COMMISSION_PLAN_ORDER_BY: Prisma.CommissionPlanOrderByWithRelationInput[] = [
  { effectiveFrom: 'desc' },
  { createdAt: 'desc' },
  { id: 'desc' },
];

interface ResolvedCommissionPlan {
  id: string;
  poolRateBps: number;
  depth: number;
  effectiveFrom: Date;
  levels: Array<PlanLevelRate & { id: string }>;
}

interface ResolvedCommissionInputs {
  tenant: Tenant;
  plan: ResolvedCommissionPlan;
  chain: string[];
  lines: ReturnType<typeof computeCommissionLines>;
}

const TX_OPTS: { timeout: number; maxWait: number } = { timeout: 20_000, maxWait: 15_000 };

// Concurrent summary upserts can deadlock (40P01) when lock order differs.
// PostgreSQL serialization failures (40001) and Prisma write conflicts (P2034)
// are also transient and safe to retry.
const RETRYABLE_PG_CODES = new Set(['40P01', '40001', 'P2034']);
const MAX_TX_RETRIES = 5;

function isRetryable(err: unknown): boolean {
  const candidate = err as { code?: unknown; meta?: { code?: unknown } };
  return [candidate.code, candidate.meta?.code].some(
    (code) => typeof code === 'string' && RETRYABLE_PG_CODES.has(code),
  );
}

async function withTxRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
    }
  }
  throw lastErr;
}

/**
 * Commission engine (SPEC 7). Every money-impacting change happens in one Postgres transaction:
 * ledger, monthly_summaries, outbox, and audit commit together.
 */
@Injectable()
export class EngineService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly compliance?: PayoutComplianceService,
    @Optional() private readonly ranks?: RanksService,
  ) {}

  /** Shared wrapper for engine mutations: one transaction plus deadlock retry. */
  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTxRetry(() => this.prisma.$transaction(fn, TX_OPTS));
  }

  /**
   * Runs a tenant-bound set of sale mutations against one serializable snapshot.
   * The callback receives the active transaction client and must not open a nested transaction.
   */
  async runSaleMutationTransaction<T>(
    tenantId: string,
    work: (transaction: SaleMutationTransaction) => Promise<T>,
  ): Promise<T> {
    return withTxRetry(() =>
      this.prisma.$transaction(
        async (db) =>
          work({
            db,
            lockSales: (saleIds) => this.lockSalesForTenant(db, tenantId, saleIds),
            approveSale: (saleId, actorUserId) => this.approveSaleInTx(db, saleId, actorUserId, tenantId),
            voidSale: (saleId, actorUserId) => this.voidSaleInTx(db, saleId, actorUserId, tenantId),
          }),
        { ...TX_OPTS, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  /**
   * Returns the exact money-impacting inputs the engine would consume for a draft approval.
   * Bulk review signs this material so plan, tenant policy, and beneficiary drift requires review again.
   */
  async reviewSaleApprovalInputs(
    tx: Prisma.TransactionClient,
    sale: Pick<LockedSale, 'tenantId' | 'sellerMembershipId' | 'amountCents' | 'saleDate'>,
  ) {
    const inputs = await this.resolveCommissionInputsOrNull(tx, sale);
    if (!inputs) return null;
    return {
      tenant: {
        requireSeparateApprover: inputs.tenant.requireSeparateApprover,
        compressionEnabled: inputs.tenant.compressionEnabled,
        inactiveMembersEarn: inputs.tenant.inactiveMembersEarn,
        maturationRule: inputs.tenant.maturationRule,
        maturationDays: inputs.tenant.maturationDays,
        timezone: inputs.tenant.timezone,
      },
      plan: {
        id: inputs.plan.id,
        poolRateBps: inputs.plan.poolRateBps,
        depth: inputs.plan.depth,
        effectiveFrom: inputs.plan.effectiveFrom.toISOString(),
        levels: inputs.plan.levels.map((level) => ({
          id: level.id,
          level: level.level,
          rateBps: level.rateBps,
        })),
      },
      chain: inputs.chain,
      commissionLines: inputs.lines.map((line) => ({
        level: line.level,
        beneficiaryMembershipId: line.beneficiaryMembershipId,
        rateBpsUsed: line.rateBpsUsed,
        amountCents: line.amountCents.toString(),
      })),
    };
  }

  /** Approves a sale and distributes commissions in the same transaction. */
  async approveSale(saleId: string, actorUserId?: string): Promise<ApplyResult> {
    return this.tx((tx) => this.approveSaleInTx(tx, saleId, actorUserId));
  }

  private async approveSaleInTx(
    tx: Tx,
    saleId: string,
    actorUserId?: string,
    expectedTenantId?: string,
  ): Promise<ApplyResult> {
    const sale = await this.lockSale(tx, saleId, expectedTenantId);
    if (sale.status === SaleStatus.void) {
      throw new ConflictException('voided sales cannot be approved');
    }
    if (sale.status === SaleStatus.draft) {
      // Separation of duties (maker-checker): the creator cannot approve the sale.
      const selfApproval = !!actorUserId && !!sale.createdBy && sale.createdBy === actorUserId;
      if (selfApproval) {
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: sale.tenantId } });
        if (tenant.requireSeparateApprover) {
          throw new ForbiddenException('the sale creator cannot approve the sale (separation of duties)');
        }
        // When the setting is off, allow the action but still record a security signal.
        await this.audit(tx, sale.tenantId, actorUserId, 'security.self_approved_sale', saleId, {}, {
          createdBy: sale.createdBy,
        });
      }
      const approvedAt = new Date();
      await tx.sale.update({
        where: { id: saleId },
        data: { status: SaleStatus.approved, approvedAt, approvedBy: actorUserId ?? null },
      });
      sale.status = SaleStatus.approved;
      sale.approvedAt = approvedAt;
      await this.audit(tx, sale.tenantId, actorUserId, 'sale.approve', saleId, { status: 'draft' }, { status: 'approved' });
    }
    return this.applyCommissionsInTx(tx, sale);
  }

  /** Idempotent: repeated calls for the same sale produce the same result (T4/T10). */
  async applyCommissions(saleId: string): Promise<ApplyResult> {
    return this.tx(async (tx) => {
      const sale = await this.lockSale(tx, saleId);
      return this.applyCommissionsInTx(tx, sale);
    });
  }

  /**
   * Voids a sale and creates an equal-and-opposite reversal for every existing commission row (T5).
   * Accounting rules live in docs/DECISIONS.md under reversal accounting.
   */
  async voidSale(saleId: string, actorUserId?: string): Promise<VoidSaleResult> {
    return this.tx((tx) => this.voidSaleInTx(tx, saleId, actorUserId));
  }

  private async voidSaleInTx(
    tx: Tx,
    saleId: string,
    actorUserId?: string,
    expectedTenantId?: string,
  ): Promise<VoidSaleResult> {
    const sale = await this.lockSale(tx, saleId, expectedTenantId);
    if (sale.status === SaleStatus.void) {
      return { voided: false, reversalCount: 0 };
    }
    const before = sale.status;

    // FOR UPDATE waits if matureCommissions has locked these rows, then reads the fresh committed status.
    // Without that, voiding could read stale pending rows and write ghost payable deltas.
    // matureCommissions uses SKIP LOCKED, so locked rows are skipped rather than deadlocking.
    const entries = await tx.$queryRaw<LockedLedgerRow[]>`
      SELECT id,
             beneficiary_membership_id AS "beneficiaryMembershipId",
             level,
             rate_bps_used             AS "rateBpsUsed",
             amount_cents              AS "amountCents",
             status
      FROM ledger_entries
      WHERE sale_id = ${saleId}::uuid
        AND type = 'commission'
        AND status IN ('pending', 'payable', 'processing', 'paid')
      ORDER BY level ASC
      FOR UPDATE`;
    if (entries.some((entry) => entry.status === LedgerStatus.processing)) {
      throw new ConflictException('a sale cannot be voided while a linked payout is processing');
    }
    await tx.sale.update({ where: { id: saleId }, data: { status: SaleStatus.void } });
    await this.audit(tx, sale.tenantId, actorUserId, 'sale.void', saleId, { status: before }, { status: 'void' });
    if (entries.length === 0) {
      return { voided: true, reversalCount: 0 };
    }

    const month = sale.summaryMonth ?? (await this.fallbackMonth(tx, sale));

    for (const entry of entries) {
      // A paid row's reversal stays payable as a clawback against future earnings.
      // Pending/payable originals and their reversals are closed together as reversed.
      const reversalStatus = entry.status === LedgerStatus.paid ? LedgerStatus.payable : LedgerStatus.reversed;

      await tx.ledgerEntry.create({
        data: {
          tenantId: sale.tenantId,
          saleId,
          beneficiaryMembershipId: entry.beneficiaryMembershipId,
          level: entry.level,
          rateBpsUsed: entry.rateBpsUsed,
          amountCents: -entry.amountCents,
          type: LedgerType.reversal,
          status: reversalStatus,
        },
      });

      if (entry.status !== LedgerStatus.paid) {
        await tx.ledgerEntry.update({ where: { id: entry.id }, data: { status: LedgerStatus.reversed } });
      }

      const delta: SummaryDelta =
        entry.status === LedgerStatus.pending
          ? { pending: -entry.amountCents }
          : { payable: -entry.amountCents }; // payable or paid clawback
      await this.bumpSummary(tx, sale.tenantId, entry.beneficiaryMembershipId, month, entry.level, delta);

      await tx.notification.create({
        data: {
          tenantId: sale.tenantId,
          recipientMembershipId: entry.beneficiaryMembershipId,
          channel: NotificationChannel.push,
          template: 'commission_reversed',
          payload: { saleId, level: entry.level, amountCents: (-entry.amountCents).toString(), currency: sale.currency },
        },
      });
    }

    return { voided: true, reversalCount: entries.length };
  }

  /** Marks delivery and fills matures_at for pending rows when the tenant uses on_delivery (T7). */
  async markDelivered(saleId: string, deliveredAt: Date = new Date()): Promise<{ delivered: boolean }> {
    return this.tx(async (tx) => {
      const sale = await this.lockSale(tx, saleId);
      if (sale.status !== SaleStatus.approved) {
        throw new ConflictException('only approved sales can be delivered');
      }
      if (sale.deliveredAt) {
        return { delivered: false };
      }
      await tx.sale.update({ where: { id: saleId }, data: { deliveredAt } });
      // teslime bagli olgunlasma: on_delivery → hemen; days_after_delivery → teslim + N gun
      // (iade penceresi). Diger kurallarda teslim-bekleyen pending satir yok (no-op).
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: sale.tenantId } });
      const maturesAt =
        tenant.maturationRule === MaturationRule.days_after_delivery
          ? new Date(deliveredAt.getTime() + (tenant.maturationDays ?? 0) * 86_400_000)
          : deliveredAt;
      await tx.ledgerEntry.updateMany({
        where: { saleId, type: LedgerType.commission, status: LedgerStatus.pending, maturesAt: null },
        data: { maturesAt },
      });
      return { delivered: true };
    });
  }

  /** Periodic job: converts pending rows with matures_at <= now into payable rows (SPEC 7). */
  async matureCommissions(
    now: Date = new Date(),
    limit = 100,
  ): Promise<{ matured: number; hasMore: boolean }> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new BadRequestException('maturation batch limit must be a positive integer');
    }
    return this.tx(async (tx) => {
      // Month key comes from the sale-level frozen summary_month value.
      // Historical rows with null summary_month fall back to sale_date plus tenant.timezone.
      const due = await tx.$queryRaw<
        Array<{
          id: string;
          tenantId: string;
          membershipId: string;
          level: number;
          amountCents: bigint;
          month: string;
        }>
      >`
        SELECT le.id,
               le.tenant_id                  AS "tenantId",
               le.beneficiary_membership_id  AS "membershipId",
               le.level,
               le.amount_cents               AS "amountCents",
               COALESCE(
                 s.summary_month,
                 to_char(s.sale_date AT TIME ZONE t.timezone, 'YYYY-MM')
               )                             AS "month"
        FROM ledger_entries le
        JOIN sales s   ON s.id = le.sale_id
        JOIN tenants t ON t.id = le.tenant_id
        WHERE le.type = 'commission'
          AND le.status = 'pending'
          AND le.matures_at IS NOT NULL
          AND le.matures_at <= ${now}
        ORDER BY le.created_at
        LIMIT ${limit + 1}
        FOR UPDATE OF le SKIP LOCKED`;

      const batch = due.slice(0, limit);
      for (const row of batch) {
        await tx.ledgerEntry.update({ where: { id: row.id }, data: { status: LedgerStatus.payable } });
        await this.bumpSummary(tx, row.tenantId, row.membershipId, row.month, row.level, {
          pending: -row.amountCents,
          payable: row.amountCents,
        });
      }
      return { matured: batch.length, hasMore: due.length > limit };
    });
  }

  /**
   * Reserves a bounded, immutable set of payable rows. This is deliberately not
   * settlement: ledger and summary amounts move only from payable to processing.
   */
  async previewPayoutBatch(params: {
    tenantId: string;
    scope: PayoutBatchSelectionScope;
    period: string;
    method: PayoutMethod;
    expectedReview?: PayoutBatchReview;
  }): Promise<PayoutBatchReview> {
    const result = await this.reservePayoutBatch({ ...params, previewOnly: true });
    return result.review;
  }

  async reservePayoutBatch(params: {
    tenantId: string;
    scope: PayoutBatchSelectionScope;
    period: string;
    method: PayoutMethod;
    actorUserId?: string;
    requestedPayoutId?: string;
    previewOnly?: boolean;
    expectedReview?: PayoutBatchReview;
  }): Promise<{
    batchId: string | null;
    period: string;
    processing: Array<{ membershipId: string; payoutId: string; totalCents: bigint; entryCount: number }>;
    skipped: Array<{
      membershipId: string;
      reason: 'nothing_payable' | 'below_min' | 'already_processing' | 'payout_not_ready';
      netCents: bigint;
    }>;
    review: PayoutBatchReview;
  }> {
    const compliance = this.requirePayoutCompliance();
    return this.tx(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: params.tenantId } });
      const requestedTargets =
        params.scope.mode === 'selected' ? [...new Set(params.scope.membershipIds)].sort() : [];
      if (params.scope.mode === 'selected' && requestedTargets.length === 0) {
        throw new BadRequestException('select at least one membership for a payout batch');
      }
      if (requestedTargets.length > 100) {
        throw new BadRequestException('a payout batch may contain at most 100 memberships');
      }
      const eligibleTargets =
        params.scope.mode === 'all_eligible'
          ? await tx.$queryRaw<Array<{ membershipId: string }>>`
              SELECT beneficiary_membership_id AS "membershipId"
              FROM ledger_entries
              WHERE tenant_id = ${params.tenantId}::uuid
                AND status = 'payable'
              GROUP BY beneficiary_membership_id
              HAVING SUM(amount_cents) > 0
                 AND SUM(amount_cents) >= ${tenant.payoutMinCents}
              ORDER BY beneficiary_membership_id
              LIMIT 101`
          : [];
      if (eligibleTargets.length > 100) {
        if (
          !params.expectedReview ||
          params.expectedReview.eligibleCount + params.expectedReview.excludedCount > 100
        ) {
          throw new BadRequestException('select at most 100 payable memberships for one payout batch');
        }
        const exactRows = await tx.$queryRaw<
          Array<{
            eligibleCount: bigint;
            excludedCount: bigint;
            totalCents: bigint;
            eligibleDigest: string;
            excludedDigest: string;
          }>
        >`
          WITH threshold_members AS (
            SELECT beneficiary_membership_id AS membership_id,
                   SUM(amount_cents)::bigint AS net_cents
            FROM ledger_entries
            WHERE tenant_id = ${params.tenantId}::uuid
              AND status = 'payable'
            GROUP BY beneficiary_membership_id
            HAVING SUM(amount_cents) > 0
               AND SUM(amount_cents) >= ${tenant.payoutMinCents}
          ), processing_members AS (
            SELECT DISTINCT membership_id
            FROM payouts
            WHERE tenant_id = ${params.tenantId}::uuid
              AND period = ${params.period}
              AND status = 'processing'
          ), eligible_members AS (
            SELECT threshold_members.membership_id, threshold_members.net_cents
            FROM threshold_members
            LEFT JOIN processing_members
              ON processing_members.membership_id = threshold_members.membership_id
            WHERE processing_members.membership_id IS NULL
          ), excluded_members AS (
            SELECT threshold_members.membership_id
            FROM threshold_members
            JOIN processing_members
              ON processing_members.membership_id = threshold_members.membership_id
          ), member_material AS (
            SELECT eligible_members.membership_id,
                   eligible_members.net_cents,
                   eligible_members.membership_id::text || ':' ||
                     eligible_members.net_cents::text || ':' ||
                     string_agg(
                       le.id::text || ':' || le.amount_cents::text,
                       ',' ORDER BY le.id
                     ) AS material
            FROM eligible_members
            JOIN ledger_entries le
              ON le.beneficiary_membership_id = eligible_members.membership_id
             AND le.tenant_id = ${params.tenantId}::uuid
             AND le.status = 'payable'
            GROUP BY eligible_members.membership_id, eligible_members.net_cents
          )
          SELECT (SELECT COUNT(*)::bigint FROM eligible_members) AS "eligibleCount",
                 (SELECT COUNT(*)::bigint FROM excluded_members) AS "excludedCount",
                 (SELECT COALESCE(SUM(net_cents), 0)::bigint FROM eligible_members) AS "totalCents",
                 md5(COALESCE(
                   (SELECT string_agg(material, '|' ORDER BY membership_id) FROM member_material),
                   ''
                 )) AS "eligibleDigest",
                 md5(COALESCE(
                   (SELECT string_agg(
                     membership_id::text || ':already_processing:0',
                     '|' ORDER BY membership_id
                   ) FROM excluded_members),
                   ''
                 )) AS "excludedDigest"`;
        const exact = exactRows[0];
        const exactEligibleCount = Number(exact.eligibleCount);
        const exactExcludedCount = Number(exact.excludedCount);
        if (!Number.isSafeInteger(exactEligibleCount) || !Number.isSafeInteger(exactExcludedCount)) {
          throw new BadRequestException('payout eligibility count exceeds the supported range');
        }
        throw new PayoutBatchReviewDriftError({
          eligibleCount: exactEligibleCount,
          excludedCount: exactExcludedCount,
          totals:
            exactEligibleCount > 0
              ? [{ currency: tenant.currency, amountCents: exact.totalCents }]
              : [],
          selectionFingerprint: sha256(
            JSON.stringify({
              currency: tenant.currency,
              eligibleCount: exact.eligibleCount.toString(),
              excludedCount: exact.excludedCount.toString(),
              totalCents: exact.totalCents.toString(),
              eligibleDigest: exact.eligibleDigest,
              excludedDigest: exact.excludedDigest,
            }),
          ),
        });
      }
      const targets =
        params.scope.mode === 'selected' ? requestedTargets : eligibleTargets.map((row) => row.membershipId);

      const reservations: PayoutReservation[] = [];
      const skipped: Array<{
        membershipId: string;
        reason: 'nothing_payable' | 'below_min' | 'already_processing' | 'payout_not_ready';
        netCents: bigint;
      }> = [];

      for (const membershipId of targets) {
        // requestPayout locks this same row before creating/reusing an active intent.
        // Every target is sorted, so multi-member batches acquire this lock in one
        // global order and cannot race a member request into the active-key index.
        const lockedMemberships = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM memberships
          WHERE id = ${membershipId}::uuid
            AND tenant_id = ${params.tenantId}::uuid
          FOR UPDATE`;
        if (lockedMemberships.length !== 1) {
          throw new NotFoundException('membership not found');
        }
        const activeKey = payoutActiveKey(params.tenantId, membershipId, params.period);
        const active = await tx.$queryRaw<
          Array<{ id: string; status: PayoutStatus; membershipId: string }>
        >`
          SELECT id, status, membership_id AS "membershipId"
          FROM payouts
          WHERE tenant_id = ${params.tenantId}::uuid
            AND membership_id = ${membershipId}::uuid
            AND period = ${params.period}
            AND (active_key = ${activeKey} OR status IN ('requested', 'processing'))
          ORDER BY created_at ASC
          FOR UPDATE`;

        let requestedPayoutId: string | null = null;
        if (params.requestedPayoutId) {
          const request = active.find((row) => row.id === params.requestedPayoutId);
          if (!request || request.status !== PayoutStatus.requested) {
            throw new ConflictException('open payout request not found');
          }
          if (active.some((row) => row.id !== request.id && row.status === PayoutStatus.processing)) {
            skipped.push({ membershipId, reason: 'already_processing', netCents: 0n });
            continue;
          }
          requestedPayoutId = request.id;
        } else if (active.some((row) => row.status === PayoutStatus.processing)) {
          skipped.push({ membershipId, reason: 'already_processing', netCents: 0n });
          continue;
        } else {
          requestedPayoutId = active.find((row) => row.status === PayoutStatus.requested)?.id ?? null;
        }

        const rows = await tx.$queryRaw<PayoutLedgerRow[]>`
           SELECT le.id,
                  le.beneficiary_membership_id AS "membershipId",
                  le.level,
                  le.amount_cents AS "amountCents",
                  COALESCE(
                    le.summary_month,
                    s.summary_month,
                    to_char(s.sale_date AT TIME ZONE ${tenant.timezone}, 'YYYY-MM')
                  ) AS "month"
           FROM ledger_entries le
           LEFT JOIN sales s ON s.id = le.sale_id
          WHERE le.tenant_id = ${params.tenantId}::uuid
            AND le.beneficiary_membership_id = ${membershipId}::uuid
            AND le.status = 'payable'
          ORDER BY le.id
          FOR UPDATE OF le`;
        const netCents = rows.reduce((total, row) => total + row.amountCents, 0n);
        if (rows.length === 0) {
          skipped.push({ membershipId, reason: 'nothing_payable', netCents });
          continue;
        }
        if (netCents <= 0n || netCents < tenant.payoutMinCents) {
          skipped.push({ membershipId, reason: 'below_min', netCents });
          continue;
        }
        await this.assertPeriodsOpen(
          tx,
          params.tenantId,
          rows.map((row) => row.month),
        );
        const recipients = await tx.$queryRaw<
          Array<{ referralCode: string; fullName: string; email: string; emailVerifiedAt: Date | null }>
        >`
          SELECT m.referral_code AS "referralCode",
                 u.full_name     AS "fullName",
                 u.email         AS "email",
                 u.email_verified_at AS "emailVerifiedAt"
          FROM memberships m
          JOIN users u ON u.id = m.user_id
          WHERE m.id = ${membershipId}::uuid
            AND m.tenant_id = ${params.tenantId}::uuid`;
        if (recipients.length !== 1) {
          throw new ConflictException('payout recipient changed while the batch was being reserved');
        }
        const complianceInput = await compliance.readInput(tx, params.tenantId, membershipId);
        const readiness = evaluatePayoutReadiness({
          emailVerified: recipients[0].emailVerifiedAt !== null,
          payableCents: netCents,
          threshold: { amountCents: tenant.payoutMinCents, currency: tenant.currency },
          activePayout: null,
          mfa: { requirement: 'unknown' },
          manualChecks: complianceInput.manualChecks,
          destination: complianceInput.destination,
        });
        if (!readiness.requestable) {
          skipped.push({ membershipId, reason: 'payout_not_ready', netCents });
          continue;
        }
        reservations.push({
          membershipId,
          requestedPayoutId,
          amountCents: netCents,
          rows,
          complianceSnapshot: compliance.buildSnapshot(complianceInput),
          recipient: recipients[0],
        });
      }

      const totalCents = reservations.reduce((total, reservation) => total + reservation.amountCents, 0n);
      const review: PayoutBatchReview = {
        eligibleCount: reservations.length,
        excludedCount: skipped.length,
        totals: reservations.length > 0 ? [{ currency: tenant.currency, amountCents: totalCents }] : [],
        selectionFingerprint: sha256(
          JSON.stringify({
            currency: tenant.currency,
            eligible: reservations.map((reservation) => ({
              membershipId: reservation.membershipId,
              amountCents: reservation.amountCents.toString(),
              ledger: reservation.rows.map((row) => ({ id: row.id, amountCents: row.amountCents.toString() })),
            })),
            excluded: skipped.map((item) => ({
              membershipId: item.membershipId,
              reason: item.reason,
              netCents: item.netCents.toString(),
            })),
          }),
        ),
      };
      if (
        params.expectedReview &&
        (params.expectedReview.eligibleCount !== review.eligibleCount ||
          params.expectedReview.excludedCount !== review.excludedCount ||
          params.expectedReview.selectionFingerprint !== review.selectionFingerprint ||
          params.expectedReview.totals.length !== review.totals.length ||
          params.expectedReview.totals.some((total, index) => {
            const current = review.totals[index];
            return !current || total.currency !== current.currency || total.amountCents !== current.amountCents;
          }))
      ) {
        throw new PayoutBatchReviewDriftError(review);
      }
      if (targets.length > 100) {
        throw new BadRequestException('select at most 100 payable memberships for one payout batch');
      }

      if (params.previewOnly) {
        return { batchId: null, period: params.period, processing: [], skipped, review };
      }

      if (reservations.length === 0) {
        return { batchId: null, period: params.period, processing: [], skipped, review };
      }

      const now = new Date();
      const batch = await tx.payoutSettlementBatch.create({
        data: {
          tenantId: params.tenantId,
          period: params.period,
          method: params.method,
          status: PayoutSettlementBatchStatus.processing,
          processingStartedAt: now,
          processingByUserId: params.actorUserId ?? null,
        },
      });
      const processing: Array<{ membershipId: string; payoutId: string; totalCents: bigint; entryCount: number }> = [];
      const summaries = new Map<string, { membershipId: string; month: string; level: number; amount: bigint }>();

      for (const reservation of reservations) {
        const activeKey = payoutActiveKey(params.tenantId, reservation.membershipId, params.period);
        const payout = reservation.requestedPayoutId
          ? await tx.payout.update({
              where: { id: reservation.requestedPayoutId },
              data: {
                batchId: batch.id,
                totalCents: reservation.amountCents,
                method: params.method,
                status: PayoutStatus.processing,
                activeKey,
                processingStartedAt: now,
                processingByUserId: params.actorUserId ?? null,
                recipientReferralCode: reservation.recipient.referralCode,
                recipientFullName: reservation.recipient.fullName,
                recipientEmail: reservation.recipient.email,
                complianceSnapshot: reservation.complianceSnapshot,
              },
            })
          : await tx.payout.create({
              data: {
                tenantId: params.tenantId,
                membershipId: reservation.membershipId,
                batchId: batch.id,
                totalCents: reservation.amountCents,
                method: params.method,
                status: PayoutStatus.processing,
                period: params.period,
                activeKey,
                processingStartedAt: now,
                processingByUserId: params.actorUserId ?? null,
                recipientReferralCode: reservation.recipient.referralCode,
                recipientFullName: reservation.recipient.fullName,
                recipientEmail: reservation.recipient.email,
                complianceSnapshot: reservation.complianceSnapshot,
              },
            });
        const claimed = await tx.ledgerEntry.updateMany({
          where: {
            id: { in: reservation.rows.map((row) => row.id) },
            status: LedgerStatus.payable,
            payoutId: null,
            payoutBatchId: null,
          },
          data: { status: LedgerStatus.processing, payoutId: payout.id, payoutBatchId: batch.id },
        });
        if (claimed.count !== reservation.rows.length) {
          throw new ConflictException('payable rows changed while the batch was being reserved');
        }
        await tx.payoutSettlementBatchItem.createMany({
          data: reservation.rows.map((row) => ({
            batchId: batch.id,
            payoutId: payout.id,
            ledgerEntryId: row.id,
            membershipId: reservation.membershipId,
            month: row.month,
            level: row.level,
            amountCents: row.amountCents,
            recipientReferralCode: reservation.recipient.referralCode,
            recipientFullName: reservation.recipient.fullName,
            recipientEmail: reservation.recipient.email,
            recipientSnapshotAt: now,
          })),
        });
        for (const row of reservation.rows) {
          const key = `${reservation.membershipId}|${row.month}|${row.level}`;
          const current = summaries.get(key) ?? {
            membershipId: reservation.membershipId,
            month: row.month,
            level: row.level,
            amount: 0n,
          };
          current.amount += row.amountCents;
          summaries.set(key, current);
        }
        await this.audit(tx, params.tenantId, params.actorUserId, 'payout.processing_started', payout.id, {}, {
          batchId: batch.id,
          totalCents: reservation.amountCents.toString(),
          entryCount: reservation.rows.length,
        });
        processing.push({
          membershipId: reservation.membershipId,
          payoutId: payout.id,
          totalCents: reservation.amountCents,
          entryCount: reservation.rows.length,
        });
      }

      for (const summary of [...summaries.values()].sort((a, b) =>
        `${a.membershipId}|${a.month}|${a.level}`.localeCompare(`${b.membershipId}|${b.month}|${b.level}`),
      )) {
        await this.bumpSummary(tx, params.tenantId, summary.membershipId, summary.month, summary.level, {
          payable: -summary.amount,
          processing: summary.amount,
        });
      }
      await this.audit(tx, params.tenantId, params.actorUserId, 'payout_batch.processing_started', batch.id, {}, {
        period: params.period,
        method: params.method,
        processingCount: processing.length,
        entryCount: reservations.reduce((count, reservation) => count + reservation.rows.length, 0),
      });
      return { batchId: batch.id, period: params.period, processing, skipped, review };
    });
  }

  /** Settles an already reserved batch only after provider/bank evidence is supplied. */
  async settlePayoutBatch(params: {
    tenantId: string;
    batchId: string;
    settlementReference: string;
    settlementEvidence: string;
    actorUserId?: string;
  }): Promise<{ batchId: string; settled: boolean; alreadySettled: boolean; payoutCount: number }> {
    const compliance = this.requirePayoutCompliance();
    const settlementReference = params.settlementReference.trim();
    const settlementEvidence = params.settlementEvidence.trim();
    if (!settlementReference || !settlementEvidence) {
      throw new BadRequestException('settlement reference and evidence are required');
    }
    return this.tx(async (tx) => {
      const batchRows = await tx.$queryRaw<
        Array<{ id: string; status: PayoutSettlementBatchStatus; period: string; method: PayoutMethod }>
      >`
        SELECT id, status, period, method
        FROM payout_settlement_batches
        WHERE id = ${params.batchId}::uuid
          AND tenant_id = ${params.tenantId}::uuid
        FOR UPDATE`;
      if (batchRows.length === 0) throw new NotFoundException('payout batch not found');
      const batch = batchRows[0];
      if (batch.status === PayoutSettlementBatchStatus.settled) {
        const count = await tx.payout.count({ where: { batchId: batch.id, status: PayoutStatus.paid } });
        return { batchId: batch.id, settled: false, alreadySettled: true, payoutCount: count };
      }
      if (batch.status !== PayoutSettlementBatchStatus.processing) {
        throw new ConflictException('only processing payout batches can be settled');
      }

      const payoutMemberships = await tx.$queryRaw<Array<{ membershipId: string }>>`
        SELECT DISTINCT membership_id AS "membershipId"
        FROM payouts
        WHERE batch_id = ${batch.id}::uuid
        ORDER BY membership_id`;
      for (const membershipId of payoutMemberships.map((row) => row.membershipId).sort()) {
        await compliance.lockMembership(tx, params.tenantId, membershipId);
      }
      const payouts = await tx.$queryRaw<
        Array<{ id: string; membershipId: string; totalCents: bigint; complianceSnapshot: Prisma.JsonValue | null }>
      >`
        SELECT id,
               membership_id AS "membershipId",
               total_cents AS "totalCents",
               compliance_snapshot AS "complianceSnapshot"
        FROM payouts
        WHERE batch_id = ${batch.id}::uuid
        ORDER BY membership_id, id
        FOR UPDATE`;
      if (payouts.length === 0) throw new ConflictException('processing batch has no payouts');
      for (const payout of payouts) {
        const current = await compliance.readInput(tx, params.tenantId, payout.membershipId);
        const recheck = compliance.recheckSnapshot(payout.complianceSnapshot, current);
        if (recheck === 'recheck_required') {
          throw new ConflictException({
            message: 'payout_compliance_recheck_required',
            code: 'payout_compliance_recheck_required',
          });
        }
        if (recheck === 'changed') {
          throw new ConflictException({
            message: 'payout_compliance_changed',
            code: 'payout_compliance_changed',
          });
        }
      }
      const items = await tx.$queryRaw<
        Array<{ id: string; payoutId: string; membershipId: string; month: string; level: number; amountCents: bigint; status: LedgerStatus; batchId: string | null }>
      >`
        SELECT bi.ledger_entry_id AS "id",
               bi.payout_id AS "payoutId",
               bi.membership_id AS "membershipId",
               bi.month,
               bi.level,
               bi.amount_cents AS "amountCents",
               le.status,
               le.payout_batch_id AS "batchId"
        FROM payout_settlement_batch_items bi
        JOIN ledger_entries le ON le.id = bi.ledger_entry_id
        WHERE bi.batch_id = ${batch.id}::uuid
        ORDER BY bi.ledger_entry_id
        FOR UPDATE OF le`;
      if (
        items.length === 0 ||
        items.some((item) => item.status !== LedgerStatus.processing || item.batchId !== batch.id)
      ) {
        throw new ConflictException('processing ledger set is no longer intact');
      }
      if (payouts.some((payout) => !items.some((item) => item.payoutId === payout.id))) {
        throw new ConflictException('processing payout set is no longer intact');
      }

      const now = new Date();
      const paidPayouts = await tx.payout.updateMany({
        where: { id: { in: payouts.map((payout) => payout.id) }, batchId: batch.id, status: PayoutStatus.processing },
        data: {
          status: PayoutStatus.paid,
          activeKey: null,
          paidAt: now,
          settledAt: now,
          settledByUserId: params.actorUserId ?? null,
          settlementReference,
          settlementEvidence,
          ref: settlementReference,
        },
      });
      if (paidPayouts.count !== payouts.length) throw new ConflictException('payout batch changed while settling');
      const paidEntries = await tx.ledgerEntry.updateMany({
        where: { id: { in: items.map((item) => item.id) }, status: LedgerStatus.processing, payoutBatchId: batch.id },
        data: { status: LedgerStatus.paid },
      });
      if (paidEntries.count !== items.length) throw new ConflictException('processing ledger rows changed while settling');
      await tx.payoutSettlementBatch.update({
        where: { id: batch.id },
        data: {
          status: PayoutSettlementBatchStatus.settled,
          settledAt: now,
          settledByUserId: params.actorUserId ?? null,
          settlementReference,
          settlementEvidence,
        },
      });

      await this.moveBatchSummary(tx, params.tenantId, items, 'settle');
      for (const payout of payouts) {
        await tx.notification.create({
          data: {
            tenantId: params.tenantId,
            recipientMembershipId: payout.membershipId,
            channel: NotificationChannel.push,
            template: 'payout_sent',
            payload: {
              payoutId: payout.id,
              batchId: batch.id,
              totalCents: payout.totalCents.toString(),
              period: batch.period,
              currency: (await tx.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { currency: true } })).currency,
            },
          },
        });
        await this.audit(tx, params.tenantId, params.actorUserId, 'payout.settled', payout.id, { status: 'processing' }, {
          batchId: batch.id,
          settlementReference,
          settlementEvidence,
        });
      }
      await this.audit(tx, params.tenantId, params.actorUserId, 'payout_batch.settled', batch.id, { status: 'processing' }, {
        settlementReference,
        settlementEvidence,
        payoutCount: payouts.length,
        entryCount: items.length,
      });
      return { batchId: batch.id, settled: true, alreadySettled: false, payoutCount: payouts.length };
    });
  }

  private requirePayoutCompliance(): PayoutComplianceService {
    if (!this.compliance) {
      throw new InternalServerErrorException('payout compliance service unavailable');
    }
    return this.compliance;
  }

  /** Releases an in-flight batch exactly back to payable; no transfer is represented as failed until it was processing. */
  async failPayoutBatch(params: {
    tenantId: string;
    batchId: string;
    reason: string;
    actorUserId?: string;
  }): Promise<{ batchId: string; failed: boolean; alreadyFailed: boolean; payoutCount: number }> {
    const reason = params.reason.trim();
    if (!reason) throw new BadRequestException('failure reason is required');
    return this.tx(async (tx) => {
      const batchRows = await tx.$queryRaw<Array<{ id: string; status: PayoutSettlementBatchStatus }>>`
        SELECT id, status
        FROM payout_settlement_batches
        WHERE id = ${params.batchId}::uuid
          AND tenant_id = ${params.tenantId}::uuid
        FOR UPDATE`;
      if (batchRows.length === 0) throw new NotFoundException('payout batch not found');
      const batch = batchRows[0];
      if (batch.status === PayoutSettlementBatchStatus.failed) {
        const count = await tx.payout.count({ where: { batchId: batch.id, status: PayoutStatus.failed } });
        return { batchId: batch.id, failed: false, alreadyFailed: true, payoutCount: count };
      }
      if (batch.status !== PayoutSettlementBatchStatus.processing) {
        throw new ConflictException('settled payout batches cannot be failed');
      }

      const payouts = await tx.$queryRaw<Array<{ id: string; membershipId: string }>>`
        SELECT id, membership_id AS "membershipId"
        FROM payouts
        WHERE batch_id = ${batch.id}::uuid
        ORDER BY id
        FOR UPDATE`;
      const items = await tx.$queryRaw<
        Array<{ id: string; payoutId: string; membershipId: string; month: string; level: number; amountCents: bigint; status: LedgerStatus; batchId: string | null }>
      >`
        SELECT bi.ledger_entry_id AS "id",
               bi.payout_id AS "payoutId",
               bi.membership_id AS "membershipId",
               bi.month,
               bi.level,
               bi.amount_cents AS "amountCents",
               le.status,
               le.payout_batch_id AS "batchId"
        FROM payout_settlement_batch_items bi
        JOIN ledger_entries le ON le.id = bi.ledger_entry_id
        WHERE bi.batch_id = ${batch.id}::uuid
        ORDER BY bi.ledger_entry_id
        FOR UPDATE OF le`;
      if (
        payouts.length === 0 ||
        items.length === 0 ||
        items.some((item) => item.status !== LedgerStatus.processing || item.batchId !== batch.id)
      ) {
        throw new ConflictException('processing ledger set is no longer intact');
      }

      const now = new Date();
      const released = await tx.ledgerEntry.updateMany({
        where: { id: { in: items.map((item) => item.id) }, status: LedgerStatus.processing, payoutBatchId: batch.id },
        data: { status: LedgerStatus.payable, payoutId: null, payoutBatchId: null },
      });
      if (released.count !== items.length) throw new ConflictException('processing ledger rows changed while failing');
      const failedPayouts = await tx.payout.updateMany({
        where: { id: { in: payouts.map((payout) => payout.id) }, batchId: batch.id, status: PayoutStatus.processing },
        data: {
          status: PayoutStatus.failed,
          activeKey: null,
          failedAt: now,
          failedByUserId: params.actorUserId ?? null,
          failureReason: reason,
          ref: reason,
        },
      });
      if (failedPayouts.count !== payouts.length) throw new ConflictException('payout batch changed while failing');
      await tx.payoutSettlementBatch.update({
        where: { id: batch.id },
        data: {
          status: PayoutSettlementBatchStatus.failed,
          failedAt: now,
          failedByUserId: params.actorUserId ?? null,
          failureReason: reason,
        },
      });
      await this.moveBatchSummary(tx, params.tenantId, items, 'fail');
      for (const payout of payouts) {
        await this.audit(tx, params.tenantId, params.actorUserId, 'payout.failed', payout.id, { status: 'processing' }, {
          batchId: batch.id,
          reason,
        });
      }
      await this.audit(tx, params.tenantId, params.actorUserId, 'payout_batch.failed', batch.id, { status: 'processing' }, {
        reason,
        payoutCount: payouts.length,
        entryCount: items.length,
      });
      return { batchId: batch.id, failed: true, alreadyFailed: false, payoutCount: payouts.length };
    });
  }

  /** Rejects only an unreserved member request; no ledger rows move. */
  async rejectPayoutRequest(params: {
    tenantId: string;
    payoutId: string;
    reason: string;
    actorUserId?: string;
  }): Promise<{ payoutId: string }> {
    const reason = params.reason.trim();
    if (!reason) throw new BadRequestException('rejection reason is required');
    return this.tx(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: PayoutStatus }>>`
        SELECT id, status
        FROM payouts
        WHERE id = ${params.payoutId}::uuid
          AND tenant_id = ${params.tenantId}::uuid
        FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException('payout request not found');
      if (rows[0].status !== PayoutStatus.requested) {
        throw new ConflictException('only requested payouts can be rejected');
      }
      const now = new Date();
      await tx.payout.update({
        where: { id: rows[0].id },
        data: {
          status: PayoutStatus.rejected,
          activeKey: null,
          rejectedAt: now,
          rejectedByUserId: params.actorUserId ?? null,
          rejectionReason: reason,
          ref: reason,
        },
      });
      await this.audit(tx, params.tenantId, params.actorUserId, 'payout.rejected', rows[0].id, { status: 'requested' }, {
        reason,
      });
      return { payoutId: rows[0].id };
    });
  }

  /**
   * Satisa bagli OLMAYAN bonus/ayarlama satiri (kampanya odulu vb.): tek transaction'da
   * ledger 'adjustment' (payable) satiri + summary (level 0) + bildirim + audit. Satir
   * summaryMonth'u kendisi tasir; mevcut payout akisi (payoutMember/decide/retry) LEFT JOIN
   * ile bunu da oder. Negatif amountCents = clawback/ceza (ileride).
   */
  async awardBonus(
    params: {
      tenantId: string;
      membershipId: string;
      amountCents: bigint;
      month: string;
      reason: string;
      actorUserId?: string;
      meta?: Record<string, unknown>;
    },
    // Cagiran kendi transaction'ini verirse (orn. kampanya finalize: claim + odul + results
    // ATOMIK olmali) o tx uzerinde calisir — yoksa kendi tek-tx'ini acar.
    externalTx?: Tx,
  ): Promise<{ ledgerId: string }> {
    if (externalTx) return this.awardBonusInTx(externalTx, params);
    return this.tx((tx) => this.awardBonusInTx(tx, params));
  }

  private async awardBonusInTx(
    tx: Tx,
    params: {
      tenantId: string;
      membershipId: string;
      amountCents: bigint;
      month: string;
      reason: string;
      actorUserId?: string;
      meta?: Record<string, unknown>;
    },
  ): Promise<{ ledgerId: string }> {
    await this.assertPeriodsOpen(tx, params.tenantId, [params.month]); // kilitli aya bonus yazilamaz
    const entry = await tx.ledgerEntry.create({
      data: {
        tenantId: params.tenantId,
        saleId: null,
        beneficiaryMembershipId: params.membershipId,
        level: 0,
        rateBpsUsed: 0,
        amountCents: params.amountCents,
        type: LedgerType.adjustment,
        status: LedgerStatus.payable,
        summaryMonth: params.month,
      },
    });
    await this.bumpSummary(tx, params.tenantId, params.membershipId, params.month, 0, {
      payable: params.amountCents,
    });
    await tx.notification.create({
      data: {
        tenantId: params.tenantId,
        recipientMembershipId: params.membershipId,
        channel: NotificationChannel.push,
        template: 'bonus_awarded',
        payload: { amountCents: params.amountCents.toString(), reason: params.reason },
      },
    });
    await this.audit(tx, params.tenantId, params.actorUserId, 'campaign.bonus', entry.id, {}, {
      membershipId: params.membershipId,
      amountCents: params.amountCents.toString(),
      reason: params.reason,
      ...(params.meta ?? {}),
    });
    return { ledgerId: entry.id };
  }

  // ---------------------------------------------------------------- internals

  /**
   * SPEC 7 applyCommissions: caller must already hold the sale row FOR UPDATE.
   * No-op if the sale is not approved or commission rows already exist.
   */
  private async applyCommissionsInTx(tx: Tx, sale: LockedSale): Promise<ApplyResult> {
    if (sale.status !== SaleStatus.approved) {
      return { applied: false, reason: 'not_approved', entryCount: 0 };
    }

    const existing = await tx.ledgerEntry.count({ where: { saleId: sale.id, type: LedgerType.commission } });
    if (existing > 0) {
      return { applied: false, reason: 'already_applied', entryCount: existing };
    }

    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: sale.tenantId } });
    const plan = await this.resolvePlan(tx, sale.tenantId, sale.saleDate, sale.commissionPlanId);
    if (!sale.commissionPlanId) {
      await tx.sale.update({ where: { id: sale.id }, data: { commissionPlanId: plan.id } });
      sale.commissionPlanId = plan.id;
    }
    const rawChain = await this.uplineChain(tx, sale.sellerMembershipId, plan.depth);
    // base unilevel: tenant ayarlarina gore etkin zincir (compression / inactive-earn)
    const chain = this.effectiveBaseChain(rawChain, tenant);
    const lines = computeCommissionLines(sale.amountCents, plan.levels, chain);

    const { status, maturesAt } = this.maturation(tenant, sale);

    // Freeze the month key on first apply; void/mature use the same bucket.
    // This preserves the bucket even if tenant.timezone changes later.
    const month = sale.summaryMonth ?? monthKey(sale.saleDate, tenant.timezone);
    await this.assertPeriodsOpen(tx, sale.tenantId, [month]); // kilitli aya komisyon yazilamaz
    if (!sale.summaryMonth) {
      await tx.sale.update({ where: { id: sale.id }, data: { summaryMonth: month } });
      sale.summaryMonth = month;
    }

    for (const line of lines) {
      await tx.ledgerEntry.create({
        data: {
          tenantId: sale.tenantId,
          saleId: sale.id,
          beneficiaryMembershipId: line.beneficiaryMembershipId,
          level: line.level,
          rateBpsUsed: line.rateBpsUsed,
          amountCents: line.amountCents,
          type: LedgerType.commission,
          status,
          maturesAt,
        },
      });

      const delta: SummaryDelta =
        status === LedgerStatus.payable ? { payable: line.amountCents } : { pending: line.amountCents };
      await this.bumpSummary(tx, sale.tenantId, line.beneficiaryMembershipId, month, line.level, delta);

      await tx.notification.create({
        data: {
          tenantId: sale.tenantId,
          recipientMembershipId: line.beneficiaryMembershipId,
          channel: NotificationChannel.push,
          template: 'commission_earned',
          payload: { saleId: sale.id, level: line.level, amountCents: line.amountCents.toString(), currency: sale.currency },
        },
      });
    }

    // ---- MLM bonus katmanlari (unilevel+): direkt sponsora fast-start + matching ----
    // Sentetik seviye numaralari (1000/1001) base seviyelerle cakismaz; type=commission
    // oldugu icin void/payout/summary/maturation akisindan dogal gecer.
    let bonusCount = 0;
    // Toplam dagitim izleyicisi (Model B tavani icin): base + tum bonuslar.
    let distributedCents = lines.reduce((a, l) => a + l.amountCents, 0n);
    // bonuslar GERCEK direkt sponsora (compression base zincirini kaydirabilir ama "direkt sponsor"
    // anlami degismez). inactiveMembersEarn=false ise inaktif sponsor bonus da almaz.
    const directSponsor = rawChain[1];
    const sponsorEarns = !!directSponsor && (tenant.inactiveMembersEarn || directSponsor.status === MembershipStatus.active);
    const sponsorId = sponsorEarns ? directSponsor!.id : undefined;
    if (sponsorId && (plan.fastStartBps > 0 || plan.matchingBps > 0)) {
      const addBonus = async (level: number, rateBps: number, amountCents: bigint, template: string) => {
        if (amountCents <= 0n) return;
        await tx.ledgerEntry.create({
          data: { tenantId: sale.tenantId, saleId: sale.id, beneficiaryMembershipId: sponsorId, level, rateBpsUsed: rateBps, amountCents, type: LedgerType.commission, status, maturesAt },
        });
        const delta: SummaryDelta = status === LedgerStatus.payable ? { payable: amountCents } : { pending: amountCents };
        await this.bumpSummary(tx, sale.tenantId, sponsorId, month, level, delta);
        await tx.notification.create({
          data: { tenantId: sale.tenantId, recipientMembershipId: sponsorId, channel: NotificationChannel.push, template, payload: { saleId: sale.id, amountCents: amountCents.toString() } },
        });
        distributedCents += amountCents;
        bonusCount++;
      };

      // fast-start: satici fastStartDays icinde katildiysa, amount * fastStartBps
      if (plan.fastStartBps > 0 && plan.fastStartDays > 0) {
        const seller = await tx.membership.findUnique({ where: { id: sale.sellerMembershipId }, select: { joinedAt: true } });
        if (seller && sale.saleDate.getTime() - seller.joinedAt.getTime() <= plan.fastStartDays * 86_400_000) {
          await addBonus(1000, plan.fastStartBps, bpsAmount(sale.amountCents, plan.fastStartBps), 'commission_earned');
        }
      }
      // matching: saticinin level-0 komisyonunun matchingBps'i (sponsor eslestirme)
      if (plan.matchingBps > 0 && lines.length > 0) {
        await addBonus(1001, plan.matchingBps, bpsAmount(lines[0].amountCents, plan.matchingBps), 'commission_earned');
      }
    }

    // ---- rutbe override (sentetik seviye 1002): satici, ulastigi rutbenin overrideBps'i
    // kadar KENDI satisinda ek bonus alir. Rutbe = team + kazanc esikleri (RanksService). ----
    const overrideBps = (await this.ranks?.overrideBpsFor(tx, sale.tenantId, sale.sellerMembershipId)) ?? 0;
    if (overrideBps > 0) {
      const overrideAmount = bpsAmount(sale.amountCents, overrideBps);
      if (overrideAmount > 0n) {
        const seller = sale.sellerMembershipId;
        await tx.ledgerEntry.create({
          data: { tenantId: sale.tenantId, saleId: sale.id, beneficiaryMembershipId: seller, level: 1002, rateBpsUsed: overrideBps, amountCents: overrideAmount, type: LedgerType.commission, status, maturesAt },
        });
        const delta: SummaryDelta = status === LedgerStatus.payable ? { payable: overrideAmount } : { pending: overrideAmount };
        await this.bumpSummary(tx, sale.tenantId, seller, month, 1002, delta);
        await tx.notification.create({
          data: { tenantId: sale.tenantId, recipientMembershipId: seller, channel: NotificationChannel.push, template: 'rank_override_earned', payload: { saleId: sale.id, amountCents: overrideAmount.toString(), overrideBps } },
        });
        distributedCents += overrideAmount;
        bonusCount++;
      }
    }

    // ---- Toplam dagitim tavani (Model B): bonuslar havuzun USTUNE odenir, ama bu satisin TOPLAM
    // dagitimi acikca hesaplanan tavani — pool + fastStart + matching + max(rutbe override) — ASLA
    // asamaz. Dogru hesapta her bilesen kendi bps'iyle sinirli oldugundan bu invariant hep saglanir;
    // asilmasi = bir bug (cift-yazim / hatali tutar) demektir → tx geri alinir, bozuk para yazilmaz.
    const maxOverrideBps = (await this.ranks?.maxOverrideBps(tx, sale.tenantId)) ?? 0;
    const ceilingBps = plan.poolRateBps + plan.fastStartBps + plan.matchingBps + maxOverrideBps;
    const ceilingCents = (sale.amountCents * BigInt(ceilingBps)) / 10000n;
    if (distributedCents > ceilingCents) {
      throw new ConflictException(
        `komisyon dagitim tavani asildi (sale=${sale.id}): dagitilan ${distributedCents} > tavan ${ceilingCents} (${ceilingBps} bps)`,
      );
    }

    return { applied: true, entryCount: lines.length + bonusCount };
  }

  private async lockSalesForTenant(
    tx: Tx,
    tenantId: string,
    saleIds: readonly string[],
  ): Promise<readonly string[]> {
    const normalizedIds = [...new Set(saleIds)].sort();
    if (normalizedIds.length === 0) {
      return [];
    }
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM sales
      WHERE tenant_id = ${tenantId}::uuid
        AND id IN (${Prisma.join(normalizedIds.map((saleId) => Prisma.sql`${saleId}::uuid`))})
      ORDER BY id ASC
      FOR UPDATE`);
    return rows.map((row) => row.id);
  }

  private async lockSale(tx: Tx, saleId: string, expectedTenantId?: string): Promise<LockedSale> {
    const tenantBoundary = expectedTenantId ?? null;
    const rows = await tx.$queryRaw<LockedSale[]>`
      SELECT id,
             tenant_id            AS "tenantId",
             seller_membership_id AS "sellerMembershipId",
             amount_cents         AS "amountCents",
             currency,
             status,
             sale_date            AS "saleDate",
             summary_month        AS "summaryMonth",
             commission_plan_id   AS "commissionPlanId",
             created_by           AS "createdBy",
             approved_at          AS "approvedAt",
             delivered_at         AS "deliveredAt"
      FROM sales
      WHERE id = ${saleId}::uuid
        AND (${tenantBoundary}::uuid IS NULL OR tenant_id = ${tenantBoundary}::uuid)
      FOR UPDATE`;
    if (rows.length === 0) {
      throw new NotFoundException(`sale not found: ${saleId}`);
    }
    return rows[0];
  }

  /** Last-resort fallback for sales voided before summary_month was assigned. */
  private async fallbackMonth(tx: Tx, sale: LockedSale): Promise<string> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: sale.tenantId } });
    return monthKey(sale.saleDate, tenant.timezone);
  }

  /** Plan active on the sale date with a stable final ID tie-break (SPEC 3.2 / T6). */
  private async findPlan(
    tx: Tx,
    tenantId: string,
    saleDate: Date,
  ): Promise<ResolvedCommissionPlan | null> {
    const plan = await tx.commissionPlan.findFirst({
      where: { tenantId, finalized: true, effectiveFrom: { lte: saleDate } },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      select: {
        id: true,
        poolRateBps: true,
        depth: true,
        effectiveFrom: true,
        levels: {
          orderBy: [{ level: 'asc' }, { id: 'asc' }],
          select: { id: true, level: true, rateBps: true },
        },
      },
    });
    return plan && {
      id: plan.id,
      poolRateBps: plan.poolRateBps,
      depth: plan.depth,
      effectiveFrom: plan.effectiveFrom,
      levels: plan.levels,
    };
  }

  private async assertPeriodsOpen(tx: Tx, tenantId: string, periods: string[]): Promise<void> {
    const unique = [...new Set(periods)].sort();
    for (const period of unique) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${period}))`;
    }
    const lock = await tx.periodLock.findFirst({ where: { tenantId, period: { in: unique } } });
    if (lock) throw new ConflictException(`period is locked: ${lock.period}`);
  }

  private async resolvePlan(
    tx: Tx,
    tenantId: string,
    saleDate: Date,
    commissionPlanId: string | null,
  ): Promise<{
    id: string;
    depth: number;
    levels: PlanLevelRate[];
    poolRateBps: number;
    fastStartBps: number;
    fastStartDays: number;
    matchingBps: number;
  }> {
    const plan = commissionPlanId
      ? await tx.commissionPlan.findFirst({
          where: { tenantId, id: commissionPlanId, finalized: true },
          include: { levels: { orderBy: { level: 'asc' } } },
        })
      : await tx.commissionPlan.findFirst({
          where: { tenantId, finalized: true, effectiveFrom: { lte: saleDate } },
          orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
          include: { levels: { orderBy: { level: 'asc' } } },
        });
    if (!plan) throw new ConflictException('no finalized commission plan is effective for this sale');
    return {
      id: plan.id,
      depth: plan.depth,
      levels: plan.levels.map((level) => ({ level: level.level, rateBps: level.rateBps })),
      poolRateBps: plan.poolRateBps,
      fastStartBps: plan.fastStartBps,
      fastStartDays: plan.fastStartDays,
      matchingBps: plan.matchingBps,
    };
  }

  private async resolveCommissionInputsOrNull(
    tx: Tx,
    sale: Pick<LockedSale, 'tenantId' | 'sellerMembershipId' | 'amountCents' | 'saleDate'>,
  ): Promise<ResolvedCommissionInputs | null> {
    const [tenant, plan] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: sale.tenantId } }),
      this.findPlan(tx, sale.tenantId, sale.saleDate),
    ]);
    if (!plan) return null;
    const rawChain = await this.uplineChain(tx, sale.sellerMembershipId, plan.depth);
    const chain = this.effectiveBaseChain(rawChain, tenant);
    return {
      tenant,
      plan,
      chain,
      lines: computeCommissionLines(sale.amountCents, plan.levels, chain),
    };
  }

  private async resolveCommissionInputs(
    tx: Tx,
    sale: Pick<LockedSale, 'tenantId' | 'sellerMembershipId' | 'amountCents' | 'saleDate'>,
  ): Promise<ResolvedCommissionInputs> {
    const inputs = await this.resolveCommissionInputsOrNull(tx, sale);
    if (!inputs) {
      throw new ConflictException(`no commission plan is effective on the sale date (tenant=${sale.tenantId})`);
    }
    return inputs;
  }

  /**
   * Sponsor chain from the seller upward, limited to plan depth (SPEC 7 step 3).
   * chain[0] is the seller. Inactive members keep earning in MVP unless tenant settings say otherwise.
   */
  private async uplineChain(tx: Tx, sellerMembershipId: string, depth: number): Promise<Array<{ id: string; status: MembershipStatus }>> {
    const chain: Array<{ id: string; status: MembershipStatus }> = [];
    let currentId: string | null = sellerMembershipId;
    for (let level = 0; level < depth && currentId; level++) {
      const m: { sponsorMembershipId: string | null; status: MembershipStatus } | null = await tx.membership.findUnique({
        where: { id: currentId },
        select: { sponsorMembershipId: true, status: true },
      });
      if (!m) {
        throw new NotFoundException(`membership not found: ${currentId}`);
      }
      chain.push({ id: currentId, status: m.status });
      currentId = m.sponsorMembershipId;
    }
    return chain;
  }

  /**
   * Tenant ayarlarina gore ETKIN base zincir (Dalga 5 — atil toggle'lari gercege cevirir):
   * - compressionEnabled: inaktif upline'lari ATLA, aktifleri yukari kaydir (roll-up).
   * - inactiveMembersEarn=false (compression kapali): inaktif upline o seviyede pay ALMAZ, yeri
   *   bos birakilir ('') — pay sirkette kalir, roll-up YOK.
   * - varsayilan (inactiveMembersEarn=true): herkes kazanir (mevcut davranis — degismez).
   * Satici (level 0) her zaman dahildir (satis zaten aktif uye adina girilir).
   */
  private effectiveBaseChain(raw: Array<{ id: string; status: MembershipStatus }>, tenant: Tenant): string[] {
    if (raw.length === 0) return [];
    const seller = raw[0].id;
    const uplines = raw.slice(1);
    if (tenant.compressionEnabled) {
      return [seller, ...uplines.filter((u) => u.status === MembershipStatus.active).map((u) => u.id)];
    }
    if (!tenant.inactiveMembersEarn) {
      return [seller, ...uplines.map((u) => (u.status === MembershipStatus.active ? u.id : ''))];
    }
    return raw.map((r) => r.id);
  }

  /** Olgunlasma kurali (SPEC 3.4): satirin baslangic statusu + matures_at. */
  private maturation(
    tenant: Tenant,
    sale: LockedSale,
  ): { status: LedgerStatus; maturesAt: Date | null } {
    switch (tenant.maturationRule) {
      case MaturationRule.on_approval:
        return { status: LedgerStatus.payable, maturesAt: null };
      case MaturationRule.on_delivery:
        // matures_at remains empty until delivery; markDelivered fills it and the job matures it.
        return { status: LedgerStatus.pending, maturesAt: sale.deliveredAt };
      case MaturationRule.days_after_approval: {
        const base = sale.approvedAt ?? new Date();
        const days = tenant.maturationDays ?? 0;
        return { status: LedgerStatus.pending, maturesAt: new Date(base.getTime() + days * 86_400_000) };
      }
      case MaturationRule.days_after_delivery: {
        // iade penceresi: teslime kadar matures_at bos; markDelivered teslim+N ile doldurur
        const days = tenant.maturationDays ?? 0;
        return {
          status: LedgerStatus.pending,
          maturesAt: sale.deliveredAt ? new Date(sale.deliveredAt.getTime() + days * 86_400_000) : null,
        };
      }
    }
  }

  private async moveBatchSummary(
    tx: Tx,
    tenantId: string,
    items: Array<{ membershipId: string; month: string; level: number; amountCents: bigint }>,
    transition: 'settle' | 'fail',
  ): Promise<void> {
    const summaries = new Map<string, { membershipId: string; month: string; level: number; amount: bigint }>();
    for (const item of items) {
      const key = `${item.membershipId}|${item.month}|${item.level}`;
      const current = summaries.get(key) ?? {
        membershipId: item.membershipId,
        month: item.month,
        level: item.level,
        amount: 0n,
      };
      current.amount += item.amountCents;
      summaries.set(key, current);
    }
    for (const summary of [...summaries.values()].sort((a, b) =>
      `${a.membershipId}|${a.month}|${a.level}`.localeCompare(`${b.membershipId}|${b.month}|${b.level}`),
    )) {
      await this.bumpSummary(
        tx,
        tenantId,
        summary.membershipId,
        summary.month,
        summary.level,
        transition === 'settle'
          ? { processing: -summary.amount, paid: summary.amount }
          : { processing: -summary.amount, payable: summary.amount },
      );
    }
  }

  /**
   * monthly_summaries upsert in the same transaction (SPEC 7 step 5).
   * Raw ON CONFLICT lets Postgres atomically resolve concurrent row-creation races.
   */
  private async bumpSummary(
    tx: Tx,
    tenantId: string,
    membershipId: string,
    month: string,
    level: number,
    delta: SummaryDelta,
  ): Promise<void> {
    const pending = delta.pending ?? 0n;
    const payable = delta.payable ?? 0n;
    const processing = delta.processing ?? 0n;
    const paid = delta.paid ?? 0n;
    await tx.$executeRaw`
      INSERT INTO monthly_summaries
        (id, tenant_id, membership_id, month, level, pending_cents, payable_cents, processing_cents, paid_cents, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${tenantId}::uuid, ${membershipId}::uuid, ${month}, ${level}, ${pending}, ${payable}, ${processing}, ${paid}, now(), now())
      ON CONFLICT (tenant_id, membership_id, month, level) DO UPDATE SET
        pending_cents = monthly_summaries.pending_cents + EXCLUDED.pending_cents,
        payable_cents = monthly_summaries.payable_cents + EXCLUDED.payable_cents,
        processing_cents = monthly_summaries.processing_cents + EXCLUDED.processing_cents,
        paid_cents    = monthly_summaries.paid_cents    + EXCLUDED.paid_cents,
        updated_at    = now()`;
  }

  /** Money-impacting actions are written to the audit log (SPEC 4.2 / 10). */
  private async audit(
    tx: Tx,
    tenantId: string,
    actorUserId: string | undefined,
    action: string,
    entityId: string,
    before: object,
    after: object,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: actorUserId ?? null,
        action,
        // Entity comes from the action prefix, such as sale.approve -> sale.
        entity: action.split('.')[0],
        entityId,
        before,
        after,
      },
    });
  }
}
