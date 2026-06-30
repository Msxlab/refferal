import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Prisma, Role, SaleStatus, TenantStatus } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { DEFAULT_LEVEL_RATES_BPS, DEFAULT_POOL_RATE_BPS } from '@refearn/shared';
import { ARGON2_OPTS, AuthService } from '../auth/auth.service';
import { ltreeLabel, newUuid, randomCode } from '../common/crypto';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';

/** Kiracci-ustu platform yuzeyi (Axtra): sirketleri (tenant) yonet, agina drill-in. */
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

  /** Sirketler dizini + her sirket icin KPI (uye, aktif, bu-ay ciro, durum). */
  async companies() {
    const tenants = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });

    // tek seferde uye sayilari (toplam + aktif)
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

    // ciro: her sirketin kendi timezone'undaki bu ay (az sayida tenant — dongu kabul edilebilir)
    const revenues = await Promise.all(
      tenants.map((t) =>
        this.prisma.sale
          .aggregate({
            where: { tenantId: t.id, status: SaleStatus.approved, summaryMonth: monthKey(new Date(), t.timezone) },
            _sum: { amountCents: true },
            _count: { _all: true },
          })
          .then((a) => ({ id: t.id, revenue: a._sum.amountCents ?? 0n, sales: a._count._all })),
      ),
    );
    const revMap = new Map(revenues.map((r) => [r.id, r]));

    return tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      currency: t.currency,
      status: t.status,
      timezone: t.timezone,
      members: total.get(t.id) ?? 0,
      activeMembers: active.get(t.id) ?? 0,
      revenueThisMonthCents: (revMap.get(t.id)?.revenue ?? 0n).toString(),
      salesThisMonth: revMap.get(t.id)?.sales ?? 0,
      createdAt: t.createdAt,
    }));
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
    };
  }

  /**
   * Sirketi askiya al / yeniden aktive et (Faz C1 kill-switch). suspended → guard tum yazma/erisimi
   * keser (B1 ile uyumlu: yazmada aninda, api-key aninda, JWT okuma ~15dk). Audit'li.
   */
  async setStatus(actorUserId: string, id: string, status: TenantStatus) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!t) throw new NotFoundException('sirket bulunamadi');
    await this.prisma.tenant.update({ where: { id }, data: { status } });
    await this.prisma.auditLog.create({
      data: {
        tenantId: id, actorUserId, action: `platform.tenant_${status}`, entity: 'tenant', entityId: id,
        before: { status: t.status } as Prisma.InputJsonValue, after: { status } as Prisma.InputJsonValue,
      },
    });
    return { id, status };
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
