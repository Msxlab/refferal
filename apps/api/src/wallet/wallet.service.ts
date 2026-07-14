import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerStatus, LedgerType, PayoutStatus } from '@prisma/client';
import { publicBrandFromTenant } from '../common/branding';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';

type PayoutEligibilityReason =
  | 'eligible'
  | 'no_payable'
  | 'below_threshold'
  | 'email_unverified'
  | 'requested'
  | 'processing';

function payoutEligibilityMessage(reason: PayoutEligibilityReason) {
  switch (reason) {
    case 'eligible':
      return 'Payable balance is eligible for a payout request.';
    case 'no_payable':
      return 'No payable balance is available.';
    case 'below_threshold':
      return 'Payable balance is below the payout minimum.';
    case 'email_unverified':
      return 'Verify your email address before requesting a payout.';
    case 'requested':
      return 'A payout request is already open.';
    case 'processing':
      return 'A payout is already processing.';
  }
}

function payoutEligibilityReason(input: {
  emailVerified: boolean;
  activePayoutStatus: PayoutStatus | null;
  payableCents: bigint;
  payoutMinCents: bigint;
}): PayoutEligibilityReason {
  if (!input.emailVerified) return 'email_unverified';
  if (input.activePayoutStatus === PayoutStatus.processing) return 'processing';
  if (input.activePayoutStatus === PayoutStatus.requested) return 'requested';
  if (input.payableCents <= 0n) return 'no_payable';
  if (input.payableCents < input.payoutMinCents) return 'below_threshold';
  return 'eligible';
}

