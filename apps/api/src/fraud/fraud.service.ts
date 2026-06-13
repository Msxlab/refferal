import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FraudStatus, Prisma } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { PrismaService } from '../prisma/prisma.service';
import { FRAUD_BLOCK_SCORE } from './fraud.types';

interface Signal { score: number; reason: string }

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Risk taramasi (saatlik). Mevcut veriden sinyaller uretir, uye basina skor toplar,
   * fraud_flags'i upsert eder. cleared bayrak yeniden tetiklenirse (skor >= BLOCK) acilir.
   */
  async scan(tenantId: string): Promise<{ flagged: number; blocked: number }> {
    const byMember = new Map<string, Signal[]>();
    const add = (id: string, s: Signal) => { const arr = byMember.get(id) ?? []; arr.push(s); byMember.set(id, arr); };

    // sinyal 1: yuksek void orani (>= %40, en az 3 satis)
    const statusRows = await this.prisma.sale.groupBy({ by: ['sellerMembershipId', 'status'], where: { tenantId }, _count: { _all: true } });
    const tally = new Map<string, { total: number; void: number }>();
    for (const r of statusRows) {
      const t = tally.get(r.sellerMembershipId) ?? { total: 0, void: 0 };
      t.total += r._count._all;
      if (r.status === 'void') t.void += r._count._all;
      tally.set(r.sellerMembershipId, t);
    }
    for (const [id, t] of tally) {
      if (t.total >= 3 && t.void / t.total >= 0.4) add(id, { score: 30, reason: `high_void_rate(${t.void}/${t.total})` });
    }

    // sinyal 2: anormal hizli uye kazanimi (son 7 gun >= 10)
    const since = new Date(Date.now() - 7 * 86_400_000);
    const recruits = await this.prisma.membership.groupBy({
      by: ['sponsorMembershipId'],
      where: { tenantId, joinedAt: { gte: since }, sponsorMembershipId: { not: null } },
      _count: { _all: true },
    });
    for (const r of recruits) {
      if (r.sponsorMembershipId && r._count._all >= 10) add(r.sponsorMembershipId, { score: 25, reason: `rapid_recruitment(${r._count._all}/7d)` });
    }

    // sinyal 3: self-referral (musteri ref == kendi referral kodu)
    const selfRows = await this.prisma.$queryRaw<Array<{ membershipId: string; c: bigint }>>`
      SELECT s.seller_membership_id AS "membershipId", count(*)::bigint AS c
      FROM sales s JOIN memberships m ON m.id = s.seller_membership_id
      WHERE s.tenant_id = ${tenantId}::uuid AND s.customer_ref IS NOT NULL
        AND lower(s.customer_ref) = lower(m.referral_code)
      GROUP BY s.seller_membership_id`;
    for (const r of selfRows) add(r.membershipId, { score: 40, reason: `self_referral(${Number(r.c)})` });

    // sinyal 4: sybil — ayni IP'den >= 3 uye kaydi (#16)
    const ipGroups = await this.prisma.membership.groupBy({
      by: ['signupIp'],
      where: { tenantId, signupIp: { not: null } },
      _count: { _all: true },
    });
    const sharedIps = ipGroups.filter((g) => g._count._all >= 3).map((g) => g.signupIp as string);
    if (sharedIps.length) {
      const shared = await this.prisma.membership.findMany({ where: { tenantId, signupIp: { in: sharedIps } }, select: { id: true } });
      for (const m of shared) add(m.id, { score: 35, reason: 'shared_signup_ip' });
    }

    // upsert: uye basina topla, mevcut bayragi koru (cleared → yeniden tetiklenirse ac)
    const existing = await this.prisma.fraudFlag.findMany({ where: { tenantId, membershipId: { in: [...byMember.keys()] } } });
    const existingById = new Map(existing.map((f) => [f.membershipId, f]));
    let blocked = 0;
    for (const [membershipId, signals] of byMember) {
      const score = signals.reduce((a, s) => a + s.score, 0);
      const reasons = signals.map((s) => s.reason);
      const prev = existingById.get(membershipId);
      let status: FraudStatus = prev?.status ?? FraudStatus.open;
      if (prev?.status === FraudStatus.cleared && score >= FRAUD_BLOCK_SCORE) status = FraudStatus.open; // yeniden ac
      if (score >= FRAUD_BLOCK_SCORE && status !== FraudStatus.cleared) blocked++;
      await this.prisma.fraudFlag.upsert({
        where: { membershipId },
        create: { tenantId, membershipId, score, reasons, status },
        update: { score, reasons, status },
      });
    }
    return { flagged: byMember.size, blocked };
  }

  /** Tum tenant'lar (scheduler). */
  async scanAll(): Promise<{ tenants: number; blocked: number }> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let blocked = 0;
    for (const t of tenants) {
      const r = await this.scan(t.id);
      blocked += r.blocked;
    }
    return { tenants: tenants.length, blocked };
  }

  async list(tenantId: string, status?: FraudStatus) {
    const rows = await this.prisma.fraudFlag.findMany({
      where: { tenantId, status },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      include: { membership: { select: { referralCode: true, user: { select: { fullName: true, email: true } } } } },
    });
    return rows.map((f) => ({
      membershipId: f.membershipId,
      fullName: f.membership.user.fullName,
      email: f.membership.user.email,
      referralCode: f.membership.referralCode,
      score: f.score,
      reasons: f.reasons,
      status: f.status,
      note: f.note,
      blocked: f.status !== FraudStatus.cleared && f.score >= FRAUD_BLOCK_SCORE,
      createdAt: f.createdAt,
    }));
  }

  async decide(actor: ActorContext, membershipId: string, action: 'clear' | 'confirm', note?: string) {
    const f = await this.prisma.fraudFlag.findUnique({ where: { membershipId } });
    if (!f || f.tenantId !== actor.tenantId) throw new NotFoundException('fraud bayragi bulunamadi');
    const status = action === 'clear' ? FraudStatus.cleared : FraudStatus.confirmed;
    await this.prisma.fraudFlag.update({
      where: { membershipId },
      data: { status, note, reviewedByUserId: actor.userId, reviewedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { tenantId: actor.tenantId, actorUserId: actor.userId, action: `fraud.${action}`, entity: 'security', entityId: membershipId, after: { score: f.score, note: note ?? null } as Prisma.InputJsonValue },
    });
    return { membershipId, status };
  }
}
