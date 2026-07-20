import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerStatus, LedgerType, MembershipStatus, PayoutStatus, SaleStatus } from '@prisma/client';
import { publicBrandFromTenant } from '../common/branding';
import { monthKey } from '../engine/month';
import {
  evaluatePayoutReadiness,
  LegacyPayoutEligibilityReason,
  legacyPayoutEligibilityReason,
} from '../payouts/payout-readiness';
import { PayoutComplianceService } from '../payouts/payout-compliance.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';

function payoutEligibilityMessage(reason: LegacyPayoutEligibilityReason) {
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
    case 'readiness_unavailable':
      return 'Additional payout readiness checks are unavailable.';
  }
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
    private readonly compliance: PayoutComplianceService,
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
  async wallet(
    membershipId: string,
    tenantId: string,
    q: { page: number; pageSize: number; type?: LedgerType; status?: LedgerStatus },
  ) {
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
    const readinessActivePayout = activePayout
      ? { id: activePayout.id, status: activePayout.status === PayoutStatus.processing ? ('processing' as const) : ('requested' as const) }
      : null;
    const complianceInput = await this.compliance.readInput(this.prisma, tenantId, membershipId);
    const payoutReadiness = evaluatePayoutReadiness({
      emailVerified: membership.user.emailVerifiedAt !== null,
      payableCents,
      threshold: { amountCents: tenant.payoutMinCents, currency: tenant.currency },
      activePayout: readinessActivePayout,
      mfa: { requirement: 'unknown' },
      manualChecks: complianceInput.manualChecks,
      destination: complianceInput.destination,
    });
    const eligibilityReason = legacyPayoutEligibilityReason(payoutReadiness, readinessActivePayout);

    const ledgerWhere = {
      tenantId,
      beneficiaryMembershipId: membershipId,
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [total, entries] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.count({ where: ledgerWhere }),
      this.prisma.ledgerEntry.findMany({
        where: ledgerWhere,
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
      payoutReadiness,
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

  /**
   * Aylik kazanc serisi (son N ay, icinde bulunulan ay dahil, eskiden yeniye).
   * Kaynak: monthly_summaries (membership_id iceriyor; engine her ledger mutasyonunda
   * ayni transaction'da gunceller — reversal'lar bucket'i dusurur, yani NET degerler).
   * Ay anahtari tenant.timezone'a gore (engine monthKey ile ayni kural).
   */
  async earnings(membershipId: string, tenantId: string, months: number) {
    this.tenantContext.assertTenant(tenantId);
    this.tenantContext.assertMembership(membershipId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const anchor = monthKey(new Date(), tenant.timezone);
    const range = this.monthsBack(anchor, months);

    const rows = await this.prisma.monthlySummary.groupBy({
      by: ['month'],
      where: { tenantId, membershipId, month: { in: range } },
      _sum: { pendingCents: true, payableCents: true, processingCents: true, paidCents: true },
      orderBy: { month: 'asc' },
    });
    const byMonth = new Map(rows.map((r) => [r.month, r._sum]));

    const series = range.map((m) => {
      const s = byMonth.get(m);
      const pending = s?.pendingCents ?? 0n;
      const payable = s?.payableCents ?? 0n;
      const processing = s?.processingCents ?? 0n;
      const paid = s?.paidCents ?? 0n;
      return {
        month: m,
        pendingCents: pending.toString(),
        payableCents: payable.toString(),
        processingCents: processing.toString(),
        paidCents: paid.toString(),
        totalCents: (pending + payable + processing + paid).toString(),
      };
    });

    return { months, currency: tenant.currency, series };
  }

  /** anchor ('YYYY-MM') dahil son n ayin anahtarlari, eskiden yeniye (reports.service.ts kalibi). */
  private monthsBack(anchor: string, n: number): string[] {
    const [y, m] = anchor.split('-').map(Number);
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return out;
  }

  /** Aktivasyon checklist'i (#22): mevcut veriden turetilir, yeni tablo yok. */
  async onboarding(membershipId: string, userId: string, tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
    this.tenantContext.assertMembership(membershipId);
    const [user, profile, invites, sales, devices] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } }),
      this.prisma.payoutProfile.findUnique({ where: { membershipId }, select: { id: true } }),
      this.prisma.invite.count({ where: { tenantId, inviterMembershipId: membershipId } }),
      this.prisma.sale.count({ where: { tenantId, sellerMembershipId: membershipId } }),
      this.prisma.device.count({ where: { userId } }),
    ]);
    const steps = [
      { key: 'verify_email', label: 'Verify your email', done: !!user?.emailVerifiedAt },
      { key: 'payout_profile', label: 'Add your payout details', done: !!profile },
      { key: 'first_invite', label: 'Send your first invite', done: invites > 0 },
      { key: 'first_sale', label: 'Record your first sale', done: sales > 0 },
      { key: 'enable_push', label: 'Enable push notifications', done: devices > 0 },
    ];
    const done = steps.filter((s) => s.done).length;
    return { steps, done, total: steps.length, percent: Math.round((done / steps.length) * 100) };
  }

  /**
   * Gizlilik-uyumlu liderlik: uyeye YALNIZ kendi sirasi + yuzdelik dilim doner.
   * Baska uyenin adi/tutari ASLA donmez (mevcut gizlilik modeli). Bu ay toplam kazanca gore.
   */
  async leaderboard(membershipId: string, tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
    this.tenantContext.assertMembership(membershipId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const month = monthKey(new Date(), tenant.timezone);
    const rows = await this.prisma.monthlySummary.groupBy({
      by: ['membershipId'],
      where: { tenantId, month },
      _sum: { pendingCents: true, payableCents: true, processingCents: true, paidCents: true },
    });
    const totals = rows
      .map((r) => ({
        id: r.membershipId,
        total: (r._sum.pendingCents ?? 0n)
          + (r._sum.payableCents ?? 0n)
          + (r._sum.processingCents ?? 0n)
          + (r._sum.paidCents ?? 0n),
      }))
      .filter((t) => t.total > 0n)
      .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
    const total = totals.length;
    const idx = totals.findIndex((t) => t.id === membershipId);
    if (idx < 0) return { month, rank: null, total, topPercent: null };
    const rank = idx + 1;
    const topPercent = total > 0 ? Math.max(1, Math.round((rank / total) * 100)) : null;
    return { month, rank, total, topPercent };
  }

  /** Ay ozeti + seviye dokumu (pending/payable/paid). */
  async dashboard(membershipId: string, tenantId: string, month?: string) {
    this.tenantContext.assertTenant(tenantId);
    this.tenantContext.assertMembership(membershipId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const targetMonth = month ?? monthKey(new Date(), tenant.timezone);

    const [rows, soldThisMonth, soldLifetime] = await Promise.all([
      this.prisma.monthlySummary.findMany({ where: { membershipId, month: targetMonth }, orderBy: { level: 'asc' } }),
      // KENDI cirosu (sattigi): bu ay onayli satislari
      this.prisma.sale.aggregate({ where: { tenantId, sellerMembershipId: membershipId, status: SaleStatus.approved, summaryMonth: targetMonth }, _sum: { amountCents: true }, _count: { _all: true } }),
      this.prisma.sale.aggregate({ where: { tenantId, sellerMembershipId: membershipId, status: SaleStatus.approved }, _sum: { amountCents: true } }),
    ]);

    const levels = rows.map((r) => ({
      level: r.level,
      pendingCents: r.pendingCents.toString(),
      payableCents: r.payableCents.toString(),
      processingCents: r.processingCents.toString(),
      paidCents: r.paidCents.toString(),
    }));
    const sum = (pick: (r: (typeof rows)[number]) => bigint) => rows.reduce((a, r) => a + pick(r), 0n);
    const earnedThisMonth = sum((r) => r.pendingCents)
      + sum((r) => r.payableCents)
      + sum((r) => r.processingCents)
      + sum((r) => r.paidCents);
    const soldCents = soldThisMonth._sum.amountCents ?? 0n;

    return {
      month: targetMonth,
      currency: tenant.currency,
      // "sattigi vs kazandigi" — urunun uye tarafindaki cekirdek vaadi
      soldThisMonthCents: soldCents.toString(),
      salesThisMonth: soldThisMonth._count._all,
      soldLifetimeCents: (soldLifetime._sum.amountCents ?? 0n).toString(),
      earnedThisMonthCents: earnedThisMonth.toString(),
      // etkin oran (kazanc/ciro) bps — yalniz kendi satislarindan degil tum komisyon dahil; bilgi amacli
      effectiveRateBps: soldCents > 0n ? Number((earnedThisMonth * 10000n) / soldCents) : 0,
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
      where: { tenantId, finalized: true, effectiveFrom: { lte: new Date() } },
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

  /**
   * DIREKT recruit'ler: uyenin KENDI davet ettigi 1. seviye uyeler (sponsorMembershipId = me).
   * GIZLILIK: bu yuzey team()'den FARKLI — burada isim donebilir cunku uye onlari kendisi davet etti
   * (gizlilik kisiti DERIN downline icindir, direkt recruit'ler degil). 2+ seviye derin ASLA isimle
   * donmez; bunun icin team() agregati kullanilir. Tum sorgular SALT-OKUNUR (yerlesim/path'e dokunmaz).
  */
  async recruits(membershipId: string, tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
    this.tenantContext.assertMembership(membershipId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const month = monthKey(new Date(), tenant.timezone);

    const me = await this.prisma.membership.findFirst({ where: { id: membershipId, tenantId }, select: { id: true } });
    if (!me) {
      throw new NotFoundException('uyelik bulunamadi');
    }

    // 1. seviye: [tenantId, sponsorMembershipId] index'i (schema.prisma) kullanilir.
    const directs = await this.prisma.membership.findMany({
      where: { tenantId, sponsorMembershipId: membershipId },
      select: {
        id: true,
        referralCode: true,
        status: true,
        joinedAt: true,
        user: { select: { fullName: true, email: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });

    if (directs.length === 0) {
      return {
        month, currency: tenant.currency, recruits: [],
        summary: { total: 0, active: 0, needsNudgeCount: 0, joinedThisMonth: 0 },
        growthTrend: this.monthsBack(month, 6).map((m) => ({ month: m, joined: 0 })),
      };
    }

    // Bu ay onayli satis (recruit'in KENDI sattigi): tek groupBy (dashboard() ile birebir ayni kalip).
    const ids = directs.map((d) => d.id);
    const salesRows = await this.prisma.sale.groupBy({
      by: ['sellerMembershipId'],
      where: { tenantId, status: SaleStatus.approved, summaryMonth: month, sellerMembershipId: { in: ids } },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
    const salesById = new Map(salesRows.map((r) => [r.sellerMembershipId, r]));

    let active = 0;
    let needsNudgeCount = 0;
    let joinedThisMonth = 0;
    const joinByMonth = new Map<string, number>();
    const recruits = directs.map((d) => {
      const s = salesById.get(d.id);
      const salesThisMonth = s?._count._all ?? 0;
      const isActive = d.status === MembershipStatus.active;
      if (isActive) active++;
      // nudge sinyali: AKTIF ama bu ay henuz satis yapmamis recruit (pasif=inactive ayri durum).
      const needsNudge = isActive && salesThisMonth === 0;
      if (needsNudge) needsNudgeCount++;
      const jm = monthKey(d.joinedAt, tenant.timezone);
      if (jm === month) joinedThisMonth++;
      joinByMonth.set(jm, (joinByMonth.get(jm) ?? 0) + 1);
      return {
        id: d.id,
        fullName: d.user.fullName,
        email: d.user.email,
        referralCode: d.referralCode,
        status: d.status,
        joinedAt: d.joinedAt,
        salesThisMonth,
        soldThisMonthCents: (s?._sum.amountCents ?? 0n).toString(),
        needsNudge,
      };
    });

    // son 6 ay katilim trendi (1. seviye recruit'lerin joinedAt'i — gizlilik-guvenli sayim)
    const growthTrend = this.monthsBack(month, 6).map((m) => ({ month: m, joined: joinByMonth.get(m) ?? 0 }));

    return {
      month,
      currency: tenant.currency,
      recruits,
      summary: { total: recruits.length, active, needsNudgeCount, joinedThisMonth },
      growthTrend,
    };
  }
}
