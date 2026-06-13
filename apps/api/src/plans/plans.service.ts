import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { commissionPlanSchema, computeCommissionLines, PlanLevelRate } from '@refearn/shared';
import { ActorContext } from '../common/actor';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanInput, SimulatePlanInput } from './plans.types';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  /** Satis tarihinde aktif plan: effective_from <= at, en yeni (engine ile ayni secim). */
  private activePlan(tenantId: string, at: Date = new Date()) {
    return this.prisma.commissionPlan.findFirst({
      where: { tenantId, effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: { levels: { orderBy: { level: 'asc' } } },
    });
  }

  /** Tum plan versiyonlari + hangisi su an aktif. */
  async list(tenantId: string) {
    const [plans, active] = await Promise.all([
      this.prisma.commissionPlan.findMany({
        where: { tenantId },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        include: { levels: { orderBy: { level: 'asc' } } },
      }),
      this.activePlan(tenantId),
    ]);
    return {
      activeId: active?.id ?? null,
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        poolRateBps: p.poolRateBps,
        depth: p.depth,
        fastStartBps: p.fastStartBps,
        fastStartDays: p.fastStartDays,
        matchingBps: p.matchingBps,
        effectiveFrom: p.effectiveFrom,
        active: p.id === active?.id,
        levels: p.levels.map((l) => ({ level: l.level, rateBps: l.rateBps })),
      })),
    };
  }

  /**
   * Komisyon simulatoru (Dalga 2.3): bir tutar icin aktif planin seviye seviye dagilimini gosterir.
   * sellerMembershipId verilirse upline zinciri cozulur (kime ne gider); yoksa eksik seviyeler
   * "sirkette kalir" olarak isaretlenir. computeCommissionLines (saf cekirdek) ile motorla ayni hesap.
   */
  async simulate(tenantId: string, input: SimulatePlanInput) {
    const plan = await this.activePlan(tenantId);
    if (!plan) throw new BadRequestException('aktif komisyon plani yok');
    const levels: PlanLevelRate[] = plan.levels.map((l) => ({ level: l.level, rateBps: l.rateBps }));
    const amount = BigInt(Math.round(input.amountCents));

    const chain: string[] = [];
    const nameById = new Map<string, { name: string; code: string }>();
    if (input.sellerMembershipId) {
      type Row = { id: string; sponsorMembershipId: string | null; referralCode: string; user: { fullName: string } };
      let cur: Row | null = await this.prisma.membership.findFirst({
        where: { id: input.sellerMembershipId, tenantId },
        select: { id: true, sponsorMembershipId: true, referralCode: true, user: { select: { fullName: true } } },
      });
      let guard = 0;
      while (cur && chain.length < plan.depth && guard++ < 64) {
        chain.push(cur.id);
        nameById.set(cur.id, { name: cur.user.fullName, code: cur.referralCode });
        cur = cur.sponsorMembershipId
          ? await this.prisma.membership.findFirst({
              where: { id: cur.sponsorMembershipId },
              select: { id: true, sponsorMembershipId: true, referralCode: true, user: { select: { fullName: true } } },
            })
          : null;
      }
    }

    const lines = computeCommissionLines(amount, levels, chain);
    const byLevel = new Map(lines.map((l) => [l.level, l]));
    const noSeller = !input.sellerMembershipId; // satici yoksa: editor onizlemesi -> tam merdiven
    const rows = levels.map((l) => {
      const line = byLevel.get(l.level);
      const filledId = chain[l.level];
      // satici verildiyse gercek (upline yoksa 0 + sirkette); verilmediyse hipotetik tam merdiven
      const amt = noSeller ? (amount * BigInt(l.rateBps)) / 10000n : line?.amountCents ?? 0n;
      return {
        level: l.level,
        rateBps: l.rateBps,
        amountCents: amt.toString(),
        beneficiary: filledId ? nameById.get(filledId) ?? null : null,
        // satici verildiyse ve o seviyede upline yoksa pay sirkette kalir (SPEC 3.3)
        retainedByCompany: !noSeller && !filledId,
      };
    });
    const distributed = noSeller
      ? rows.reduce((a, r) => a + BigInt(r.amountCents), 0n)
      : lines.reduce((a, l) => a + l.amountCents, 0n);
    return {
      planName: plan.name,
      poolRateBps: plan.poolRateBps,
      depth: plan.depth,
      amountCents: amount.toString(),
      levels: rows,
      distributedCents: distributed.toString(),
      companyKeepsCents: (amount - distributed).toString(),
    };
  }

  /**
   * Yeni plan versiyonu olusturur (Dalga 2.4). Mevcut plan DEGISTIRILMEZ — yeni satir INSERT edilir
   * (tarihsel butunluk: gecmis satislar kendi tarihindeki planla hesaplanmis kalir). effective_from
   * ileri/su-an tarihli; engine bu tarihten itibaren yeni plani kullanir.
   */
  async createVersion(actor: ActorContext, input: CreatePlanInput) {
    // Derin capraz kurallar (level 0 zorunlu, 0..depth-1 bossuz, SUM<=pool) shared semasiyla.
    const parsed = commissionPlanSchema.safeParse({
      name: input.name,
      poolRateBps: input.poolRateBps,
      depth: input.depth,
      levels: input.levels,
    });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'gecersiz plan');
    }
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();

    const plan = await this.prisma.commissionPlan.create({
      data: {
        tenantId: actor.tenantId,
        name: parsed.data.name,
        poolRateBps: parsed.data.poolRateBps,
        depth: parsed.data.depth,
        fastStartBps: input.fastStartBps ?? 0,
        fastStartDays: input.fastStartDays ?? 0,
        matchingBps: input.matchingBps ?? 0,
        effectiveFrom,
        createdBy: actor.userId,
        levels: { create: parsed.data.levels.map((l) => ({ level: l.level, rateBps: l.rateBps })) },
      },
    });
    await this.prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'plan.create_version',
        entity: 'commission_plan',
        entityId: plan.id,
        after: { name: parsed.data.name, poolRateBps: parsed.data.poolRateBps, depth: parsed.data.depth, effectiveFrom: effectiveFrom.toISOString() } as Prisma.InputJsonValue,
      },
    });
    return { id: plan.id, effectiveFrom };
  }
}
