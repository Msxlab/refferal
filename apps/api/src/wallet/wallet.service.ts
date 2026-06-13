import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerStatus, LedgerType } from '@prisma/client';
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

  /** Ay ozeti + seviye dokumu (pending/payable/paid). */
  async dashboard(membershipId: string, tenantId: string, month?: string) {
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
      paidCents: r.paidCents.toString(),
    }));
    const sum = (pick: (r: (typeof rows)[number]) => bigint) => rows.reduce((a, r) => a + pick(r), 0n);

    return {
      month: targetMonth,
      currency: tenant.currency,
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
}
