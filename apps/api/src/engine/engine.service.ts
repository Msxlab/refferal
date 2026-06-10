import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LedgerStatus,
  LedgerType,
  MaturationRule,
  NotificationChannel,
  Prisma,
  SaleStatus,
  Tenant,
} from '@prisma/client';
import { computeCommissionLines, PlanLevelRate } from '@refearn/shared';
import { PrismaService } from '../prisma/prisma.service';
import { monthKey } from './month';

type Tx = Prisma.TransactionClient;

interface LockedSale {
  id: string;
  tenantId: string;
  sellerMembershipId: string;
  amountCents: bigint;
  status: SaleStatus;
  saleDate: Date;
  approvedAt: Date | null;
  deliveredAt: Date | null;
}

interface SummaryDelta {
  pending?: bigint;
  payable?: bigint;
  paid?: bigint;
}

export interface ApplyResult {
  applied: boolean;
  reason?: 'not_approved' | 'already_applied';
  entryCount: number;
}

const TX_OPTS: { timeout: number; maxWait: number } = { timeout: 20_000, maxWait: 15_000 };

/**
 * Komisyon motoru (SPEC 7). Para etkileyen her sey TEK Postgres transaction'inda:
 * ledger + monthly_summaries + outbox + audit birlikte commit olur.
 */
@Injectable()
export class EngineService {
  constructor(private readonly prisma: PrismaService) {}

