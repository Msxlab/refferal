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

  /**
   * Dashboard analitik (zaman serisi + donem karsilastirma + huni + top performers).
   * Komisyon zaman serisi monthly_summaries'ten (net: reversal'lar bucket'i dusurur).
   * Ciro/sayim approved sales'in DONDURULMUS summary_month'una gore — dashboard ile tutarli.
   */
  async analytics(tenantId: string, months: number) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const anchor = monthKey(new Date(), tenant.timezone);
    const range = this.monthsBack(anchor, months, 0);
    const prevRange = this.monthsBack(anchor, months, months);
    const rangeStart = new Date(`${range[0]}-01T00:00:00.000Z`);

    // Promise.all (transaction degil): salt-okunur dashboard anlik goruntusu, groupBy tiplerini korur
    const [revByMonth, comByMonth, prevRev, prevCom, funnelRows, topRows] = await Promise.all([
      // ciro + onayli satis sayisi (ay basina)
      this.prisma.sale.groupBy({
        by: ['summaryMonth'],
        where: { tenantId, status: SaleStatus.approved, summaryMonth: { in: range } },
        _sum: { amountCents: true },
        _count: { _all: true },
        orderBy: { summaryMonth: 'asc' },
      }),
      // komisyon (ay basina, net) — monthly_summaries
      this.prisma.monthlySummary.groupBy({
        by: ['month'],
        where: { tenantId, month: { in: range } },
        _sum: { pendingCents: true, payableCents: true, paidCents: true },
        orderBy: { month: 'asc' },
      }),
      // onceki esit-uzunluktaki donem (karsilastirma)
      this.prisma.sale.aggregate({
        where: { tenantId, status: SaleStatus.approved, summaryMonth: { in: prevRange } },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.monthlySummary.aggregate({
        where: { tenantId, month: { in: prevRange } },
        _sum: { pendingCents: true, payableCents: true, paidCents: true },
      }),
      // huni: durum dagilimi (secili pencere, sale_date'e gore)
      this.prisma.sale.groupBy({
        by: ['status'],
        where: { tenantId, saleDate: { gte: rangeStart } },
        _sum: { amountCents: true },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
      // top performers: onayli ciroya gore en iyi saticilar
      this.prisma.sale.groupBy({
        by: ['sellerMembershipId'],
        where: { tenantId, status: SaleStatus.approved, summaryMonth: { in: range } },
        _sum: { amountCents: true },
        _count: { _all: true },
        orderBy: { _sum: { amountCents: 'desc' } },
        take: 8,
      }),
    ]);

    const revMap = new Map(revByMonth.map((r) => [r.summaryMonth ?? '', r]));
    const comMap = new Map(
      comByMonth.map((c) => [
        c.month,
        (c._sum.pendingCents ?? 0n) + (c._sum.payableCents ?? 0n) + (c._sum.paidCents ?? 0n),
      ]),
    );
    const series = range.map((m) => {
      const rev = revMap.get(m)?._sum.amountCents ?? 0n;
      return {
        month: m,
        revenueCents: rev.toString(),
        commissionCents: (comMap.get(m) ?? 0n).toString(),
        approvedSales: revMap.get(m)?._count._all ?? 0,
      };
    });

    const sum = (arr: bigint[]) => arr.reduce((a, b) => a + b, 0n);
    const revenue = sum(series.map((s) => BigInt(s.revenueCents)));
    const commission = sum(series.map((s) => BigInt(s.commissionCents)));
    const approvedSales = series.reduce((a, s) => a + s.approvedSales, 0);

    const prevRevenue = prevRev._sum.amountCents ?? 0n;
    const prevCommission =
      (prevCom._sum.pendingCents ?? 0n) + (prevCom._sum.payableCents ?? 0n) + (prevCom._sum.paidCents ?? 0n);
    const prevSales = prevRev._count._all;

    const pct = (cur: bigint, prev: bigint): number | null =>
      prev === 0n ? (cur > 0n ? null : 0) : Math.round((Number(cur - prev) / Number(prev)) * 1000) / 10;
    const pctN = (cur: number, prev: number): number | null =>
      prev === 0 ? (cur > 0 ? null : 0) : Math.round(((cur - prev) / prev) * 1000) / 10;

    // top performers isim/kod ile zenginlestir
    const sellerIds = topRows.map((t) => t.sellerMembershipId);
    const sellers = await this.prisma.membership.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, referralCode: true, user: { select: { fullName: true } } },
    });
    const sellerMap = new Map(sellers.map((s) => [s.id, s]));
    const topPerformers = topRows.map((t) => ({
      membershipId: t.sellerMembershipId,
      fullName: sellerMap.get(t.sellerMembershipId)?.user.fullName ?? '—',
      referralCode: sellerMap.get(t.sellerMembershipId)?.referralCode ?? '',
      revenueCents: (t._sum.amountCents ?? 0n).toString(),
      salesCount: t._count._all,
    }));

    const funnelOf = (status: SaleStatus) => {
      const r = funnelRows.find((f) => f.status === status);
      return { count: r?._count._all ?? 0, amountCents: (r?._sum.amountCents ?? 0n).toString() };
    };

    return {
      currency: tenant.currency,
      range: { months, from: range[0], to: range[range.length - 1] },
      series,
      totals: {
        revenueCents: revenue.toString(),
        commissionCents: commission.toString(),
        approvedSales,
        effectiveRateBps: revenue > 0n ? Number((commission * 10000n) / revenue) : 0,
      },
      previous: {
        revenueCents: prevRevenue.toString(),
        commissionCents: prevCommission.toString(),
        approvedSales: prevSales,
      },
      deltas: {
        revenuePct: pct(revenue, prevRevenue),
        commissionPct: pct(commission, prevCommission),
        salesPct: pctN(approvedSales, prevSales),
      },
      funnel: {
        draft: funnelOf(SaleStatus.draft),
        approved: funnelOf(SaleStatus.approved),
        void: funnelOf(SaleStatus.void),
      },
      topPerformers,
    };
  }

  /** anchor ('YYYY-MM') dahil, skip kadar oncesinden baslayarak n ayin anahtarlari (eskiden yeniye). */
  private monthsBack(anchor: string, n: number, skip: number): string[] {
    const [y, m] = anchor.split('-').map(Number);
    const out: string[] = [];
    for (let i = n - 1 + skip; i >= skip; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return out;
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
        before: a.before,
        after: a.after,
        ip: a.ip,
        createdAt: a.createdAt,
      })),
    };
  }
}
