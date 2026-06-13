import { Injectable, Logger } from '@nestjs/common';
import { LedgerType, MembershipStatus, PayoutStatus, Prisma, SaleStatus } from '@prisma/client';
import { sha256 } from '../common/crypto';
import { monthKey } from '../engine/month';
import { createEmailAdapter } from '../notifications/adapters';
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
    const last = await this.prisma.auditLog.findFirst({ where: { tenantId, hash: { not: null } }, orderBy: { createdAt: 'desc' } });
    let prev: string | null = last?.hash ?? null;
    const unsealed = await this.prisma.auditLog.findMany({ where: { tenantId, hash: null }, orderBy: { createdAt: 'asc' } });
    for (const a of unsealed) {
      const hash = sha256((prev ?? '') + this.auditContent(a));
      await this.prisma.auditLog.update({ where: { id: a.id }, data: { prevHash: prev, hash } });
      prev = hash;
    }
    return { sealed: unsealed.length };
  }

  /** Zincir butunlugunu dogrula: sealed kayitlari yeniden hash'le, ilk kirilmayi bildir. */
  async verifyAuditChain(tenantId: string): Promise<{ ok: boolean; checked: number; brokenAt: string | null }> {
    const rows = await this.prisma.auditLog.findMany({ where: { tenantId, hash: { not: null } }, orderBy: { createdAt: 'asc' } });
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
    const actorOf = await this.resolveActors(rows.map((a) => a.actorUserId));
    const header = 'created_at,action,entity,entity_id,actor_name,actor_email,ip';
    const lines = rows.map((a) => {
      const actor = actorOf(a.actorUserId);
      return [
        a.createdAt.toISOString(),
        csvCell(a.action),
        csvCell(a.entity),
        a.entityId ?? '',
        csvCell(actor.name),
        actor.email ?? '',
        a.ip ?? '',
      ].join(',');
    });
    return [header, ...lines].join('\n') + '\n';
  }
}

/** CSV hucresi: virgul/tirnak/yeni satir varsa tirnakla ve "" kacisla. */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
