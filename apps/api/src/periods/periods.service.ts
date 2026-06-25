import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, SaleStatus } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { PrismaService } from '../prisma/prisma.service';

/** YYYY-MM bicim kontrolu. */
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface PeriodRow {
  period: string;
  locked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  note: string | null;
  revenueCents: string;
  pendingCents: string;
  payableCents: string;
  paidCents: string;
}

/**
 * Donem kilidi / muhasebe kapanisi (Dalga 3). Kilit varligi = o ay kapali; engine para
 * etkileyen yazimi reddeder (assertPeriodsOpen). Acmak = satiri sil (audit'li override).
 */
@Injectable()
export class PeriodsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Kapanis goruntusu: ledger/satis bulunan her ay + kilit durumu + finansal ozet. */
  async list(tenantId: string): Promise<{ rows: PeriodRow[] }> {
    const [locks, summ, sales] = await Promise.all([
      this.prisma.periodLock.findMany({ where: { tenantId } }),
      this.prisma.monthlySummary.groupBy({
        by: ['month'],
        where: { tenantId },
        _sum: { pendingCents: true, payableCents: true, paidCents: true },
      }),
      this.prisma.sale.groupBy({
        by: ['summaryMonth'],
        where: { tenantId, status: SaleStatus.approved, summaryMonth: { not: null } },
        _sum: { amountCents: true },
      }),
    ]);

    const lockByPeriod = new Map(locks.map((l) => [l.period, l]));
    const lockerIds = [...new Set(locks.map((l) => l.lockedByUserId).filter((x): x is string => !!x))];
    const users = lockerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: lockerIds } }, select: { id: true, fullName: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));

    const revByMonth = new Map(sales.map((s) => [s.summaryMonth as string, s._sum.amountCents ?? 0n]));
    const periods = new Set<string>([...summ.map((s) => s.month), ...revByMonth.keys(), ...lockByPeriod.keys()]);

    const rows: PeriodRow[] = [...periods]
      .sort((a, b) => (a < b ? 1 : -1))
      .map((period) => {
        const s = summ.find((x) => x.month === period);
        const lock = lockByPeriod.get(period);
        return {
          period,
          locked: !!lock,
          lockedAt: lock?.createdAt.toISOString() ?? null,
          lockedBy: lock?.lockedByUserId ? (nameById.get(lock.lockedByUserId) ?? null) : null,
          note: lock?.note ?? null,
          revenueCents: (revByMonth.get(period) ?? 0n).toString(),
          pendingCents: (s?._sum.pendingCents ?? 0n).toString(),
          payableCents: (s?._sum.payableCents ?? 0n).toString(),
          paidCents: (s?._sum.paidCents ?? 0n).toString(),
        };
      });

    return { rows };
  }

  async isLocked(tenantId: string, period: string): Promise<boolean> {
    const lock = await this.prisma.periodLock.findUnique({ where: { tenantId_period: { tenantId, period } } });
    return !!lock;
  }

  /** Donemi kilitle (idempotent). Bekleyen (pending) komisyon varsa uyari dondurur ama yine kilitler. */
  async lock(actor: ActorContext, period: string, note?: string): Promise<{ period: string; locked: true; warning?: string }> {
    this.assertPeriodFormat(period);
    // TOCTOU kapanisi: kilit yazimini, engine/payout para-yazim tx'leriyle AYNI (tenant, period)
    // advisory kilidi altinda yap. Boylece in-flight bir motor yazimi assertPeriodsOpen'da bu
    // anahtari beklemis olur; kilit ya o yazimdan once ya da sonra atomik gorulur, arada kalan
    // pencere kalkar. $transaction sart: pg_advisory_xact_lock yalniz tx sonuna kadar tutulur.
    const existed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.tenantId}), hashtext(${period}))`;
      // relock tespiti: zaten kilitliyse upsert orijinal lockedByUserId/createdAt'i korur (create dalı çalışmaz)
      const prior = await tx.periodLock.findUnique({
        where: { tenantId_period: { tenantId: actor.tenantId, period } },
        select: { lockedByUserId: true, createdAt: true },
      });
      await tx.periodLock.upsert({
        where: { tenantId_period: { tenantId: actor.tenantId, period } },
        create: { tenantId: actor.tenantId, period, lockedByUserId: actor.userId, note },
        update: { note },
      });
      return prior;
    });
    // Zaten kilitliyse audit'i yeni aktore 'period.lock' diye yazmak yanıltıcı olur — 'period.relock'
    // olarak işle ve orijinal kilitleyeni/zamanı koru.
    await this.audit(
      actor,
      existed ? 'period.relock' : 'period.lock',
      period,
      existed
        ? {
            note: note ?? null,
            originalLockedByUserId: existed.lockedByUserId,
            originalLockedAt: existed.createdAt.toISOString(),
          }
        : { note: note ?? null },
    );

    const pending = await this.prisma.monthlySummary.aggregate({
      where: { tenantId: actor.tenantId, month: period },
      _sum: { pendingCents: true },
    });
    const pend = pending._sum.pendingCents ?? 0n;
    return { period, locked: true, ...(pend > 0n ? { warning: `bu ayda ${pend.toString()} cent bekleyen (pending) komisyon var` } : {}) };
  }

  /** Kilidi ac (muhasebe override) — audit'li. */
  async unlock(actor: ActorContext, period: string): Promise<{ period: string; locked: false }> {
    this.assertPeriodFormat(period);
    // lock() ile simetri: kilit silmeyi de ayni advisory anahtari altinda yap ki acilis ile
    // in-flight okuma seri kalsin (acilmis bir donemi okuyan yazim tutarli gorur).
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.tenantId}), hashtext(${period}))`;
      await tx.periodLock.deleteMany({ where: { tenantId: actor.tenantId, period } });
    });
    await this.audit(actor, 'period.unlock', period, {});
    return { period, locked: false };
  }

  private assertPeriodFormat(period: string): void {
    if (!PERIOD_RE.test(period)) {
      throw new BadRequestException('gecersiz donem bicimi (YYYY-MM olmali)');
    }
  }

  private async audit(actor: ActorContext, action: string, period: string, after: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action,
        entity: 'period',
        after: { period, ...(after as object) } as Prisma.InputJsonValue,
      },
    });
  }
}
