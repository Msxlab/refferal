import { Injectable, Logger } from '@nestjs/common';
import { LedgerType, MembershipStatus, PayoutStatus, Prisma, SaleStatus } from '@prisma/client';
import { sha256 } from '../common/crypto';
import { csvCell } from '../common/csv';
import { centsToDecimalString } from '@refearn/shared';
import { monthKey } from '../engine/month';
import { createEmailAdapter } from '../notifications/adapters';
import { FRAUD_BLOCK_SCORE } from '../fraud/fraud.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------- audit hash-zinciri (#12)

  /** Hash'lenecek kanonik icerik (sabit alan sirasi; hash/prevHash haric). */
  private auditContent(a: {
    id: string; action: string; entity: string; entityId: string | null; actorUserId: string | null;
    before: unknown; after: unknown; ip: string | null; createdAt: Date;
  }): string {
    return JSON.stringify({
      id: a.id, action: a.action, entity: a.entity, entityId: a.entityId, actorUserId: a.actorUserId,
      before: a.before ?? null, after: a.after ?? null, ip: a.ip ?? null, createdAt: a.createdAt.toISOString(),
    });
  }

  /** Henuz hash'lenmemis kayitlari createdAt sirasiyla zincire ekle (idempotent). */
  async sealAuditChain(tenantId: string): Promise<{ sealed: number }> {
    const last = await this.prisma.auditLog.findFirst({ where: { tenantId, hash: { not: null } }, orderBy: { seq: 'desc' } });
    let prev: string | null = last?.hash ?? null;
    const unsealed = await this.prisma.auditLog.findMany({ where: { tenantId, hash: null }, orderBy: { seq: 'asc' } });
    for (const a of unsealed) {
      const hash = sha256((prev ?? '') + this.auditContent(a));
      await this.prisma.auditLog.update({ where: { id: a.id }, data: { prevHash: prev, hash } });
      prev = hash;
    }
    return { sealed: unsealed.length };
  }

  /** Zincir butunlugunu dogrula: sealed kayitlari yeniden hash'le, ilk kirilmayi bildir. */
  async verifyAuditChain(tenantId: string): Promise<{ ok: boolean; checked: number; brokenAt: string | null }> {
    const rows = await this.prisma.auditLog.findMany({ where: { tenantId, hash: { not: null } }, orderBy: { seq: 'asc' } });
    let prev: string | null = null;
    for (const a of rows) {
      const expect = sha256((prev ?? '') + this.auditContent(a));
      if (a.prevHash !== prev || a.hash !== expect) {
        return { ok: false, checked: rows.length, brokenAt: a.id };
      }
      prev = a.hash;
    }
    return { ok: true, checked: rows.length, brokenAt: null };
  }

  /** Tek tenant: once seal sonra verify (UI butonu). */
  async sealAndVerify(tenantId: string) {
    const { sealed } = await this.sealAuditChain(tenantId);
    const v = await this.verifyAuditChain(tenantId);
    return { sealed, ...v };
  }

  /** Gece job'i: tum tenant'lari seal+verify; kirilan zinciri uyari olarak logla. */
  async sealAllTenants(): Promise<{ tenants: number; broken: number }> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let broken = 0;
    for (const t of tenants) {
      await this.sealAuditChain(t.id);
      const v = await this.verifyAuditChain(t.id);
      if (!v.ok) {
        broken++;
        this.logger.error(`[security] audit_chain_broken tenant=${t.id} brokenAt=${v.brokenAt}`);
      }
    }
    return { tenants: tenants.length, broken };
  }

  /**
   * Admin (tenant sahibi) ilk-kurulum checklist'i: referral programini calistirmak icin
   * adimlar. Mevcut tenant verisinden TURETILIR (yeni tablo yok). %100'de FE karti gizler.
   * NOT: komisyon plani adimi YOK — planlar platform (Axtra) tarafindan belirlenir.
   */
  async onboarding(tenantId: string, userId: string) {
    const [user, memberCount, inviteCount, saleCount, payoutCount] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } }),
      this.prisma.membership.count({ where: { tenantId } }),
      this.prisma.invite.count({ where: { tenantId } }),
      this.prisma.sale.count({ where: { tenantId } }),
      this.prisma.payout.count({ where: { tenantId } }),
    ]);
    const steps = [
      { key: 'verify_email', label: 'Verify your email', done: !!user?.emailVerifiedAt, cta: null as string | null },
      { key: 'invite_team', label: 'Invite your team', done: inviteCount > 0 || memberCount > 1, cta: '/admin/members' },
      { key: 'first_sale', label: 'Record your first sale', done: saleCount > 0, cta: '/admin/sales' },
      { key: 'first_payout', label: 'Process your first payout', done: payoutCount > 0, cta: '/admin/payouts' },
    ];
    const done = steps.filter((s) => s.done).length;
    return { steps, done, total: steps.length, percent: Math.round((done / steps.length) * 100) };
  }

  /**
   * Kohort retention/churn (Faz D3): uyeleri KATILIM AYINA gore grupla; her kohortta kac kisi
   * hala aktif (retention) + son 30 gunde satis yapan (uretken). Churn = joined - active.
   * Tenant timezone'una gore ay; en yeni 24 kohort.
   */
  async cohorts(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } });
    const rows = await this.prisma.$queryRaw<
      Array<{ cohort: string; joined: bigint; active: bigint; producing: bigint }>
    >`
      SELECT to_char(m.joined_at AT TIME ZONE ${tenant.timezone}, 'YYYY-MM') AS cohort,
             count(*)::bigint AS joined,
             count(*) FILTER (WHERE m.status = 'active')::bigint AS active,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM sales s
               WHERE s.seller_membership_id = m.id AND s.status = 'approved'
                 AND s.sale_date >= now() - interval '30 days'
             ))::bigint AS producing
      FROM memberships m
      WHERE m.tenant_id = ${tenantId}::uuid
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 24`;

    const cohorts = rows.map((r) => {
      const joined = Number(r.joined);
      const active = Number(r.active);
      const producing = Number(r.producing);
      return {
        cohort: r.cohort,
        joined,
        active,
        churned: joined - active,
        producing,
        retentionPct: joined > 0 ? Math.round((active / joined) * 100) : 0,
        activationPct: joined > 0 ? Math.round((producing / joined) * 100) : 0,
      };
    });
    const totals = cohorts.reduce(
      (a, c) => ({ joined: a.joined + c.joined, active: a.active + c.active, producing: a.producing + c.producing }),
      { joined: 0, active: 0, producing: 0 },
    );
    return {
      cohorts,
      totals: {
        ...totals,
        churned: totals.joined - totals.active,
        retentionPct: totals.joined > 0 ? Math.round((totals.active / totals.joined) * 100) : 0,
      },
    };
  }

  /**
   * Admin "yapilacaklar" kutusu (Faz C4): eyleme acik bekleyen isler tek listede — onay bekleyen
   * satis + incelenecek odeme talebi + basilacak/postalanacak cek + dolandiricilik incelemesi.
   * Yalniz count > 0 olanlar doner (bos kutu gosterilmez); her madde bir sayfaya yonlendirir.
   */
  async todo(tenantId: string) {
    const [salesDraft, payoutsRequested, checksToMail, fraudOpen] = await Promise.all([
      this.prisma.sale.count({ where: { tenantId, status: SaleStatus.draft } }),
      this.prisma.payout.count({ where: { tenantId, status: { in: [PayoutStatus.requested, PayoutStatus.processing] } } }),
      this.prisma.payout.count({ where: { tenantId, method: 'check', status: PayoutStatus.paid, mailedAt: null } }),
      this.prisma.fraudFlag.count({ where: { tenantId, status: 'open', score: { gte: FRAUD_BLOCK_SCORE } } }),
    ]);
    const items = [
      { key: 'sales_approval', label: 'Sales awaiting approval', count: salesDraft, href: '/admin/sales' },
      { key: 'payout_requests', label: 'Payout requests to review', count: payoutsRequested, href: '/admin/payouts' },
      { key: 'checks_to_process', label: 'Checks to print & mail', count: checksToMail, href: '/admin/checks' },
      { key: 'fraud_review', label: 'Members flagged for review', count: fraudOpen, href: '/admin/members' },
    ];
    return { items: items.filter((i) => i.count > 0), total: items.reduce((a, i) => a + i.count, 0) };
  }

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

    // bu ayin NET komisyon gideri — monthly_summaries'ten (reversal/clawback dusulmus).
    // ONEMLI: ham 'commission' ledger toplami void sonrasi reversal'lari yok sayip rakami SISIRIR
    // ve ayni ekrandaki analytics() ile celisirdi; otorite/netted kaynak monthly_summaries'tir.
    const commissionAgg = await this.prisma.monthlySummary.aggregate({
      where: { tenantId, month: targetMonth },
      _sum: { pendingCents: true, payableCents: true, paidCents: true },
    });

    // toplam odenebilir bakiye (tum zamanlar, payable ledger neti)
    const payableRows = await this.prisma.$queryRaw<Array<{ sum: bigint }>>`
      SELECT COALESCE(SUM(amount_cents), 0)::bigint AS sum
      FROM ledger_entries
      WHERE tenant_id = ${tenantId}::uuid AND status = 'payable'`;

    const pendingRequests = await this.prisma.payout.count({
      where: { tenantId, status: PayoutStatus.requested },
    });

    // borc kirilimi: bekleyen (henuz olgunlasmamis) + odeme yolunda (requested/processing payout)
    const [pendingLedger, inPayout, topEarnRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ sum: bigint }>>`
        SELECT COALESCE(SUM(amount_cents), 0)::bigint AS sum FROM ledger_entries
        WHERE tenant_id = ${tenantId}::uuid AND status = 'pending'`,
      this.prisma.payout.aggregate({ where: { tenantId, status: { in: [PayoutStatus.requested, PayoutStatus.processing] } }, _sum: { totalCents: true } }),
      // en cok kazanan (bu ay): monthly_summaries net
      this.prisma.monthlySummary.groupBy({
        by: ['membershipId'],
        where: { tenantId, month: targetMonth },
        _sum: { pendingCents: true, payableCents: true, paidCents: true },
      }),
    ]);

    // top earners isimleri + siralama
    const earnByMember = topEarnRows
      .map((r) => ({ membershipId: r.membershipId, cents: (r._sum.pendingCents ?? 0n) + (r._sum.payableCents ?? 0n) + (r._sum.paidCents ?? 0n) }))
      .filter((r) => r.cents > 0n)
      .sort((a, b) => (b.cents > a.cents ? 1 : -1))
      .slice(0, 8);
    const topMembers = earnByMember.length
      ? await this.prisma.membership.findMany({ where: { id: { in: earnByMember.map((e) => e.membershipId) } }, select: { id: true, referralCode: true, user: { select: { fullName: true } } } })
      : [];
    const nameById = new Map(topMembers.map((m) => [m.id, m]));
    const topEarners = earnByMember.map((e) => ({
      membershipId: e.membershipId,
      fullName: nameById.get(e.membershipId)?.user.fullName ?? '—',
      referralCode: nameById.get(e.membershipId)?.referralCode ?? '',
      earnedCents: e.cents.toString(),
    }));

    const revenue = approvedAgg._sum.amountCents ?? 0n;
    const commission = (commissionAgg._sum.pendingCents ?? 0n) + (commissionAgg._sum.payableCents ?? 0n) + (commissionAgg._sum.paidCents ?? 0n);

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
      // borc kirilimi (sirketin uyelere borcu)
      liability: {
        pendingCents: (pendingLedger[0]?.sum ?? 0n).toString(),
        payableCents: (payableRows[0]?.sum ?? 0n).toString(),
        inPayoutCents: (inPayout._sum.totalCents ?? 0n).toString(),
      },
      topEarners,
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

  // ---------------------------------------------------- clawback / negatif bakiye (Dalga 3)

  /**
   * Clawback raporu: net bakiyesi NEGATIF olan uyeler (paid sonrasi iade reversal'i).
   * Mevcut mekanizma: negatif payable sonraki kazanclardan otomatik mahsup edilir.
   * Bu rapor borcu (owed) gorunur kilar + yaslandirma (en eski negatif satir).
   */
  async clawbacks(tenantId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ membershipId: string; net: bigint; since: Date }>>`
      SELECT le.beneficiary_membership_id AS "membershipId",
             SUM(le.amount_cents)::bigint  AS "net",
             MIN(le.created_at)            AS "since"
      FROM ledger_entries le
      WHERE le.tenant_id = ${tenantId}::uuid
        AND le.status IN ('payable', 'pending')
      GROUP BY le.beneficiary_membership_id
      HAVING SUM(le.amount_cents) < 0
      ORDER BY SUM(le.amount_cents) ASC`;
    if (rows.length === 0) return { totalOwedCents: '0', members: [] };

    const members = await this.prisma.membership.findMany({
      where: { id: { in: rows.map((r) => r.membershipId) } },
      select: { id: true, referralCode: true, user: { select: { fullName: true } } },
    });
    const mBy = new Map(members.map((m) => [m.id, m]));
    let totalOwed = 0n;
    const list = rows.map((r) => {
      const owed = -r.net; // pozitif borc
      totalOwed += owed;
      const m = mBy.get(r.membershipId);
      return { membershipId: r.membershipId, name: m?.user.fullName ?? '—', referralCode: m?.referralCode ?? '', owedCents: owed.toString(), since: r.since };
    });
    return { totalOwedCents: totalOwed.toString(), members: list };
  }

  // ---------------------------------------------------- 1099-NEC vergi raporu (Dalga 3, ABD)

  /** Takvim yili icinde uyeye ODENEN komisyon toplami; >= $600 1099-NEC raporlanabilir. */
  async tax1099(tenantId: string, year: number) {
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);
    const THRESHOLD = 60_000n; // $600

    const rows = await this.prisma.payout.groupBy({
      by: ['membershipId'],
      where: { tenantId, status: 'paid', paidAt: { gte: start, lt: end } },
      _sum: { totalCents: true },
    });
    const ids = rows.map((r) => r.membershipId);
    const [members, profiles] = await Promise.all([
      this.prisma.membership.findMany({ where: { id: { in: ids } }, select: { id: true, referralCode: true, user: { select: { fullName: true } } } }),
      this.prisma.payoutProfile.findMany({ where: { membershipId: { in: ids } }, select: { membershipId: true, legalName: true, taxIdType: true, taxIdLast4: true } }),
    ]);
    const mBy = new Map(members.map((m) => [m.id, m]));
    const pBy = new Map(profiles.map((p) => [p.membershipId, p]));

    const list = rows.map((r) => {
      const paid = r._sum.totalCents ?? 0n; // BigInt cent; IRS tutari, precision korunur
      const m = mBy.get(r.membershipId);
      const p = pBy.get(r.membershipId);
      return {
        membershipId: r.membershipId,
        name: m?.user.fullName ?? '—',
        referralCode: m?.referralCode ?? '',
        legalName: p?.legalName ?? null,
        taxIdType: p?.taxIdType ?? null,
        taxIdLast4: p?.taxIdLast4 ?? null,
        hasTaxId: !!p,
        paidCentsBig: paid, // dahili siralama icin BigInt; JSON'a verilmez
        paidCents: paid.toString(),
        reportable: paid >= THRESHOLD,
      };
    }).sort((a, b) => (a.paidCentsBig < b.paidCentsBig ? 1 : a.paidCentsBig > b.paidCentsBig ? -1 : 0));

    return {
      year,
      thresholdCents: THRESHOLD.toString(),
      reportableCount: list.filter((x) => x.reportable).length,
      missingTaxId: list.filter((x) => x.reportable && !x.hasTaxId).length,
      members: list.map(({ paidCentsBig, ...rest }) => rest),
    };
  }

  async tax1099Csv(tenantId: string, year: number): Promise<string> {
    const { members } = await this.tax1099(tenantId, year);
    const header = 'legal_name,full_name,referral_code,tax_id_type,tax_id_last4,paid_amount,reportable';
    const lines = members.map((m) =>
      [
        csvCell(m.legalName ?? ''),
        csvCell(m.name),
        csvCell(m.referralCode),
        csvCell(m.taxIdType ?? ''),
        csvCell(m.taxIdLast4 ?? ''),
        centsToDecimalString(BigInt(m.paidCents)),
        m.reportable ? 'yes' : 'no',
      ].join(','),
    );
    return [header, ...lines].join('\n') + '\n';
  }

  // ---------------------------------------------------- finansal invariant dogrulama (Dalga 3)

  /**
   * Para tutarliligi denetimi (gece + admin). Iki degismez:
   * A) her 'paid' payout.totalCents == bagli ledger satirlari toplami
   * B) uye basina monthly_summaries (pending/payable/paid) == ledger toplami (status bazinda)
   * Sapma bulgulari doner; bos = saglikli.
   */
  async verifyFinancials(tenantId: string) {
    // A: payout ↔ ledger
    const payoutMismatches = await this.prisma.$queryRaw<Array<{ payoutId: string; totalCents: bigint; lineSum: bigint }>>`
      SELECT p.id AS "payoutId", p.total_cents AS "totalCents", COALESCE(SUM(le.amount_cents), 0)::bigint AS "lineSum"
      FROM payouts p
      LEFT JOIN ledger_entries le ON le.payout_id = p.id
      WHERE p.tenant_id = ${tenantId}::uuid AND p.status = 'paid'
      GROUP BY p.id, p.total_cents
      HAVING p.total_cents <> COALESCE(SUM(le.amount_cents), 0)::bigint`;

    // B: summary ↔ ledger (uye basina, status bazinda)
    const [summaries, ledger] = await Promise.all([
      this.prisma.monthlySummary.groupBy({ by: ['membershipId'], where: { tenantId }, _sum: { pendingCents: true, payableCents: true, paidCents: true } }),
      this.prisma.ledgerEntry.groupBy({ by: ['beneficiaryMembershipId', 'status'], where: { tenantId }, _sum: { amountCents: true } }),
    ]);
    const sBy = new Map(summaries.map((s) => [s.membershipId, s._sum]));
    const lBy = new Map<string, { pending: bigint; payable: bigint; paid: bigint }>();
    for (const r of ledger) {
      const cur = lBy.get(r.beneficiaryMembershipId) ?? { pending: 0n, payable: 0n, paid: 0n };
      if (r.status === 'pending') cur.pending += r._sum.amountCents ?? 0n;
      else if (r.status === 'payable') cur.payable += r._sum.amountCents ?? 0n;
      else if (r.status === 'paid') cur.paid += r._sum.amountCents ?? 0n;
      lBy.set(r.beneficiaryMembershipId, cur);
    }
    const ids = new Set([...sBy.keys(), ...lBy.keys()]);
    const summaryMismatches: Array<{ membershipId: string; field: string; summary: string; ledger: string }> = [];
    for (const id of ids) {
      const s = sBy.get(id) ?? { pendingCents: 0n, payableCents: 0n, paidCents: 0n };
      const l = lBy.get(id) ?? { pending: 0n, payable: 0n, paid: 0n };
      const checks: Array<[string, bigint, bigint]> = [
        ['pending', s.pendingCents ?? 0n, l.pending],
        ['payable', s.payableCents ?? 0n, l.payable],
        ['paid', s.paidCents ?? 0n, l.paid],
      ];
      for (const [field, sv, lv] of checks) {
        if (sv !== lv) summaryMismatches.push({ membershipId: id, field, summary: sv.toString(), ledger: lv.toString() });
      }
    }

    const ok = payoutMismatches.length === 0 && summaryMismatches.length === 0;
    return {
      ok,
      payoutMismatches: payoutMismatches.map((p) => ({ payoutId: p.payoutId, totalCents: p.totalCents.toString(), lineSum: p.lineSum.toString() })),
      summaryMismatches: summaryMismatches.slice(0, 50),
    };
  }

  /** Gece job'i: tum tenant'lari denetle; sapmayi alarmla. */
  async verifyAllFinancials(): Promise<{ tenants: number; unhealthy: number }> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let unhealthy = 0;
    for (const t of tenants) {
      const r = await this.verifyFinancials(t.id);
      if (!r.ok) {
        unhealthy++;
        this.logger.error(`[security] financial_invariant_violation tenant=${t.id} payouts=${r.payoutMismatches.length} summaries=${r.summaryMismatches.length}`);
      }
    }
    return { tenants: tenants.length, unhealthy };
  }

  // ---------------------------------------------------- zamanlanmis e-posta raporu (#18)

  async getSubscription(tenantId: string) {
    const s = await this.prisma.reportSubscription.findUnique({ where: { tenantId } });
    return { frequency: s?.frequency ?? 'weekly', recipients: s?.recipients ?? [], lastSentAt: s?.lastSentAt ?? null };
  }

  async setSubscription(tenantId: string, frequency: string, recipients: string[]) {
    await this.prisma.reportSubscription.upsert({
      where: { tenantId },
      create: { tenantId, frequency, recipients },
      update: { frequency, recipients },
    });
    return this.getSubscription(tenantId);
  }

  /** Donem ozeti digest (HTML+text) — dashboard verisinden. */
  private async buildDigest(tenantId: string): Promise<{ subject: string; text: string; html: string }> {
    const d = await this.dashboard(tenantId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, currency: true } });
    const m = (c: string | number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: tenant.currency }).format(Number(c) / 100);
    const rows: Array<[string, string]> = [
      ['Revenue this month', m(d.thisMonth.revenueCents)],
      ['Commission', m(d.thisMonth.commissionCents)],
      ['Approved sales', String(d.thisMonth.approvedSalesCount)],
      ['Active members', `${d.members.active} / ${d.members.total}`],
      ['Outstanding payable', m(d.outstandingPayableCents)],
      ['Pending payout requests', String(d.pendingPayoutRequests)],
    ];
    const subject = `${tenant.name} — ${d.month} summary`;
    const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
    const html = `<h2>${tenant.name} — ${d.month}</h2><table>${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${k}</td><td style="font-weight:700">${v}</td></tr>`).join('')}</table>`;
    return { subject, text, html };
  }

  async sendDigest(tenantId: string, recipients: string[]): Promise<{ sent: number }> {
    if (recipients.length === 0) return { sent: 0 };
    const { subject, text, html } = await this.buildDigest(tenantId);
    const adapter = createEmailAdapter();
    for (const to of recipients) {
      try { await adapter.send({ to, subject, text, html }); } catch (e) { this.logger.warn(`rapor e-postasi gonderilemedi → ${to}: ${e instanceof Error ? e.message : e}`); }
    }
    return { sent: recipients.length };
  }

  private isDue(frequency: string, lastSentAt: Date | null, now = new Date()): boolean {
    if (!lastSentAt) return true;
    const days = (now.getTime() - lastSentAt.getTime()) / 86_400_000;
    return frequency === 'monthly' ? days >= 28 : days >= 7;
  }

  /** Gece job'i: zamani gelen abonelikleri gonder. */
  async runDueDigests(now = new Date()): Promise<{ sent: number }> {
    const subs = await this.prisma.reportSubscription.findMany();
    let sent = 0;
    for (const s of subs) {
      if (s.recipients.length === 0 || !this.isDue(s.frequency, s.lastSentAt, now)) continue;
      await this.sendDigest(s.tenantId, s.recipients);
      await this.prisma.reportSubscription.update({ where: { id: s.id }, data: { lastSentAt: now } });
      sent++;
    }
    return { sent };
  }

  /** Audit filtre seti (list + export ortak, tenant-scoped). */
  private auditWhere(
    tenantId: string,
    q: { q?: string; entity?: string; from?: Date; to?: Date },
  ): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = { tenantId };
    if (q.entity) where.entity = q.entity;
    if (q.from || q.to) {
      where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    }
    // serbest arama: action / entity (entityId UUID — contains desteklemez)
    if (q.q) {
      const term = q.q;
      where.OR = [
        { action: { contains: term, mode: 'insensitive' } },
        { entity: { contains: term, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  /** actorUserId → { name, email } (batch; null aktor = 'system'). */
  private async resolveActors(actorIds: Array<string | null>) {
    const ids = [...new Set(actorIds.filter((v): v is string => !!v))];
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } })
      : [];
    const map = new Map(users.map((u) => [u.id, u]));
    return (id: string | null) => {
      if (!id) return { name: 'system', email: null as string | null };
      const u = map.get(id);
      return { name: u?.fullName ?? id.slice(0, 8), email: u?.email ?? null };
    };
  }

  /** Tenant audit log (SPEC 9): filtreli + sayfali + actor adi cozumlu. */
  async audit(
    tenantId: string,
    q: { q?: string; entity?: string; from?: Date; to?: Date; page: number; pageSize: number },
  ) {
    const where = this.auditWhere(tenantId, q);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const actorOf = await this.resolveActors(rows.map((a) => a.actorUserId));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((a) => {
        const actor = actorOf(a.actorUserId);
        return {
          id: a.id,
          action: a.action,
          entity: a.entity,
          entityId: a.entityId,
          actorUserId: a.actorUserId,
          actorName: actor.name,
          actorEmail: actor.email,
          before: a.before,
          after: a.after,
          ip: a.ip,
          createdAt: a.createdAt,
        };
      }),
    };
  }

  /** Audit CSV exportu (admin): list ile ayni filtreler, max 5000, createdAt desc. */
  async auditExportCsv(tenantId: string, q: { q?: string; entity?: string; from?: Date; to?: Date }): Promise<string> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.auditWhere(tenantId, q),
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    // sessiz kirpma admin'i "her seyi indirdim" sanmasina yol acar — limite ulasinca uyar
    if (rows.length === 5000) {
      this.logger.warn(`[audit-export] tenant=${tenantId} 5000-satir limitine ulasildi — sonuc kirpilmis olabilir (tarih/filtre daraltin)`);
    }
    const actorOf = await this.resolveActors(rows.map((a) => a.actorUserId));
    const header = 'created_at,action,entity,entity_id,actor_name,actor_email,ip';
    const lines = rows.map((a) => {
      const actor = actorOf(a.actorUserId);
      return [
        a.createdAt.toISOString(),
        csvCell(a.action),
        csvCell(a.entity),
        csvCell(a.entityId ?? ''),
        csvCell(actor.name),
        csvCell(actor.email ?? ''),
        csvCell(a.ip ?? ''),
      ].join(',');
    });
    return [header, ...lines].join('\n') + '\n';
  }
}
