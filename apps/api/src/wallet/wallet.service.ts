import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerStatus, LedgerType, MembershipStatus, SaleStatus } from '@prisma/client';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Uye cuzdan/ozet servisleri (SPEC 8/9). GIZLILIK: alt ekip icin yalnizca AGREGAT
 * (sayi + kendi ledger'i) doner; bireysel isim+satis eslesmesi member rolune ASLA donmez.
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bakiye = payable toplam (odenebilir). pending ve paid ayri gosterilir.
   * type/status filtreleri YALNIZ ledger listesine uygulanir; balance her zaman tum kayitlardan.
   */
  async wallet(
    membershipId: string,
    tenantId: string,
    q: { page: number; pageSize: number; type?: LedgerType; status?: LedgerStatus },
  ) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['status'],
      where: { beneficiaryMembershipId: membershipId, status: { not: LedgerStatus.reversed } },
      _sum: { amountCents: true },
    });
    const bucket = (s: LedgerStatus) => grouped.find((g) => g.status === s)?._sum.amountCents ?? 0n;

    const ledgerWhere = {
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
      // Esik ilerleme cubugu icin: payable >= payoutMinCents olunca odeme istenebilir
      payoutMinCents: tenant.payoutMinCents.toString(),
      balance: {
        pendingCents: bucket(LedgerStatus.pending).toString(),
        payableCents: bucket(LedgerStatus.payable).toString(),
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
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const anchor = monthKey(new Date(), tenant.timezone);
    const range = this.monthsBack(anchor, months);

    const rows = await this.prisma.monthlySummary.groupBy({
      by: ['month'],
      where: { tenantId, membershipId, month: { in: range } },
      _sum: { pendingCents: true, payableCents: true, paidCents: true },
      orderBy: { month: 'asc' },
    });
    const byMonth = new Map(rows.map((r) => [r.month, r._sum]));

    const series = range.map((m) => {
      const s = byMonth.get(m);
      const pending = s?.pendingCents ?? 0n;
      const payable = s?.payableCents ?? 0n;
      const paid = s?.paidCents ?? 0n;
      return {
        month: m,
        pendingCents: pending.toString(),
        payableCents: payable.toString(),
        paidCents: paid.toString(),
        totalCents: (pending + payable + paid).toString(),
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
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const month = monthKey(new Date(), tenant.timezone);
    const rows = await this.prisma.monthlySummary.groupBy({
      by: ['membershipId'],
      where: { tenantId, month },
      _sum: { pendingCents: true, payableCents: true, paidCents: true },
    });
    const totals = rows
      .map((r) => ({ id: r.membershipId, total: (r._sum.pendingCents ?? 0n) + (r._sum.payableCents ?? 0n) + (r._sum.paidCents ?? 0n) }))
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
      paidCents: r.paidCents.toString(),
    }));
    const sum = (pick: (r: (typeof rows)[number]) => bigint) => rows.reduce((a, r) => a + pick(r), 0n);
    const earnedThisMonth = sum((r) => r.pendingCents) + sum((r) => r.payableCents) + sum((r) => r.paidCents);
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
        paidCents: sum((r) => r.paidCents).toString(),
      },
      levels,
    };
  }

  /**
   * Ekibim: seviye basina kisi sayisi (member_count + active_count). AGREGAT, isim YOK.
   * team_stats gece job'i ile (henuz yok); MVP'de path uzerinden CANLI hesaplanir.
   * Pencere plan derinligiyle sinirli (kayan pencere — daha derini gosterilmez).
   */
  async team(membershipId: string, tenantId: string) {
    const me = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: { path: true, depth: true },
    });
    if (!me) {
      throw new NotFoundException('uyelik bulunamadi');
    }

    const plan = await this.prisma.commissionPlan.findFirst({
      where: { tenantId, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
      select: { depth: true },
    });
    const maxRelLevel = (plan?.depth ?? 1) - 1; // kendi (level 0) haric alt seviyeler

    // Alt agac: ltree descendant operatoru (<@) ile <me.path> altindaki uyeler.
    // LIKE yerine ltree kullaniyoruz; aksi halde etiketlerdeki '_' LIKE joker'i olurdu.
    // depth'e gore grupla, goreli seviyeyi (depth - me.depth) JS'te hesapla — boylece
    // SELECT/GROUP BY ifadelerinde parametre uyusmazligi olmaz. Pencere: maxRelLevel'e kadar.
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
      return { month, currency: tenant.currency, recruits: [], summary: { total: 0, active: 0, needsNudgeCount: 0, joinedThisMonth: 0 } };
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
    const recruits = directs.map((d) => {
      const s = salesById.get(d.id);
      const salesThisMonth = s?._count._all ?? 0;
      const isActive = d.status === MembershipStatus.active;
      if (isActive) active++;
      // nudge sinyali: AKTIF ama bu ay henuz satis yapmamis recruit (pasif=inactive ayri durum).
      const needsNudge = isActive && salesThisMonth === 0;
      if (needsNudge) needsNudgeCount++;
      if (monthKey(d.joinedAt, tenant.timezone) === month) joinedThisMonth++;
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

    return {
      month,
      currency: tenant.currency,
      recruits,
      summary: { total: recruits.length, active, needsNudgeCount, joinedThisMonth },
    };
  }
}
