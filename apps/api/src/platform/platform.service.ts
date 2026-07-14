import { Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Prisma, SaleStatus, TenantStatus } from '@prisma/client';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';

type CurrencyRevenue = { currency: string; revenueCents: bigint; sales: number };
type CurrencyAmount = { currency: string; amountCents: bigint };

function serializeCurrencyRevenue(rows: readonly CurrencyRevenue[]) {
  return [...rows]
    .sort((left, right) => left.currency.localeCompare(right.currency))
    .map((row) => ({
      currency: row.currency,
      revenueThisMonthCents: row.revenueCents.toString(),
      salesThisMonth: row.sales,
    }));
}

function serializeOutstandingPayable(rows: readonly CurrencyAmount[]) {
  return [...rows]
    .sort((left, right) => left.currency.localeCompare(right.currency))
    .map((row) => ({ currency: row.currency, outstandingPayableCents: row.amountCents.toString() }));
}

/** Cross-tenant platform surface: manage companies and drill into their networks. */
@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  /** Company directory with KPI rollups for members, active members, current-month revenue, and status. */
  async companies() {
    const tenants = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });

    // Fetch member counts once for all companies.
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

    // Revenue for each company's current month in its own timezone. The tenant count is expected to stay small here.
    const revenues = await Promise.all(
      tenants.map((t) =>
        this.prisma.sale
          .groupBy({
            by: ['currency'],
            where: { tenantId: t.id, status: SaleStatus.approved, summaryMonth: monthKey(new Date(), t.timezone) },
            _sum: { amountCents: true },
            _count: { _all: true },
          })
          .then((rows) => ({
            id: t.id,
            rows: rows.map((row) => ({
              currency: row.currency,
              revenueCents: row._sum.amountCents ?? 0n,
              sales: row._count._all,
            })),
          })),
      ),
    );
    const revMap = new Map(revenues.map((r) => [r.id, r]));

    const companies = tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      currency: t.currency,
      status: t.status,
      timezone: t.timezone,
      members: total.get(t.id) ?? 0,
      activeMembers: active.get(t.id) ?? 0,
      revenueThisMonthByCurrency: serializeCurrencyRevenue(revMap.get(t.id)?.rows ?? []),
      salesThisMonth: (revMap.get(t.id)?.rows ?? []).reduce((count, row) => count + row.sales, 0),
      createdAt: t.createdAt,
    }));

    const revenueThisMonthByCurrency = new Map<string, { revenueCents: bigint; sales: number }>();
    for (const revenue of revenues) {
      for (const row of revenue.rows) {
        const current = revenueThisMonthByCurrency.get(row.currency) ?? { revenueCents: 0n, sales: 0 };
        current.revenueCents += row.revenueCents;
        current.sales += row.sales;
        revenueThisMonthByCurrency.set(row.currency, current);
      }
    }

    return {
      companies,
      totals: {
        companies: companies.length,
        members: companies.reduce((count, company) => count + company.members, 0),
        activeMembers: companies.reduce((count, company) => count + company.activeMembers, 0),
        revenueThisMonthByCurrency: serializeCurrencyRevenue(
          [...revenueThisMonthByCurrency.entries()].map(([currency, revenue]) => ({ currency, ...revenue })),
        ),
      },
    };
  }

  /** Single-company summary with KPIs, active plan, and settings summary. */
  async company(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('company not found');

    const month = monthKey(new Date(), t.timezone);
    const [members, activeMembers, revenueRows, plan, payableRows] = await Promise.all([
      this.prisma.membership.count({ where: { tenantId: id } }),
      this.prisma.membership.count({ where: { tenantId: id, status: MembershipStatus.active } }),
      this.prisma.sale.groupBy({
        by: ['currency'],
        where: { tenantId: id, status: SaleStatus.approved, summaryMonth: month },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.commissionPlan.findFirst({
        where: { tenantId: id, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: 'desc' },
        select: { name: true, poolRateBps: true, depth: true },
      }),
      this.prisma.$queryRaw<CurrencyAmount[]>`
        SELECT s.currency AS "currency", SUM(le.amount_cents)::bigint AS "amountCents"
        FROM ledger_entries le
        JOIN sales s ON s.id = le.sale_id
        WHERE le.tenant_id = ${id}::uuid
          AND le.status = 'payable'
        GROUP BY s.currency
        ORDER BY s.currency`,
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
        revenueThisMonthByCurrency: serializeCurrencyRevenue(
          revenueRows.map((row) => ({
            currency: row.currency,
            revenueCents: row._sum.amountCents ?? 0n,
            sales: row._count._all,
          })),
        ),
        salesThisMonth: revenueRows.reduce((count, row) => count + row._count._all, 0),
        outstandingPayableByCurrency: serializeOutstandingPayable(payableRows),
      },
      plan: plan ? { name: plan.name, poolRateBps: plan.poolRateBps, depth: plan.depth } : null,
    };
  }

  /** Company member network as a flat node list for tree/list views. */
  async network(id: string) {
    const exists = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('company not found');

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
    if (!tenant) throw new NotFoundException('company not found');
    if (tenant.status === status) return { id, status, revokedSessions: 0 };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenant.update({ where: { id }, data: { status } });
      const users = await tx.membership.findMany({ where: { tenantId: id }, select: { userId: true } });
      const userIds = [...new Set(users.map((user) => user.userId))].sort();
      const revoked =
        status === TenantStatus.suspended
          ? await this.invalidateSuspendedTenantSessions(tx, userIds)
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

  private async invalidateSuspendedTenantSessions(tx: Prisma.TransactionClient, userIds: string[]) {
    if (userIds.length === 0) return { count: 0 };
    await tx.$queryRaw`
      SELECT "id" FROM "users"
      WHERE "id" IN (${Prisma.join(userIds.map((userId) => Prisma.sql`${userId}::uuid`))})
      ORDER BY "id" FOR UPDATE
    `;
    await tx.user.updateMany({
      where: { id: { in: userIds } },
      data: { authGeneration: { increment: 1 } },
    });
    return tx.refreshToken.updateMany({
      where: { userId: { in: userIds }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
