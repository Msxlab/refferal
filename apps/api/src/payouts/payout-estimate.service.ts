import { Injectable, Logger } from '@nestjs/common';
import { LedgerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeEstimateDate } from './payout-estimate.logic';

/** PrismaService veya transaction client — ikisi de model delegate'lerini saglar. */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * Tahmini odeme tarihini hesaplar (saf cekirdek) ve Membership'e yazar.
 * Salt-okunur: ledger/tenant okur, yalniz Membership'e iki turetilmis alan yazar.
 * Para kovalari/payout/period-lock'a DOKUNMAZ.
 */
@Injectable()
export class PayoutEstimateService {
  private readonly logger = new Logger(PayoutEstimateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Tek uye icin tarihi hesaplar (yazmaz). */
  async compute(membershipId: string): Promise<Date | null> {
    return this.loadAndCompute(this.prisma, membershipId);
  }

  /** Verilen uyeler icin hesaplayip Membership alanlarini gunceller (idempotent). */
  async refreshForMemberships(membershipIds: string[]): Promise<void> {
    for (const id of membershipIds) {
      const date = await this.loadAndCompute(this.prisma, id);
      await this.prisma.membership.update({
        where: { id },
        data: { estimatedPayoutDate: date, estimatedPayoutAt: new Date() },
      });
    }
  }

  /**
   * Gunluk tam tarama: pending/payable bakiyesi olan TUM uyeleri yeniden hesaplar.
   * pg_try_advisory_xact_lock ile tek-instance (alinamazsa atla — idempotent ama gereksiz isi onler).
   * Olcek notu: cok buyuk uye sayilarinda chunk'lara bolun; mevcut olcek tek tx'e sigar.
   */
  async sweepEstimates(): Promise<{ swept: number; skipped: boolean }> {
    return this.prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext('payout-estimate'), hashtext('sweep')) AS locked`;
        if (!locked) {
          this.logger.debug('payout-estimate sweep atlandi (baska instance calisiyor)');
          return { swept: 0, skipped: true };
        }
        const rows = await tx.ledgerEntry.findMany({
          where: { status: { in: [LedgerStatus.pending, LedgerStatus.payable] } },
          distinct: ['beneficiaryMembershipId'],
          select: { beneficiaryMembershipId: true },
        });
        const now = new Date();
        for (const r of rows) {
          const date = await this.loadAndCompute(tx, r.beneficiaryMembershipId);
          await tx.membership.update({
            where: { id: r.beneficiaryMembershipId },
            data: { estimatedPayoutDate: date, estimatedPayoutAt: now },
          });
        }
        return { swept: rows.length, skipped: false };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  }

  /** Bir uye icin tenant esigi + payable + pending'i okuyup saf cekirdegi cagirir. */
  private async loadAndCompute(db: Db, membershipId: string): Promise<Date | null> {
    const membership = await db.membership.findUniqueOrThrow({
      where: { id: membershipId },
      select: { tenant: { select: { payoutMinCents: true, timezone: true } } },
    });
    const [payableAgg, pending] = await Promise.all([
      db.ledgerEntry.aggregate({
        where: { beneficiaryMembershipId: membershipId, status: LedgerStatus.payable },
        _sum: { amountCents: true },
      }),
      db.ledgerEntry.findMany({
        where: { beneficiaryMembershipId: membershipId, status: LedgerStatus.pending, maturesAt: { not: null } },
        select: { amountCents: true, maturesAt: true },
        orderBy: { maturesAt: 'asc' },
      }),
    ]);
    return computeEstimateDate({
      payableCents: payableAgg._sum.amountCents ?? 0n,
      payoutMinCents: membership.tenant.payoutMinCents,
      pending: pending.map((p) => ({ amountCents: p.amountCents, maturesAt: p.maturesAt as Date })),
      now: new Date(),
      timezone: membership.tenant.timezone,
    });
  }
}
