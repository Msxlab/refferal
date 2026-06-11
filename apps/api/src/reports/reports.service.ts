import { Injectable } from '@nestjs/common';
import { LedgerType, MembershipStatus, PayoutStatus, SaleStatus } from '@prisma/client';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admin dashboard (SPEC 9): ciro, komisyon, uye, payable — secili ay (varsayilan bu ay). */
  async dashboard(tenantId: string, month?: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const targetMonth = month ?? monthKey(new Date(), tenant.timezone);

    const [memberCount, activeCount, approvedAgg, salesCount] = await this.prisma.$transaction([
      this.prisma.membership.count({ where: { tenantId } }),
      this.prisma.membership.count({ where: { tenantId, status: MembershipStatus.active } }),
      this.prisma.sale.aggregate({
        where: { tenantId, status: SaleStatus.approved, summaryMonth: targetMonth },
        _sum: { amountCents: true },
      }),
      this.prisma.sale.count({ where: { tenantId, status: SaleStatus.approved, summaryMonth: targetMonth } }),
    ]);

    // bu ayin komisyon gideri: o aya ait commission ledger satirlari (pozitif)
    // ::bigint cast: SUM(bigint) Postgres'te numeric doner; Prisma raw onu string verir.
    const commissionRows = await this.prisma.$queryRaw<Array<{ sum: bigint }>>`
      SELECT COALESCE(SUM(le.amount_cents), 0)::bigint AS sum
      FROM ledger_entries le
      JOIN sales s ON s.id = le.sale_id
      WHERE le.tenant_id = ${tenantId}::uuid
        AND le.type = 'commission'
        AND COALESCE(s.summary_month, to_char(s.sale_date AT TIME ZONE ${tenant.timezone}, 'YYYY-MM')) = ${targetMonth}`;

    // toplam odenebilir bakiye (tum zamanlar, payable ledger neti)
    const payableRows = await this.prisma.$queryRaw<Array<{ sum: bigint }>>`
      SELECT COALESCE(SUM(amount_cents), 0)::bigint AS sum
      FROM ledger_entries
      WHERE tenant_id = ${tenantId}::uuid AND status = 'payable'`;

    const pendingRequests = await this.prisma.payout.count({
      where: { tenantId, status: PayoutStatus.requested },
    });

    const revenue = approvedAgg._sum.amountCents ?? 0n;
    const commission = commissionRows[0]?.sum ?? 0n;

    return {
      month: targetMonth,
      currency: tenant.currency,
      members: { total: memberCount, active: activeCount },
      thisMonth: {
        approvedSalesCount: salesCount,
        revenueCents: revenue.toString(),
        commissionCents: commission.toString(),
        // efektif komisyon orani (bps); ciro 0 ise 0
        effectiveRateBps: revenue > 0n ? Number((commission * 10000n) / revenue) : 0,
      },
      outstandingPayableCents: (payableRows[0]?.sum ?? 0n).toString(),
      pendingPayoutRequests: pendingRequests,
    };
  }

  /** Tenant audit log (SPEC 9). */
  async audit(tenantId: string, q: { page: number; pageSize: number }) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where: { tenantId } }),
      this.prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((a) => ({
        id: a.id,
        action: a.action,
        entity: a.entity,
        entityId: a.entityId,
        actorUserId: a.actorUserId,
        after: a.after,
        createdAt: a.createdAt,
      })),
    };
  }
}