/**
 * Member wallet and summary services (SPEC 8/9). PRIVACY: downline data is aggregate-only
 * (counts plus the caller's own ledger); individual name-to-sale matching is never returned to members.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async brand(tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true, branding: true },
    });
    return publicBrandFromTenant(tenant);
  }

  /** Balance is the payable total. Processing funds are visible but non-withdrawable. */
  async wallet(membershipId: string, tenantId: string, q: { page: number; pageSize: number }) {
    this.tenantContext.assertTenant(tenantId);
    this.tenantContext.assertMembership(membershipId);
    const [tenant, membership, grouped] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true, payoutMinCents: true, timezone: true },
      }),
      this.prisma.membership.findFirst({
        where: { id: membershipId, tenantId },
        select: { user: { select: { emailVerifiedAt: true } } },
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['status'],
        where: { tenantId, beneficiaryMembershipId: membershipId, status: { not: LedgerStatus.reversed } },
        _sum: { amountCents: true },
      }),
    ]);
    if (!membership) throw new NotFoundException('membership not found');

    const bucket = (s: LedgerStatus) => grouped.find((g) => g.status === s)?._sum.amountCents ?? 0n;
    const payableCents = bucket(LedgerStatus.payable);
    const period = monthKey(new Date(), tenant.timezone);
    const activePayouts = await this.prisma.payout.findMany({
      where: {
        tenantId,
        membershipId,
        period,
        status: { in: [PayoutStatus.requested, PayoutStatus.processing] },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true },
    });
    // Match requestPayout's preference when historical corruption leaves multiple active rows.
    const activePayout = activePayouts.find((payout) => payout.status === PayoutStatus.processing) ?? activePayouts[0] ?? null;
    const eligibilityReason = payoutEligibilityReason({
      emailVerified: membership.user.emailVerifiedAt !== null,
      activePayoutStatus: activePayout?.status ?? null,
      payableCents,
      payoutMinCents: tenant.payoutMinCents,
    });

    const [total, entries] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.count({ where: { tenantId, beneficiaryMembershipId: membershipId } }),
      this.prisma.ledgerEntry.findMany({
        where: { tenantId, beneficiaryMembershipId: membershipId },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          saleId: true,
          level: true,
          rateBpsUsed: true,
          amountCents: true,
          type: true,
          status: true,
          maturesAt: true,
          payoutId: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      currency: tenant.currency,
      payoutMinCents: tenant.payoutMinCents.toString(),
      payoutEligibility: {
        requestable: eligibilityReason === 'eligible',
        reason: eligibilityReason,
        message: payoutEligibilityMessage(eligibilityReason),
        activePayout: activePayout ? { id: activePayout.id, status: activePayout.status } : null,
      },
      balance: {
        pendingCents: bucket(LedgerStatus.pending).toString(),
        payableCents: payableCents.toString(),
        processingCents: bucket(LedgerStatus.processing).toString(),
        paidCents: bucket(LedgerStatus.paid).toString(),
      },
      ledger: {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: entries.map((e) => ({
          id: e.id,
          saleId: e.saleId,
          level: e.level,
          rateBpsUsed: e.rateBpsUsed,
          amountCents: e.amountCents.toString(),
          type: e.type,
          status: e.status,
          maturesAt: e.maturesAt,
          payoutId: e.payoutId,
          createdAt: e.createdAt,
        })),
      },
    };
  }

  /** Month summary and level breakdown (pending/payable/processing/paid). */
  async dashboard(membershipId: string, tenantId: string, month?: string) {
    this.tenantContext.assertTenant(tenantId);
    this.tenantContext.assertMembership(membershipId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const targetMonth = month ?? monthKey(new Date(), tenant.timezone);

    const rows = await this.prisma.monthlySummary.findMany({
      where: { membershipId, month: targetMonth },
      orderBy: { level: 'asc' },
    });

    const levels = rows.map((r) => ({
      level: r.level,
      pendingCents: r.pendingCents.toString(),
      payableCents: r.payableCents.toString(),
      processingCents: r.processingCents.toString(),
      paidCents: r.paidCents.toString(),
    }));
    const sum = (pick: (r: (typeof rows)[number]) => bigint) => rows.reduce((a, r) => a + pick(r), 0n);

    return {
      month: targetMonth,
      currency: tenant.currency,
      totals: {
        pendingCents: sum((r) => r.pendingCents).toString(),
        payableCents: sum((r) => r.payableCents).toString(),
        processingCents: sum((r) => r.processingCents).toString(),
        paidCents: sum((r) => r.paidCents).toString(),
      },
      levels,
    };
  }

  /**
   * Team view: per-level member count and active count. Aggregate only; no names.
   * team_stats can be filled by a nightly job later; MVP calculates live from path.
   * The visible window is capped by plan depth; deeper levels are not shown.
   */
  async team(membershipId: string, tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
    this.tenantContext.assertMembership(membershipId);
    const me = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: { path: true, depth: true },
    });
    if (!me) {
      throw new NotFoundException('membership not found');
    }

    const plan = await this.prisma.commissionPlan.findFirst({
      where: { tenantId, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
      select: { depth: true },
    });
    const maxRelLevel = (plan?.depth ?? 1) - 1; // excludes the caller at level 0

    // Subtree: ltree descendant operator (<@) for members below me.path.
    // Use ltree instead of LIKE so '_' in labels is never treated as a wildcard.
    // Group by absolute depth, then calculate relative level in JS.
    // This avoids parameter mismatch in SELECT/GROUP BY expressions; window is capped at maxRelLevel.
    const maxDepth = me.depth + maxRelLevel;
    const rows = await this.prisma.$queryRaw<
      Array<{ depth: number; memberCount: bigint; activeCount: bigint }>
    >`
      SELECT depth,
             count(*)                                  AS "memberCount",
             count(*) FILTER (WHERE status = 'active') AS "activeCount"
      FROM memberships
      WHERE tenant_id = ${tenantId}::uuid
        AND path::ltree <@ ${me.path}::ltree
        AND depth > ${me.depth}
        AND depth <= ${maxDepth}
      GROUP BY depth
      ORDER BY depth`;

    const byLevel = new Map(rows.map((r) => [r.depth - me.depth, r]));
    const levels = [];
    let totalMembers = 0;
    let totalActive = 0;
    for (let lvl = 1; lvl <= maxRelLevel; lvl++) {
      const r = byLevel.get(lvl);
      const memberCount = r ? Number(r.memberCount) : 0;
      const activeCount = r ? Number(r.activeCount) : 0;
      totalMembers += memberCount;
      totalActive += activeCount;
      levels.push({ level: lvl, memberCount, activeCount });
    }

    return { totalMembers, totalActive, levels };
  }
}
