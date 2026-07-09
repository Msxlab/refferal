import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  MembershipStatus,
  NotificationChannel,
  PayoutStatus,
  Prisma,
  Role,
  SaleStatus,
  TenantStatus,
  UserTokenPurpose,
} from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { DEFAULT_LEVEL_RATES_BPS, DEFAULT_POOL_RATE_BPS } from '@refearn/shared';
import { authConfig } from '../auth/auth.config';
import { ARGON2_OPTS } from '../auth/auth.service';
import { AccessTokenPayload } from '../auth/auth.types';
import { ltreeLabel, newUuid, randomCode, randomToken, sha256 } from '../common/crypto';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { BillingService } from './billing.service';

/** Kiracci-ustu platform yuzeyi (Axtra): sirketleri (tenant) yonet, agina drill-in. */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly jwt: JwtService,
    // Item 7: testte SchedulerModule hic import edilmiyor (app.module.ts:55) → burada Optional,
    // health() scheduler yoksa jobs: [] doner (process-local, restart'ta sifirlanir).
    @Optional() private readonly scheduler?: SchedulerService,
  ) {}

  /** Sirketler dizini: sayfali + durum/arama filtreli + TEK grouped ciro sorgusu (N+1 yok). */
  async companies(query: { page: number; pageSize: number; status?: TenantStatus; q?: string }) {
    const where: Prisma.TenantWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { slug: { contains: query.q.toLowerCase() } }] }
        : {}),
    };
    const [total, tenants] = await this.prisma.$transaction([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const ids = tenants.map((t) => t.id);

    const [byTenant, activeByTenant, revRows] = await Promise.all([
      this.prisma.membership.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }),
      this.prisma.membership.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids }, status: MembershipStatus.active },
        _count: { _all: true },
      }),
      // TEK sorgu: (tenant, ay) grubu; app-side her tenant'in KENDI timezone ayini secer
      this.prisma.sale.groupBy({
        by: ['tenantId', 'summaryMonth'],
        where: { tenantId: { in: ids }, status: SaleStatus.approved },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
    ]);
    const totalM = new Map(byTenant.map((r) => [r.tenantId, r._count._all]));
    const activeM = new Map(activeByTenant.map((r) => [r.tenantId, r._count._all]));
    const revM = new Map<string, { revenue: bigint; sales: number }>();
    for (const t of tenants) {
      const month = monthKey(new Date(), t.timezone);
      const row = revRows.find((r) => r.tenantId === t.id && r.summaryMonth === month);
      revM.set(t.id, { revenue: row?._sum.amountCents ?? 0n, sales: row?._count._all ?? 0 });
    }

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      rows: tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        currency: t.currency,
        status: t.status,
        timezone: t.timezone,
        members: totalM.get(t.id) ?? 0,
        activeMembers: activeM.get(t.id) ?? 0,
        revenueThisMonthCents: (revM.get(t.id)?.revenue ?? 0n).toString(),
        salesThisMonth: revM.get(t.id)?.sales ?? 0,
        createdAt: t.createdAt,
      })),
    };
  }

  /** Tek sirket ozeti (KPI + aktif plan + ayar ozeti). */
  async company(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('sirket bulunamadi');

    const month = monthKey(new Date(), t.timezone);
    const [members, activeMembers, rev, plan, payable] = await Promise.all([
      this.prisma.membership.count({ where: { tenantId: id } }),
      this.prisma.membership.count({ where: { tenantId: id, status: MembershipStatus.active } }),
      this.prisma.sale.aggregate({
        where: { tenantId: id, status: SaleStatus.approved, summaryMonth: month },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.commissionPlan.findFirst({
        where: { tenantId: id, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: 'desc' },
        select: { name: true, poolRateBps: true, depth: true },
      }),
      this.prisma.ledgerEntry.aggregate({ where: { tenantId: id, status: 'payable' }, _sum: { amountCents: true } }),
    ]);

    const branding = (t.branding ?? {}) as { logoUrl?: string; primaryHex?: string; accentHex?: string };
    const hasBranding = !!(branding.logoUrl || branding.primaryHex || branding.accentHex);
    const owner = await this.prisma.membership.findFirst({
      where: { tenantId: id, role: Role.tenant_owner },
      include: { user: { select: { emailVerifiedAt: true } } },
    });

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
        revenueThisMonthCents: (rev._sum.amountCents ?? 0n).toString(),
        salesThisMonth: rev._count._all,
        outstandingPayableCents: (payable._sum.amountCents ?? 0n).toString(),
      },
      plan: plan ? { name: plan.name, poolRateBps: plan.poolRateBps, depth: plan.depth } : null,
      setup: {
        hasPlan: plan !== null,
        hasBranding,
        hasOwnerAccepted: owner?.user.emailVerifiedAt !== null && owner !== null,
        memberCount: members,
      },
    };
  }

  /**
   * Sirketi askiya al / yeniden aktive et (Faz C1 kill-switch). suspended → guard tum yazma/erisimi
   * keser (B1 ile uyumlu: yazmada aninda, api-key aninda, JWT okuma ~15dk). Audit'li.
   */
  async setStatus(actorUserId: string, id: string, status: TenantStatus) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!t) throw new NotFoundException('sirket bulunamadi');
    if (status === TenantStatus.active) {
      const plan = await this.prisma.commissionPlan.findFirst({ where: { tenantId: id, effectiveFrom: { lte: new Date() } }, select: { id: true } });
      if (!plan) throw new BadRequestException('plansiz sirket aktive edilemez');
    }
    await this.prisma.tenant.update({ where: { id }, data: { status } });
    await this.prisma.auditLog.create({
      data: {
        tenantId: id, actorUserId, action: `platform.tenant_${status}`, entity: 'tenant', entityId: id,
        before: { status: t.status } as Prisma.InputJsonValue, after: { status } as Prisma.InputJsonValue,
      },
    });
    return { id, status };
  }

  /** Item 2: tenant.branding JSON'unu ayarla (sanitize edilmis hex/URL). Audit'li. */
  async setBranding(
    actorUserId: string,
    id: string,
    input: { logoUrl?: string | null; primaryHex?: string | null; accentHex?: string | null },
  ) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true, branding: true } });
    if (!t) throw new NotFoundException('sirket bulunamadi');
    const branding = {
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      ...(input.primaryHex !== undefined ? { primaryHex: input.primaryHex } : {}),
      ...(input.accentHex !== undefined ? { accentHex: input.accentHex } : {}),
    };
    await this.prisma.tenant.update({ where: { id }, data: { branding: branding as Prisma.InputJsonValue } });
    await this.prisma.auditLog.create({
      data: { tenantId: id, actorUserId, action: 'platform.tenant_branding', entity: 'tenant', entityId: id, after: branding as Prisma.InputJsonValue },
    });
    return { id, branding };
  }

  /** Sirketin uye agi (flat node listesi — Ağaç/Liste gorunumu icin). */
  async network(id: string) {
    const exists = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('sirket bulunamadi');

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

  /**
   * Yeni sirket (tenant) kurar: tenant + varsayilan komisyon plani + owner uyeligi (kok, depth 0).
   * Item 8: owner kullanicisi yoksa gecici sifre YERINE hash'li/suresi-dolan/tek-kullanimlik
   * owner_invite tokeni uretilir + e-posta bildirimi kuyruklanir (tempPassword hep null doner).
   * Mevcut owner (existingUser) yolu degismedi: token/e-posta yok, ownerExisting: true doner.
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
          status: TenantStatus.setup_needed,
        },
      });

      // Varsayilan plan (%10 havuz, 5 kademe) — sirket plansiz kalmasin
      await tx.commissionPlan.create({
        data: {
          tenantId: tenant.id,
          name: 'Standard Plan (10% pool, 5 levels)',
          poolRateBps: DEFAULT_POOL_RATE_BPS,
          depth: DEFAULT_LEVEL_RATES_BPS.length,
          effectiveFrom: new Date(),
          createdBy: actorUserId,
          levels: { create: DEFAULT_LEVEL_RATES_BPS.map((rateBps, level) => ({ level, rateBps })) },
        },
      });

      // Owner kullanicisi: varsa kullan (mevcut hesap), yoksa YENI olustur (item 8: temp sifre YOK —
      // e-posta davetiyle sifre belirlenir). Gecici rastgele hash login'i engeller.
      const existingUser = await tx.user.findUnique({ where: { email } });
      let ownerUser = existingUser;
      let isNewOwner = false;
      if (!ownerUser) {
        isNewOwner = true;
        ownerUser = await tx.user.create({
          data: { email, passwordHash: await hash(randomCode(24), ARGON2_OPTS), fullName: input.ownerName },
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

      return { tenant, ownerExisting: !!existingUser, isNewOwner, ownerUserId: ownerUser.id, ownerMembershipId: ownerMembership.id };
    });

    // Item 8: YENI owner icin davet tokeni + e-posta bildirimi TRANSACTION DISINDA (teslimat
    // hatasi tenant olusturmayi geri almasin). Mevcut owner yolu degismedi: token YOK.
    if (result.isNewOwner) {
      const raw = randomToken(32);
      await this.prisma.userToken.create({
        data: {
          userId: result.ownerUserId,
          purpose: UserTokenPurpose.owner_invite,
          tokenHash: sha256(raw),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      await this.prisma.notification.create({
        data: {
          tenantId: result.tenant.id,
          recipientMembershipId: result.ownerMembershipId,
          channel: NotificationChannel.email,
          template: 'owner_invite',
          payload: { token: raw, companyName: result.tenant.name },
        },
      });
    }

    return {
      id: result.tenant.id,
      slug: result.tenant.slug,
      name: result.tenant.name,
      ownerEmail: email,
      ownerExisting: result.ownerExisting,
      tempPassword: null, // item 8: gecici sifre yok — e-posta davet gonderilir
    };
  }

  /** Item 3: tenant uye listesi (flat, sayfali). where: { tenantId } — capraz-kiraci sizinti yok. */
  async members(id: string, q: { page: number; pageSize: number }) {
    const exists = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('sirket bulunamadi');
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.membership.count({ where: { tenantId: id } }),
      this.prisma.membership.findMany({
        where: { tenantId: id },
        orderBy: [{ depth: 'asc' }, { joinedAt: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { user: { select: { fullName: true, email: true } } },
      }),
    ]);
    return {
      total, page: q.page, pageSize: q.pageSize,
      rows: rows.map((m) => ({
        id: m.id, fullName: m.user.fullName, email: m.user.email,
        referralCode: m.referralCode, role: m.role, status: m.status, depth: m.depth, joinedAt: m.joinedAt,
      })),
    };
  }

  /** Item 3: tenant payout listesi (salt-okunur, sayfali). where: { tenantId }. */
  async payouts(id: string, q: { page: number; pageSize: number }) {
    const exists = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('sirket bulunamadi');
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payout.count({ where: { tenantId: id } }),
      this.prisma.payout.findMany({
        where: { tenantId: id },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { membership: { select: { referralCode: true, user: { select: { fullName: true } } } } },
      }),
    ]);
    return {
      total, page: q.page, pageSize: q.pageSize,
      rows: rows.map((p) => ({
        id: p.id, memberName: p.membership.user.fullName, referralCode: p.membership.referralCode,
        totalCents: p.totalCents.toString(), method: p.method, status: p.status, period: p.period,
        createdAt: p.createdAt, paidAt: p.paidAt,
      })),
    };
  }

  /**
   * Item 1: komuta-merkezi ozeti — KPI'lar + "ilgi bekleyenler" kuyrugu (her satir ucuz set sorgusu).
   * Askidaki tenant'lar no-member/no-plan gurultusune girmez (bilincli kapali).
   */
  async overview() {
    const now = new Date();
    const notSuspended = { status: { not: TenantStatus.suspended } as const };

    const [companies, active, suspended, memberCount, revRows, ar, tenants, membershipGroups, planGroups, stuckGroups, setupTenants] =
      await Promise.all([
        this.prisma.tenant.count(),
        this.prisma.tenant.count({ where: { status: TenantStatus.active } }),
        this.prisma.tenant.count({ where: { status: TenantStatus.suspended } }),
        this.prisma.membership.count(),
        this.prisma.sale.groupBy({ by: ['tenantId', 'summaryMonth'], where: { status: SaleStatus.approved }, _sum: { amountCents: true } }),
        this.billing.overview(),
        this.prisma.tenant.findMany({ where: notSuspended, select: { id: true, name: true, timezone: true } }),
        this.prisma.membership.groupBy({ by: ['tenantId'], _count: { _all: true } }),
        this.prisma.commissionPlan.findMany({ where: { effectiveFrom: { lte: now } }, distinct: ['tenantId'], select: { tenantId: true } }),
        this.prisma.payout.groupBy({
          by: ['tenantId'],
          where: { status: { in: [PayoutStatus.requested, PayoutStatus.processing] }, createdAt: { lt: new Date(now.getTime() - 72 * 3_600_000) } },
          _count: { _all: true },
        }),
        this.prisma.tenant.findMany({ where: { status: TenantStatus.setup_needed }, select: { id: true, name: true } }),
      ]);

    // platform revenue this month = sum of each tenant's own-tz current month
    let platformRevenue = 0n;
    for (const t of tenants) {
      const month = monthKey(now, t.timezone);
      const row = revRows.find((r) => r.tenantId === t.id && r.summaryMonth === month);
      platformRevenue += row?._sum.amountCents ?? 0n;
    }

    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    const withMembers = new Set(membershipGroups.filter((g) => g._count._all > 0).map((g) => g.tenantId));
    const withPlan = new Set(planGroups.map((g) => g.tenantId));
    const stuck = new Set(stuckGroups.map((g) => g.tenantId));

    type Row = { tenantId: string; tenantName: string; kind: string; severity: 'high' | 'warn'; detail: string; ctaHref: string };
    const rows: Row[] = [];
    const push = (id: string, kind: string, severity: 'high' | 'warn', detail: string, tab: string) =>
      rows.push({ tenantId: id, tenantName: nameOf.get(id) ?? id, kind, severity, detail, ctaHref: `/platform/companies/${id}?tab=${tab}` });

    for (const t of tenants) {
      if (!withMembers.has(t.id)) push(t.id, 'no_members', 'warn', 'No members yet', 'users');
      if (!withPlan.has(t.id)) push(t.id, 'no_plan', 'warn', 'No active plan', 'plans');
      if (stuck.has(t.id)) push(t.id, 'stuck_payout', 'high', 'Payout stuck > 72h', 'payouts');
    }
    for (const s of setupTenants) push(s.id, 'setup_incomplete', 'warn', 'Setup incomplete', 'overview');
    for (const inv of ar.invoices as Array<{ tenantId: string; overdue: boolean }>) {
      if (inv.overdue) push(inv.tenantId, 'overdue_billing', 'high', 'Overdue invoice', 'settings');
    }
    // dedupe by (tenantId, kind)
    const seen = new Set<string>();
    const needsAttention = rows.filter((r) => { const k = `${r.tenantId}:${r.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });

    return {
      kpis: {
        companies, active, suspended, members: memberCount,
        platformRevenueThisMonthCents: platformRevenue.toString(),
        ar: ar.totals,
      },
      needsAttention,
    };
  }

  /**
   * Item 4: platform-kapsamli impersonation — tenant OWNER'i olarak kisa-omurlu salt-okunur token
   * mint eder (uyelik GEREKTIRMEZ). imp=platformAdminUserId → guard GET disi her seyi bloklar.
   * Suspended tenant reddedilir; setup_needed izinli.
   */
  async impersonate(platformAdminUserId: string, id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { status: true } });
    if (!t) throw new NotFoundException('sirket bulunamadi');
    if (t.status === TenantStatus.suspended) throw new BadRequestException('askidaki sirkete girilemez');
    const owner = await this.prisma.membership.findFirst({
      where: { tenantId: id, role: Role.tenant_owner, status: MembershipStatus.active },
      select: { id: true },
    });
    if (!owner) throw new NotFoundException('sirketin aktif owner uyeligi yok');

    const payload: AccessTokenPayload = {
      sub: platformAdminUserId, mid: owner.id, tid: id, role: Role.tenant_owner, imp: platformAdminUserId,
    };
    const accessToken = await this.jwt.signAsync(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
    await this.prisma.auditLog.create({
      data: { tenantId: id, actorUserId: platformAdminUserId, action: 'security.platform_impersonate_start', entity: 'security', entityId: owner.id, after: { ownerMembershipId: owner.id } },
    });
    return { accessToken, membershipId: owner.id };
  }

  /** Item 4: impersonation bitti — platform admin'in normal tokeniyle, yalniz audit. */
  async impersonateEnd(platformAdminUserId: string, id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new NotFoundException('sirket bulunamadi');
    await this.prisma.auditLog.create({
      data: { tenantId: id, actorUserId: platformAdminUserId, action: 'security.platform_impersonate_end', entity: 'security', entityId: id, after: {} },
    });
    return { ended: true };
  }

  /** actorUserId → { name, email } (batch; null = 'system'). reports.service.resolveActors ile ayni kalip. */
  private async resolveActors(actorIds: Array<string | null>) {
    const ids = [...new Set(actorIds.filter((v): v is string => !!v))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } }) : [];
    const map = new Map(users.map((u) => [u.id, u]));
    return (id: string | null) => (id ? { name: map.get(id)?.fullName ?? id.slice(0, 8), email: map.get(id)?.email ?? null } : { name: 'system', email: null as string | null });
  }

  private auditWhere(q: { action?: string; entity?: string }): Prisma.AuditLogWhereInput {
    return { ...(q.action ? { action: q.action } : {}), ...(q.entity ? { entity: q.entity } : {}) };
  }

  /** Item 6: tek tenant audit (seq desc, sayfali). where: { tenantId }. */
  async companyAudit(id: string, q: { page: number; pageSize: number; action?: string; entity?: string }) {
    const exists = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('sirket bulunamadi');
    const where = { tenantId: id, ...this.auditWhere(q) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { seq: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const actorOf = await this.resolveActors(rows.map((a) => a.actorUserId));
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((a) => this.auditRow(a, actorOf)) };
  }

  /** Item 6: GLOBAL platform audit (capraz-kiraci — yaptirimli okuma). tenant adi join. */
  async globalAudit(q: { page: number; pageSize: number; action?: string; entity?: string }) {
    const where = this.auditWhere(q);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { seq: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const actorOf = await this.resolveActors(rows.map((a) => a.actorUserId));
    const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((v): v is string => !!v))];
    const tenants = tenantIds.length ? await this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((a) => ({ ...this.auditRow(a, actorOf), tenantName: a.tenantId ? nameOf.get(a.tenantId) ?? null : null })) };
  }

  private auditRow(a: { id: string; tenantId: string | null; action: string; entity: string; entityId: string | null; actorUserId: string | null; before: unknown; after: unknown; seq: bigint; createdAt: Date }, actorOf: (id: string | null) => { name: string; email: string | null }) {
    const actor = actorOf(a.actorUserId);
    return {
      seq: a.seq.toString(), tenantId: a.tenantId, action: a.action, entity: a.entity, entityId: a.entityId,
      actorUserId: a.actorUserId, actorName: actor.name, actorEmail: actor.email,
      before: a.before, after: a.after, createdAt: a.createdAt,
    };
  }

  /**
   * Item 5: yaptirimli capraz-kiraci arama. q<2 → bos. Her kategori 10 satirla sinirli.
   * PII (e-posta) doner — yalniz @PlatformAdmin(); global throttler ile korunur.
   */
  async search(q: string) {
    const term = q.trim();
    const empty = { users: [], members: [], sales: [], payouts: [] };
    if (term.length < 2) return empty;
    const codeNeedle = term.toUpperCase();

    const [users, members, sales, payouts] = await Promise.all([
      this.prisma.user.findMany({
        where: { OR: [{ email: { contains: term, mode: 'insensitive' } }, { fullName: { contains: term, mode: 'insensitive' } }] },
        take: 10,
        select: { id: true, email: true, fullName: true, memberships: { select: { tenantId: true, tenant: { select: { name: true } } } } },
      }),
      this.prisma.membership.findMany({
        where: { referralCode: { contains: codeNeedle } },
        include: { user: { select: { fullName: true, email: true } }, tenant: { select: { name: true } } },
        take: 10,
      }),
      this.prisma.sale.findMany({
        where: { OR: [{ externalRef: { contains: term } }, { customerRef: { contains: term, mode: 'insensitive' } }] },
        include: { tenant: { select: { name: true } } },
        take: 10,
      }),
      this.prisma.payout.findMany({
        where: { OR: [{ ref: { contains: term } }, ...(/^\d+$/.test(term) ? [{ checkNumber: Number(term) }] : [])] },
        include: { tenant: { select: { name: true } } },
        take: 10,
      }),
    ]);

    return {
      users: users.map((u) => ({
        userId: u.id, email: u.email, fullName: u.fullName,
        tenants: u.memberships.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenant.name })),
      })),
      members: members.map((m) => ({
        membershipId: m.id, referralCode: m.referralCode, fullName: m.user.fullName, email: m.user.email,
        tenantId: m.tenantId, tenantName: m.tenant.name, ctaHref: `/platform/companies/${m.tenantId}?tab=users`,
      })),
      sales: sales.map((s) => ({
        saleId: s.id, amountCents: s.amountCents.toString(), externalRef: s.externalRef, status: s.status,
        tenantId: s.tenantId, tenantName: s.tenant.name, ctaHref: `/platform/companies/${s.tenantId}?tab=overview`,
      })),
      payouts: payouts.map((p) => ({
        payoutId: p.id, totalCents: p.totalCents.toString(), ref: p.ref, checkNumber: p.checkNumber, status: p.status,
        tenantId: p.tenantId, tenantName: p.tenant.name, ctaHref: `/platform/companies/${p.tenantId}?tab=payouts`,
      })),
    };
  }

  /** Item 7: sistem paneli — DB ping + scheduler is sagligi + backup tazeligi. Sir/patika sizdirmaz. */
  async health() {
    let db = false;
    try { await this.prisma.$queryRaw`SELECT 1`; db = true; } catch { db = false; }
    const jobs = this.scheduler?.jobHealthWithStaleness() ?? [];
    const status = await this.prisma.systemStatus.findUnique({ where: { id: 'singleton' } }).catch(() => null);
    return { db, jobs, backups: { lastBackupAt: status?.lastBackupAt ?? null } };
  }
}
