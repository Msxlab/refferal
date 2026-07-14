import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerStatus, PayoutSettlementBatchStatus, PayoutMethod, PayoutStatus, Prisma } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { sha256 } from '../common/crypto';
import { EngineService, payoutActiveKey } from '../engine/engine.service';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { csvCell } from '../sales/csv';

function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function formatMoney(cents: bigint, currency: string): string {
  const symbol =
    new Intl.NumberFormat('en-US', { style: 'currency', currency })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? `${currency} `;
  const value = formatCents(cents);
  return value.startsWith('-') ? `-${symbol}${value.slice(1)}` : `${symbol}${value}`;
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private async currentPeriod(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return monthKey(new Date(), tenant.timezone);
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
  async startBatch(
    actor: ActorContext,
    input: { membershipIds?: string[]; period?: string; method: 'manual' | 'csv' },
  ) {
    this.tenantContext.assertActor(actor);
    const period = input.period ?? (await this.currentPeriod(actor.tenantId));
    const method = input.method === 'csv' ? PayoutMethod.csv : PayoutMethod.manual;
    const membershipIds = input.membershipIds?.length ? [...new Set(input.membershipIds)].sort() : undefined;
    if (membershipIds?.length) {
      const valid = await this.prisma.membership.findMany({
        where: { id: { in: membershipIds }, tenantId: actor.tenantId },
        select: { id: true },
      });
      if (valid.length !== membershipIds.length) {
        throw new BadRequestException('some memberships do not belong to this business');
      }
    }
    const result = await this.engine.reservePayoutBatch({
      tenantId: actor.tenantId,
      membershipIds,
      period,
      method,
      actorUserId: actor.userId,
    });
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
  async run(actor: ActorContext, input: { membershipIds?: string[]; period?: string; method: 'manual' | 'csv' }) {
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
      membershipIds: [request.membershipId],
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
        include: { membership: { select: { referralCode: true, user: { select: { fullName: true } } } } },
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
      if (!members[0].emailVerifiedAt) {
        throw new BadRequestException('verify your email address before requesting a payout');
      }
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
      if (existing) {
        return {
          id: existing.id,
          status: existing.status,
          period,
          requestedCents: existing.totalCents.toString(),
          currency: tenant.currency,
        };
      }
      const ledger = await tx.$queryRaw<Array<{ amountCents: bigint }>>`
        SELECT amount_cents AS "amountCents"
        FROM ledger_entries
        WHERE tenant_id = ${tenantId}::uuid
          AND beneficiary_membership_id = ${membershipId}::uuid
          AND status = 'payable'
        ORDER BY id
        FOR UPDATE`;
      const net = ledger.reduce((total, row) => total + row.amountCents, 0n);
      if (net <= 0n || net < tenant.payoutMinCents) {
        throw new BadRequestException(
          `payable balance (${formatMoney(net, tenant.currency)}) is below the minimum threshold (${formatMoney(tenant.payoutMinCents, tenant.currency)})`,
        );
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
    return rows.map((payout) => ({
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
    }));
  }
}
