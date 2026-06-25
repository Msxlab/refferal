import { Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, SaleStatus, TenantStatus } from '@prisma/client';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';

/** Kiracci-ustu platform yuzeyi (Axtra): sirketleri (tenant) yonet, agina drill-in. */
@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sirketler dizini + her sirket icin KPI (uye, aktif, bu-ay ciro, durum). */
  async companies() {
    const tenants = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });

    // tek seferde uye sayilari (toplam + aktif)
    const [byTenant, activeByTenant] = await Promise.all([
      this.prisma.membership.groupBy({ by: ['tenantId'], _count: { _all: true } }),
      this.prisma.membership.groupBy({
        by: ['tenantId'],
        where: { status: MembershipStatus.active },
        _count: { _all: true },
      }),
    ]);
    const total = new Map(byTenant.map((r) => [r.tenantId, r._count._all]));
    const active = new Map(activeByTenant.map((r) => [r.tenantId, r._count._all]));

    // ciro: her sirketin kendi timezone'undaki bu ay (az sayida tenant — dongu kabul edilebilir)
    const revenues = await Promise.all(
      tenants.map((t) =>
        this.prisma.sale
          .aggregate({
            where: { tenantId: t.id, status: SaleStatus.approved, summaryMonth: monthKey(new Date(), t.timezone) },
            _sum: { amountCents: true },
            _count: { _all: true },
          })
          .then((a) => ({ id: t.id, revenue: a._sum.amountCents ?? 0n, sales: a._count._all })),
      ),
    );
    const revMap = new Map(revenues.map((r) => [r.id, r]));

    return tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      currency: t.currency,
      status: t.status,
      timezone: t.timezone,
      members: total.get(t.id) ?? 0,
      activeMembers: active.get(t.id) ?? 0,
      revenueThisMonthCents: (revMap.get(t.id)?.revenue ?? 0n).toString(),
      salesThisMonth: revMap.get(t.id)?.sales ?? 0,
      createdAt: t.createdAt,
    }));
  }

  /** Tek sirket ozeti (KPI + aktif plan + ayar ozeti). */
  async company(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('sirket bulunamadi');

    const month = monthKey(new Date(), t.timezone);
    const [members, activeMembers, rev, plan, payable] = await Promise.all([
      this.prisma.membership.count({ where: { tenantId: id } }),
      this.prisma.membership.count({ where: { tenantId: id, status: MembershipStatus.active } }),
      this.prisma.sale.aggregate({
        where: { tenantId: id, status: SaleStatus.approved, summaryMonth: month },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.commissionPlan.findFirst({
        where: { tenantId: id, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: 'desc' },
        select: { name: true, poolRateBps: true, depth: true },
      }),
      this.prisma.ledgerEntry.aggregate({ where: { tenantId: id, status: 'payable' }, _sum: { amountCents: true } }),
    ]);

    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      currency: t.currency,
      timezone: t.timezone,
      status: t.status,
      branding: t.branding,
      payoutMinCents: t.payoutMinCents.toString(),
      maturationRule: t.maturationRule,
      createdAt: t.createdAt,
      kpis: {
        members,
        activeMembers,
        revenueThisMonthCents: (rev._sum.amountCents ?? 0n).toString(),
        salesThisMonth: rev._count._all,
        outstandingPayableCents: (payable._sum.amountCents ?? 0n).toString(),
      },
      plan: plan ? { name: plan.name, poolRateBps: plan.poolRateBps, depth: plan.depth } : null,
    };
  }

  /** Sirketin uye agi (flat node listesi — Ağaç/Liste gorunumu icin). */
  async network(id: string) {
    const exists = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('sirket bulunamadi');

    const nodes = await this.prisma.membership.findMany({
      where: { tenantId: id },
      orderBy: [{ depth: 'asc' }, { joinedAt: 'asc' }],
      include: { user: { select: { fullName: true } } },
    });
    return nodes.map((m) => ({
      id: m.id,
      parentId: m.sponsorMembershipId,
      fullName: m.user.fullName,
      referralCode: m.referralCode,
      role: m.role,
      status: m.status,
      depth: m.depth,
    }));
  }

  async setStatus(id: string, status: TenantStatus, actorUserId: string, reason?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('sirket bulunamadi');
    if (tenant.status === status) return { id, status, revokedSessions: 0 };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenant.update({ where: { id }, data: { status } });
      const users = await tx.membership.findMany({ where: { tenantId: id }, select: { userId: true } });
      const revoked =
        status === TenantStatus.suspended
          ? await tx.refreshToken.updateMany({
              where: { userId: { in: [...new Set(users.map((u) => u.userId))] }, revokedAt: null },
              data: { revokedAt: new Date() },
            })
          : { count: 0 };
      await tx.auditLog.create({
        data: {
          tenantId: id,
          actorUserId,
          action: status === TenantStatus.suspended ? 'tenant.suspend' : 'tenant.reactivate',
          entity: 'tenant',
          entityId: id,
          before: { status: tenant.status },
          after: { status: updated.status, reason: reason ?? null, revokedSessions: revoked.count },
        },
      });
      return { id, status: updated.status, revokedSessions: revoked.count };
    });
  }
}
