import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CampaignStatus,
  FraudStatus,
  InvoiceStatus,
  LedgerStatus,
  LedgerType,
  MembershipStatus,
  PayoutBatchStatus,
  PayoutProfileStatus,
  Prisma,
  Role,
  SaleStatus,
  TenantStatus,
} from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { DEFAULT_LEVEL_RATES_BPS, DEFAULT_POOL_RATE_BPS } from '@refearn/shared';
import { ARGON2_OPTS, AuthService } from '../auth/auth.service';
import { ltreeLabel, newUuid, randomCode } from '../common/crypto';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /** Act-as: platform admin bir sirket icin tenant-scoped owner token alir (audit'li). */
  async actAs(actorUserId: string, tenantId: string): Promise<{ accessToken: string }> {
    const res = await this.auth.actAsTenant(actorUserId, tenantId);
    await this.prisma.auditLog.create({ data: {
      tenantId, actorUserId, action: 'platform.act_as', entity: 'tenant', entityId: tenantId,
      after: { tenantId, role: 'tenant_owner', platformAdmin: true } as Prisma.InputJsonValue,
    } });
    return res;
  }

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

  /**
   * Portfoy ozeti (B3): tum aktif sirketler icin brut/net/odenecek toplamlari, sirket
   * leaderboard'u (bu-ay ciro azalan) ve "dikkat gerektiren" sayaclar (onay/risk/fatura/kampanya).
   * Net = brut satis − bu-ay satislara bagli komisyon ledger'i. payable = tum 'payable' ledger.
   */
  async overview(): Promise<{
    totals: { grossRevenueCents: string; netCents: string; payableCents: string; activeMembers: number; companies: number };
    leaderboard: Array<{ id: string; slug: string; name: string; status: string; currency: string; revenueThisMonthCents: string; members: number; activeMembers: number }>;
    attention: { payoutApprovals: number; riskReviews: number; overdueInvoices: number; campaignsToFinalize: number };
  }> {
    const tenants = await this.prisma.tenant.findMany({ where: { status: TenantStatus.active } });
    let gross = 0n, commission = 0n, payable = 0n, activeMembersTotal = 0;
    const leaderboard = [] as Array<{ id: string; slug: string; name: string; status: string; currency: string; revenueThisMonthCents: string; members: number; activeMembers: number }>;

    for (const t of tenants) {
      const m = monthKey(new Date(), t.timezone);
      const sales = await this.prisma.sale.findMany({ where: { tenantId: t.id, status: SaleStatus.approved, summaryMonth: m }, select: { id: true, amountCents: true } });
      const revenue = sales.reduce((a, s) => a + s.amountCents, 0n);
      const saleIds = sales.map((s) => s.id);
      const comm = saleIds.length
        ? (await this.prisma.ledgerEntry.aggregate({ where: { tenantId: t.id, saleId: { in: saleIds }, type: LedgerType.commission }, _sum: { amountCents: true } }))._sum.amountCents ?? 0n
        : 0n;
      const pay = (await this.prisma.ledgerEntry.aggregate({ where: { tenantId: t.id, status: LedgerStatus.payable }, _sum: { amountCents: true } }))._sum.amountCents ?? 0n;
      const members = await this.prisma.membership.count({ where: { tenantId: t.id } });
      const active = await this.prisma.membership.count({ where: { tenantId: t.id, status: MembershipStatus.active } });
      gross += revenue; commission += comm; payable += pay; activeMembersTotal += active;
      leaderboard.push({ id: t.id, slug: t.slug, name: t.name, status: t.status, currency: t.currency, revenueThisMonthCents: revenue.toString(), members, activeMembers: active });
    }
    leaderboard.sort((a, b) => Number(BigInt(b.revenueThisMonthCents) - BigInt(a.revenueThisMonthCents)));

    const now = new Date();
    const attention = {
      payoutApprovals: await this.prisma.payoutBatch.count({ where: { status: PayoutBatchStatus.proposed } }),
      riskReviews:
        (await this.prisma.fraudFlag.count({ where: { status: FraudStatus.open } })) +
        (await this.prisma.payoutProfile.count({ where: { status: PayoutProfileStatus.pending_review } })),
      overdueInvoices: await this.prisma.invoice.count({ where: { status: InvoiceStatus.open, dueAt: { lt: now } } }),
      campaignsToFinalize: await this.prisma.campaign.count({ where: { status: CampaignStatus.active, endsAt: { lt: now } } }),
    };

    return {
      totals: { grossRevenueCents: gross.toString(), netCents: (gross - commission).toString(), payableCents: payable.toString(), activeMembers: activeMembersTotal, companies: tenants.length },
      leaderboard,
      attention,
    };
  }

  /** Tek sirket ozeti (KPI + aktif plan + ayar ozeti). */
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
        where: { tenantId: id, finalized: true, effectiveFrom: { lte: new Date() } },
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

  /**
   * Sirketi askiya al / yeniden aktive et (Faz C1 kill-switch). suspended → guard tum yazma/erisimi
   * keser (B1 ile uyumlu: yazmada aninda, api-key aninda, JWT okuma ~15dk). Audit'li.
   */

  /** Sirketin uye agi (flat node listesi — Ağaç/Liste gorunumu icin). */
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

  async setStatus(actorUserId: string, id: string, status: TenantStatus, reason?: string) {
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

  /**
   * Yeni sirket (tenant) kurar: tenant + varsayilan komisyon plani + owner uyeligi (kok, depth 0).
   * Owner kullanicisi yoksa gecici sifreyle olusturulur ve sifre BIR KEZ geri donulur.
   * Yalniz platform admin (controller guard'i) cagirir.
   */
  async createCompany(
    actorUserId: string,
    input: { name: string; slug: string; currency: string; timezone: string; ownerEmail: string; ownerName: string },
  ) {
    const slug = input.slug.toLowerCase();
    const email = input.ownerEmail.toLowerCase();

    if (await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } })) {
      throw new ConflictException('bu slug zaten kullaniliyor');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: input.name,
          currency: input.currency,
          timezone: input.timezone,
          maturationRule: 'on_delivery',
          payoutMinCents: 100_000n,
        },
      });

      // Varsayilan plan (%10 havuz, 5 kademe) — sirket plansiz kalmasin
      const plan = await tx.commissionPlan.create({
        data: {
          tenantId: tenant.id,
          version: 1,
          finalized: false,
          name: 'Standard Plan (10% pool, 5 levels)',
          poolRateBps: DEFAULT_POOL_RATE_BPS,
          depth: DEFAULT_LEVEL_RATES_BPS.length,
          effectiveFrom: new Date(),
          createdBy: actorUserId,
          levels: { create: DEFAULT_LEVEL_RATES_BPS.map((rateBps, level) => ({ level, rateBps })) },
        },
      });
      await tx.commissionPlan.update({ where: { id: plan.id }, data: { finalized: true } });

      // Owner kullanicisi: varsa kullan (mevcut hesap), yoksa gecici sifreyle olustur
      const existingUser = await tx.user.findUnique({ where: { email } });
      let tempPassword: string | null = null;
      let ownerUser = existingUser;
      if (!ownerUser) {
        tempPassword = `${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
        ownerUser = await tx.user.create({
          data: { email, passwordHash: await hash(tempPassword, ARGON2_OPTS), fullName: input.ownerName, emailVerifiedAt: new Date() },
        });
      }

      // Owner uyeligi: kok dugum (depth 0, sponsor yok), path tek INSERT'te (trigger-guvenli)
      const membershipId = newUuid();
      let ownerMembership: { id: string } | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          ownerMembership = await tx.membership.create({
            data: {
              id: membershipId,
              tenantId: tenant.id,
              userId: ownerUser.id,
              role: Role.tenant_owner,
              sponsorMembershipId: null,
              referralCode: randomCode(8),
              depth: 0,
              path: ltreeLabel(membershipId),
            },
            select: { id: true },
          });
          break;
        } catch (e) {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002' &&
            Array.isArray(e.meta?.target) &&
            (e.meta.target as string[]).includes('referral_code')
          ) {
            continue;
          }
          throw e;
        }
      }
      if (!ownerMembership) throw new ConflictException('referral kodu uretilemedi');

      if (!existingUser) {
        await tx.user.update({ where: { id: ownerUser.id }, data: { lastMembershipId: ownerMembership.id } });
      }

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId,
          action: 'tenant.create',
          entity: 'tenant',
          entityId: tenant.id,
          after: { slug: tenant.slug, name: tenant.name, ownerEmail: email, ownerMembershipId: ownerMembership.id },
        },
      });

      return { tenant, tempPassword, ownerExisting: !!existingUser };
    });

    return {
      id: result.tenant.id,
      slug: result.tenant.slug,
      name: result.tenant.name,
      ownerEmail: email,
      ownerExisting: result.ownerExisting,
      // gecici sifre yalniz YENI owner kullanicisi olusturulduysa doludur — bir kez goster
      tempPassword: result.tempPassword,
    };
  }
}