  /** Satisi onaylar ve ayni transaction icinde komisyonlari dagitir. */
  async approveSale(saleId: string, actorUserId?: string): Promise<ApplyResult> {
    return this.prisma.$transaction(async (tx) => {
      const sale = await this.lockSale(tx, saleId);
      if (sale.status === SaleStatus.void) {
        throw new ConflictException('void edilmis satis onaylanamaz');
      }
      if (sale.status === SaleStatus.draft) {
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
    }, TX_OPTS);
  }

  /** Idempotent: ayni satisa kac kez cagrilirsa cagrilsin sonuc ayni (T4/T10). */
  async applyCommissions(saleId: string): Promise<ApplyResult> {
    return this.prisma.$transaction(async (tx) => {
      const sale = await this.lockSale(tx, saleId);
      return this.applyCommissionsInTx(tx, sale);
    }, TX_OPTS);
  }

  /**
   * Satisi void eder; mevcut her commission satiri icin esit-ters reversal ekler (T5).
   * Muhasebe kurallari docs/DECISIONS.md "Reversal muhasebesi" bolumunde.
   */
  async voidSale(saleId: string, actorUserId?: string): Promise<{ voided: boolean; reversalCount: number }> {
    return this.prisma.$transaction(async (tx) => {
      const sale = await this.lockSale(tx, saleId);
      if (sale.status === SaleStatus.void) {
        return { voided: false, reversalCount: 0 };
      }
      const before = sale.status;
      await tx.sale.update({ where: { id: saleId }, data: { status: SaleStatus.void } });
      await this.audit(tx, sale.tenantId, actorUserId, 'sale.void', saleId, { status: before }, { status: 'void' });

      const entries = await tx.ledgerEntry.findMany({
        where: {
          saleId,
          type: LedgerType.commission,
          status: { in: [LedgerStatus.pending, LedgerStatus.payable, LedgerStatus.paid] },
        },
        orderBy: { level: 'asc' },
      });
      if (entries.length === 0) {
        return { voided: true, reversalCount: 0 };
      }

      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: sale.tenantId } });
      const month = monthKey(sale.saleDate, tenant.timezone);

      for (const entry of entries) {
        // paid satirin reversal'i payable kalir (eksiye duser, sonraki kazanclardan
        // mahsup edilir); pending/payable satirin reversal'i orijinaliyle birlikte
        // kapanir (ikisi de 'reversed').
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
            : { payable: -entry.amountCents }; // payable veya paid (mahsup)
        await this.bumpSummary(tx, sale.tenantId, entry.beneficiaryMembershipId, month, entry.level, delta);

        await tx.notification.create({
          data: {
            tenantId: sale.tenantId,
            recipientMembershipId: entry.beneficiaryMembershipId,
            channel: NotificationChannel.push,
            template: 'commission_reversed',
            payload: { saleId, level: entry.level, amountCents: (-entry.amountCents).toString() },
          },
        });
      }

      return { voided: true, reversalCount: entries.length };
    }, TX_OPTS);
  }

  /** Teslimati isaretler; on_delivery kuralinda pending satirlarin matures_at'ini doldurur (T7). */
  async markDelivered(saleId: string, deliveredAt: Date = new Date()): Promise<{ delivered: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const sale = await this.lockSale(tx, saleId);
      if (sale.status !== SaleStatus.approved) {
        throw new ConflictException('yalnizca onaylanmis satis teslim edilebilir');
      }
      if (sale.deliveredAt) {
        return { delivered: false };
      }
      await tx.sale.update({ where: { id: saleId }, data: { deliveredAt } });
      await tx.ledgerEntry.updateMany({
        where: { saleId, type: LedgerType.commission, status: LedgerStatus.pending, maturesAt: null },
        data: { maturesAt: deliveredAt },
      });
      return { delivered: true };
    }, TX_OPTS);
  }

  /** Job (5 dk'da bir): matures_at <= now olan pending satirlari payable yapar (SPEC 7). */
  async matureCommissions(now: Date = new Date()): Promise<{ matured: number }> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<
        Array<{
          id: string;
          tenantId: string;
          membershipId: string;
          level: number;
          amountCents: bigint;
          saleDate: Date;
          timezone: string;
        }>
      >`
        SELECT le.id,
               le.tenant_id                  AS "tenantId",
               le.beneficiary_membership_id  AS "membershipId",
               le.level,
               le.amount_cents               AS "amountCents",
               s.sale_date                   AS "saleDate",
               t.timezone
        FROM ledger_entries le
        JOIN sales s   ON s.id = le.sale_id
        JOIN tenants t ON t.id = le.tenant_id
        WHERE le.type = 'commission'
          AND le.status = 'pending'
          AND le.matures_at IS NOT NULL
          AND le.matures_at <= ${now}
        ORDER BY le.created_at
        FOR UPDATE OF le SKIP LOCKED`;

      for (const row of due) {
        await tx.ledgerEntry.update({ where: { id: row.id }, data: { status: LedgerStatus.payable } });
        const month = monthKey(row.saleDate, row.timezone);
        await this.bumpSummary(tx, row.tenantId, row.membershipId, month, row.level, {
          pending: -row.amountCents,
          payable: row.amountCents,
        });
      }
      return { matured: due.length };
    }, TX_OPTS);
  }

  // ---------------------------------------------------------------- internals

  /**
   * SPEC 7 applyCommissions — cagiran, satisi FOR UPDATE ile kilitlemis olmali.
   * approved degilse veya commission satirlari zaten varsa no-op.
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
    const plan = await this.resolvePlan(tx, sale.tenantId, sale.saleDate);
    const chain = await this.uplineChain(tx, sale.sellerMembershipId, plan.depth);
    const lines = computeCommissionLines(sale.amountCents, plan.levels, chain);

    const { status, maturesAt } = this.maturation(tenant, sale);
    const month = monthKey(sale.saleDate, tenant.timezone);

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
          payload: { saleId: sale.id, level: line.level, amountCents: line.amountCents.toString() },
        },
      });
    }

    return { applied: true, entryCount: lines.length };
  }

  private async lockSale(tx: Tx, saleId: string): Promise<LockedSale> {
    const rows = await tx.$queryRaw<LockedSale[]>`
      SELECT id,
             tenant_id            AS "tenantId",
             seller_membership_id AS "sellerMembershipId",
             amount_cents         AS "amountCents",
             status,
             sale_date            AS "saleDate",
             approved_at          AS "approvedAt",
             delivered_at         AS "deliveredAt"
      FROM sales
      WHERE id = ${saleId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) {
      throw new NotFoundException(`satis bulunamadi: ${saleId}`);
    }
    return rows[0];
  }

  /** Satis tarihinde gecerli plan: effective_from <= sale_date, en yeni (SPEC 3.2 / T6). */
  private async resolvePlan(
    tx: Tx,
    tenantId: string,
    saleDate: Date,
  ): Promise<{ depth: number; levels: PlanLevelRate[] }> {
    const plan = await tx.commissionPlan.findFirst({
      where: { tenantId, effectiveFrom: { lte: saleDate } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: { levels: { orderBy: { level: 'asc' } } },
    });
    if (!plan) {
      throw new ConflictException(`satis tarihinde gecerli komisyon plani yok (tenant=${tenantId})`);
    }
    return {
      depth: plan.depth,
      levels: plan.levels.map((l) => ({ level: l.level, rateBps: l.rateBps })),
    };
  }

  /**
   * Saticidan yukari sponsor zinciri, en fazla depth eleman (SPEC 7 adim 3).
   * chain[0] = satici. Pasif uye MVP'de payini almaya devam eder — filtre yok;
   * compression tenant ayari semada var, varsayilan kapali.
   */
  private async uplineChain(tx: Tx, sellerMembershipId: string, depth: number): Promise<string[]> {
    const chain: string[] = [];
    let currentId: string | null = sellerMembershipId;
    for (let level = 0; level < depth && currentId; level++) {
      chain.push(currentId);
      const m: { sponsorMembershipId: string | null } | null = await tx.membership.findUnique({
        where: { id: currentId },
        select: { sponsorMembershipId: true },
      });
      if (!m) {
        throw new NotFoundException(`uyelik bulunamadi: ${currentId}`);
      }
      currentId = m.sponsorMembershipId;
    }
    return chain;
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
        // teslim edilene kadar matures_at bos; markDelivered doldurur, job olgunlastirir
        return { status: LedgerStatus.pending, maturesAt: sale.deliveredAt };
      case MaturationRule.days_after_approval: {
        const base = sale.approvedAt ?? new Date();
        const days = tenant.maturationDays ?? 0;
        return { status: LedgerStatus.pending, maturesAt: new Date(base.getTime() + days * 86_400_000) };
      }
    }
  }

  /**
   * monthly_summaries upsert — ayni transaction'da (SPEC 7 adim 5).
   * Raw ON CONFLICT: es zamanli iki transaction'in ayni satiri olusturma yarisini
   * Postgres atomik cozer (Prisma upsert'un P2002 yarisina karsi).
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
    const paid = delta.paid ?? 0n;
    await tx.$executeRaw`
      INSERT INTO monthly_summaries
        (id, tenant_id, membership_id, month, level, pending_cents, payable_cents, paid_cents, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${tenantId}::uuid, ${membershipId}::uuid, ${month}, ${level}, ${pending}, ${payable}, ${paid}, now(), now())
      ON CONFLICT (tenant_id, membership_id, month, level) DO UPDATE SET
        pending_cents = monthly_summaries.pending_cents + EXCLUDED.pending_cents,
        payable_cents = monthly_summaries.payable_cents + EXCLUDED.payable_cents,
        paid_cents    = monthly_summaries.paid_cents    + EXCLUDED.paid_cents,
        updated_at    = now()`;
  }

  /** Para etkileyen aksiyonlar audit log'a yazilir (SPEC 4.2 / 10). */
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
        entity: 'sale',
        entityId,
        before,
        after,
      },
    });
  }
}
