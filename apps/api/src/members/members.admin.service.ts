import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from '@node-rs/argon2';
import { InviteStatus, LedgerStatus, MembershipStatus, PayoutStatus, Prisma, Role, SaleStatus, TenantStatus } from '@prisma/client';
import { randomCode } from '../common/crypto';
import { authConfig } from '../auth/auth.config';
import { ARGON2_OPTS } from '../auth/auth.service';
import { AccessTokenPayload } from '../auth/auth.types';
import { monthKey } from '../engine/month';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipsService } from '../memberships/memberships.service';
import { ActorContext } from '../common/actor';
import { csvCell } from '../common/csv';

// Admin'in atayabilecegi roller (owner devri ve platform_admin bu uctan YAPILMAZ)
const ASSIGNABLE_ROLES: Role[] = [Role.tenant_admin, Role.tenant_staff, Role.member];

export type MemberSort = 'joinedAt' | 'fullName' | 'depth';
export type SortDir = 'asc' | 'desc';

@Injectable()
export class MembersAdminService {
  private readonly logger = new Logger(MembersAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly memberships: MembershipsService,
  ) {}

  /**
   * Guvenli impersonation: admin, bir uyenin /app panelini ONUN gozunden SALT-OKUNUR acar.
   * Kisa omurlu (15 dk) access token (imp = admin userId) doner; guard GET disi her seyi bloklar.
   * Owner/admin impersonate EDILEMEZ (yetki yukseltme onlenir). Baslangic audit'e yazilir.
   */
  async impersonate(actor: ActorContext, membershipId: string) {
    const m = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId: actor.tenantId },
      include: { user: { select: { id: true, fullName: true, email: true } }, tenant: { select: { id: true, name: true } } },
    });
    if (!m) throw new NotFoundException('uyelik bu isletmede bulunamadi');
    if (m.role === Role.tenant_owner || m.role === Role.tenant_admin) {
      throw new BadRequestException('admin/owner impersonate edilemez');
    }
    if (m.status !== MembershipStatus.active) {
      throw new BadRequestException('pasif uye impersonate edilemez');
    }
    const payload: AccessTokenPayload = {
      sub: m.user.id,
      mid: m.id,
      tid: actor.tenantId,
      role: m.role,
      imp: actor.userId,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: authConfig.accessSecret(),
      expiresIn: authConfig.accessTtlSeconds,
    });
    await this.audit(actor, 'security.impersonate_start', m.id, { targetUserId: m.user.id });
    return {
      accessToken,
      member: {
        membershipId: m.id,
        userId: m.user.id,
        fullName: m.user.fullName,
        email: m.user.email,
        referralCode: m.referralCode,
        role: m.role,
        tenantId: m.tenant.id,
        tenantName: m.tenant.name,
      },
    };
  }

  /** Impersonation bitti — admin'in normal tokeniyle cagrilir, yalniz audit yazar. */
  async impersonateEnd(actor: ActorContext, membershipId: string) {
    await this.audit(actor, 'security.impersonate_end', membershipId, {});
    return { ended: true };
  }

  /** list + export.csv ortak filtre (tenant-scoped). */
  private listWhere(tenantId: string, q: { search?: string; status?: MembershipStatus }): Prisma.MembershipWhereInput {
    return {
      tenantId,
      status: q.status,
      ...(q.search
        ? {
            OR: [
              { referralCode: { contains: q.search, mode: 'insensitive' } },
              { user: { fullName: { contains: q.search, mode: 'insensitive' } } },
              { user: { email: { contains: q.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  async list(
    tenantId: string,
    q: { search?: string; status?: MembershipStatus; sort: MemberSort; dir: SortDir; page: number; pageSize: number },
  ) {
    const where = this.listWhere(tenantId, q);
    // varsayilan (joinedAt asc) onceki davranisla birebir ayni
    const orderBy: Prisma.MembershipOrderByWithRelationInput =
      q.sort === 'fullName' ? { user: { fullName: q.dir } } : q.sort === 'depth' ? { depth: q.dir } : { joinedAt: q.dir };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.membership.count({ where }),
      this.prisma.membership.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          user: { select: { fullName: true, email: true, emailVerifiedAt: true } },
          sponsor: { select: { referralCode: true } },
        },
      }),
    ]);

    // sayfadaki uyeler icin yasam-boyu SATTIGI (onayli ciro) + KAZANDIGI (payable+paid komisyon)
    const ids = rows.map((m) => m.id);
    const [soldAgg, earnAgg] = ids.length
      ? await Promise.all([
          this.prisma.sale.groupBy({ by: ['sellerMembershipId'], where: { tenantId, status: SaleStatus.approved, sellerMembershipId: { in: ids } }, _sum: { amountCents: true } }),
          this.prisma.ledgerEntry.groupBy({ by: ['beneficiaryMembershipId'], where: { tenantId, status: { in: [LedgerStatus.payable, LedgerStatus.paid] }, beneficiaryMembershipId: { in: ids } }, _sum: { amountCents: true } }),
        ])
      : [[], []];
    const soldBy = new Map(soldAgg.map((s) => [s.sellerMembershipId, s._sum.amountCents ?? 0n]));
    const earnBy = new Map(earnAgg.map((e) => [e.beneficiaryMembershipId, e._sum.amountCents ?? 0n]));

    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((m) => ({
        id: m.id,
        fullName: m.user.fullName,
        email: m.user.email,
        emailVerified: m.user.emailVerifiedAt !== null,
        referralCode: m.referralCode,
        role: m.role,
        status: m.status,
        depth: m.depth,
        sponsorReferralCode: m.sponsor?.referralCode ?? null,
        soldCents: (soldBy.get(m.id) ?? 0n).toString(),
        earnedCents: (earnBy.get(m.id) ?? 0n).toString(),
        joinedAt: m.joinedAt,
      })),
    };
  }

  /** Uye listesi CSV exportu (STAFF): list ile ayni search/status filtreleri. */
  async exportCsv(tenantId: string, q: { search?: string; status?: MembershipStatus }): Promise<string> {
    const rows = await this.prisma.membership.findMany({
      where: this.listWhere(tenantId, q),
      orderBy: { joinedAt: 'asc' },
      include: {
        user: { select: { fullName: true, email: true, emailVerifiedAt: true } },
        sponsor: { select: { referralCode: true } },
      },
    });

    const header = 'referral_code,full_name,email,role,status,depth,sponsor_code,joined_at,email_verified';
    const lines = rows.map((m) =>
      [
        csvCell(m.referralCode),
        csvCell(m.user.fullName),
        csvCell(m.user.email),
        m.role,
        m.status,
        String(m.depth),
        csvCell(m.sponsor?.referralCode ?? ''),
        m.joinedAt.toISOString(),
        m.user.emailVerifiedAt ? 'true' : 'false',
      ].join(','),
    );
    return [header, ...lines].join('\n') + '\n';
  }

  /**
   * 360 derece uye detayi (STAFF): profil + sayisal ozetler + son hareketler.
   * Tum sorgular tenant-scoped; cent alanlari string (BigInt serialize).
   */
  async detail(tenantId: string, membershipId: string) {
    const m = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      include: {
        user: { select: { fullName: true, email: true, emailVerifiedAt: true } },
        sponsor: { select: { id: true, referralCode: true, user: { select: { fullName: true } } } },
      },
    });
    if (!m) throw new NotFoundException('uyelik bu isletmede bulunamadi');

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const month = monthKey(new Date(), tenant.timezone);

    const [directs, salesAllTime, salesThisMonth, ledgerByStatus, invitesByStatus, recentSales, recentLedger] =
      await Promise.all([
        this.prisma.membership.count({ where: { tenantId, sponsorMembershipId: m.id } }),
        this.prisma.sale.aggregate({
          where: { tenantId, sellerMembershipId: m.id, status: SaleStatus.approved },
          _count: { _all: true },
          _sum: { amountCents: true },
        }),
        // summaryMonth ilk apply'da dondurulur — "bu ay" bucket'i tenant timezone'una gore
        this.prisma.sale.aggregate({
          where: { tenantId, sellerMembershipId: m.id, status: SaleStatus.approved, summaryMonth: month },
          _count: { _all: true },
          _sum: { amountCents: true },
        }),
        // wallet.service.ts balance kalibi: reversed HARIC, status'e gore grupla
        this.prisma.ledgerEntry.groupBy({
          by: ['status'],
          where: { tenantId, beneficiaryMembershipId: m.id, status: { not: LedgerStatus.reversed } },
          _sum: { amountCents: true },
        }),
        this.prisma.invite.groupBy({
          by: ['status'],
          where: { tenantId, inviterMembershipId: m.id },
          _count: { _all: true },
        }),
        this.prisma.sale.findMany({
          where: { tenantId, sellerMembershipId: m.id },
          orderBy: { saleDate: 'desc' },
          take: 10,
          select: { id: true, saleDate: true, amountCents: true, status: true },
        }),
        this.prisma.ledgerEntry.findMany({
          where: { tenantId, beneficiaryMembershipId: m.id },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, saleId: true, level: true, type: true, status: true, amountCents: true, createdAt: true },
        }),
      ]);

    const bucket = (s: LedgerStatus) => ledgerByStatus.find((g) => g.status === s)?._sum.amountCents ?? 0n;
    const inviteCount = (s: InviteStatus) => invitesByStatus.find((g) => g.status === s)?._count._all ?? 0;
    const invitesTotal = invitesByStatus.reduce((acc, g) => acc + g._count._all, 0);

    return {
      profile: {
        id: m.id,
        fullName: m.user.fullName,
        email: m.user.email,
        emailVerified: m.user.emailVerifiedAt !== null,
        referralCode: m.referralCode,
        role: m.role,
        status: m.status,
        depth: m.depth,
        joinedAt: m.joinedAt,
        sponsor: m.sponsor
          ? { membershipId: m.sponsor.id, name: m.sponsor.user.fullName, code: m.sponsor.referralCode }
          : null,
      },
      stats: {
        directs,
        sales: {
          allTime: { count: salesAllTime._count._all, cents: (salesAllTime._sum.amountCents ?? 0n).toString() },
          thisMonth: { count: salesThisMonth._count._all, cents: (salesThisMonth._sum.amountCents ?? 0n).toString() },
        },
        commission: {
          pendingCents: bucket(LedgerStatus.pending).toString(),
          payableCents: bucket(LedgerStatus.payable).toString(),
          paidCents: bucket(LedgerStatus.paid).toString(),
        },
        invites: {
          total: invitesTotal,
          used: inviteCount(InviteStatus.used),
          pending: inviteCount(InviteStatus.active),
        },
      },
      recentSales: recentSales.map((s) => ({
        id: s.id,
        saleDate: s.saleDate,
        amountCents: s.amountCents.toString(),
        status: s.status,
      })),
      recentLedger: recentLedger.map((e) => ({
        id: e.id,
        saleId: e.saleId,
        level: e.level,
        type: e.type,
        status: e.status,
        amountCents: e.amountCents.toString(),
        createdAt: e.createdAt,
      })),
    };
  }

  /** Admin davet olusturur: sponsor (kod veya id) tenant icinde olmali; varsayilan = admin kendisi. */
  async invite(actor: ActorContext, actorMembershipId: string, input: { sponsorReferralCode?: string; sponsorMembershipId?: string; email?: string }) {
    let sponsorId = actorMembershipId;
    if (input.sponsorMembershipId || input.sponsorReferralCode) {
      const sponsor = await this.prisma.membership.findFirst({
        where: {
          tenantId: actor.tenantId,
          ...(input.sponsorMembershipId ? { id: input.sponsorMembershipId } : { referralCode: input.sponsorReferralCode }),
        },
        select: { id: true, status: true },
      });
      if (!sponsor) throw new NotFoundException('sponsor uyeligi bu isletmede bulunamadi');
      if (sponsor.status !== MembershipStatus.active) throw new BadRequestException('sponsor aktif degil');
      sponsorId = sponsor.id;
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
    if (tenant.status !== TenantStatus.active) throw new BadRequestException('isletme aktif degil');

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const invite = await this.prisma.invite.create({
          data: {
            tenantId: actor.tenantId,
            inviterMembershipId: sponsorId,
            code: randomCode(10),
            email: input.email?.toLowerCase(),
            expiresAt: new Date(Date.now() + authConfig.inviteTtlMs),
          },
          select: { id: true, code: true, email: true, expiresAt: true, status: true, inviterMembershipId: true },
        });
        await this.audit(actor, 'invite.create', invite.id, { sponsorId, email: invite.email });
        return invite;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new BadRequestException('davet kodu uretilemedi');
  }

  /**
   * Manuel uye olusturma (Dalga 2): davet beklemeden, owner bilinen bir kisiyi dogrudan girer.
   * User + Membership tek transaction'da. Sponsor bossa actor (owner) altina. E-posta zaten varsa
   * ayni hesaba ikinci uyelik baglanir (registerByInvite mantigiyla). credential='temp_password' ise
   * gecici sifre uretilir/alinir ve BIR KEZ donulur (admin paylasir); yoksa kullanici mevcut sifresini korur.
   */
  async createManual(
    actor: ActorContext,
    actorMembershipId: string,
    input: { fullName: string; email: string; sponsorReferralCode?: string; sponsorMembershipId?: string; role?: Role; tempPassword?: string; asLeader?: boolean },
  ) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
    if (tenant.status !== TenantStatus.active) throw new BadRequestException('isletme aktif degil');

    // asLeader=true ve sponsor verilmemisse: yeni KOK lider (agacin tepesinde, sponsorsuz).
    const asRoot = !!input.asLeader && !input.sponsorMembershipId && !input.sponsorReferralCode;

    // sponsor: belirtilmezse actor (owner) altina yerlesir (kok lider degilse)
    let sponsor: { id: string; path: string; depth: number; tenantId: string } | null = null;
    if (!asRoot) {
      let sponsorId = actorMembershipId;
      if (input.sponsorMembershipId || input.sponsorReferralCode) {
        const s = await this.prisma.membership.findFirst({
          where: { tenantId: actor.tenantId, ...(input.sponsorMembershipId ? { id: input.sponsorMembershipId } : { referralCode: input.sponsorReferralCode }) },
          select: { id: true, status: true },
        });
        if (!s) throw new NotFoundException('sponsor uyeligi bu isletmede bulunamadi');
        if (s.status !== MembershipStatus.active) throw new BadRequestException('sponsor aktif degil');
        sponsorId = s.id;
      }
      sponsor = await this.prisma.membership.findUniqueOrThrow({
        where: { id: sponsorId }, select: { id: true, path: true, depth: true, tenantId: true },
      });
    }

    const email = input.email.trim().toLowerCase();
    const role = input.role && ASSIGNABLE_ROLES.includes(input.role) ? input.role : Role.member;

    const out = await this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email } });
      let tempPassword: string | null = null;
      if (!user) {
        tempPassword = input.tempPassword?.trim() || randomCode(12);
        user = await tx.user.create({
          data: { email, fullName: input.fullName.trim(), passwordHash: await hash(tempPassword, ARGON2_OPTS), emailVerifiedAt: new Date() },
        });
      } else {
        const dup = await tx.membership.findFirst({ where: { tenantId: actor.tenantId, userId: user.id }, select: { id: true } });
        if (dup) throw new ConflictException('bu e-postali kullanici zaten bu isletmede uye');
      }
      const membership = asRoot
        ? await this.memberships.createRoot(tx, { tenantId: actor.tenantId, userId: user.id, role, isTeamLeader: true })
        : await this.memberships.createUnder(tx, { tenantId: actor.tenantId, userId: user.id, sponsor: sponsor!, role });
      return { membership, tempPassword, newUser: tempPassword !== null };
    }, { timeout: 15_000 });

    await this.audit(actor, 'membership.create_manual', out.membership.id, { email, sponsorId: sponsor?.id ?? null, role, newUser: out.newUser, asLeader: asRoot });
    return {
      id: out.membership.id,
      referralCode: out.membership.referralCode,
      role: out.membership.role,
      isTeamLeader: out.membership.isTeamLeader,
      newUser: out.newUser,
      ...(out.tempPassword ? { tempPassword: out.tempPassword } : {}),
    };
  }

  /** Uye profilini duzenle (Dalga 2.2): ad/e-posta. E-posta benzersizligi korunur. Yerlesime dokunmaz. */
  async updateProfile(actor: ActorContext, membershipId: string, input: { fullName?: string; email?: string }) {
    const m = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId: actor.tenantId },
      select: { id: true, userId: true, user: { select: { email: true, fullName: true } } },
    });
    if (!m) throw new NotFoundException('uyelik bu isletmede bulunamadi');

    const email = input.email?.trim().toLowerCase();
    if (email && email !== m.user.email) {
      const taken = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (taken && taken.id !== m.userId) throw new ConflictException('bu e-posta baska bir hesapta kullaniliyor');
    }
    try {
      await this.prisma.user.update({
        where: { id: m.userId },
        data: {
          ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}),
          // e-posta degisirse yeniden dogrulama gerekir
          ...(email && email !== m.user.email ? { email, emailVerifiedAt: null } : {}),
        },
      });
    } catch (e) {
      // on-kontrol ile update arasinda eszamanli ekleme email unique kisitini cigneyebilir → ham 500 yerine 409
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('bu e-posta baska bir hesapta kullaniliyor');
      }
      throw e;
    }
    await this.audit(actor, 'membership.update_profile', m.id, { fullName: input.fullName, emailChanged: !!email && email !== m.user.email });
    return { id: m.id };
  }

  /** Bir uyeyi takim lideri isaretle/kaldir (Dalga 3). Yerlesimi DEGISTIRMEZ — sadece bayrak. */
  async setLeader(actor: ActorContext, membershipId: string, isTeamLeader: boolean) {
    const m = await this.requireInTenant(actor.tenantId, membershipId);
    // takim lideri = saha temsilcisi (member/staff); owner/admin "lider" diye etiketlenmez (yanlis kok)
    if (isTeamLeader && (m.role === Role.tenant_owner || m.role === Role.tenant_admin)) {
      throw new BadRequestException('owner/admin takim lideri olarak isaretlenemez');
    }
    if (m.isTeamLeader === isTeamLeader) return { id: m.id, isTeamLeader };
    await this.prisma.membership.update({ where: { id: m.id }, data: { isTeamLeader } });
    await this.audit(actor, isTeamLeader ? 'membership.set_leader' : 'membership.unset_leader', m.id, { isTeamLeader });
    return { id: m.id, isTeamLeader };
  }

  /**
   * Takim liderleri (Dalga 3): isTeamLeader=true her uye + CANLI grup ozeti — alt-agac (ltree
   * path <@ lider.path) bu-ay grup cirosu + bu-ay grup komisyonu + ekip boyu. Owner'in kendi
   * "tum sirket" kokunu da basa ekler. "10 lider = 10 agac" landing'i bunu besler.
   */
  async leaders(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const month = monthKey(new Date(), tenant.timezone);
    const leadersAll = await this.prisma.membership.findMany({
      where: { tenantId, OR: [{ isTeamLeader: true }, { sponsorMembershipId: null }] },
      orderBy: [{ depth: 'asc' }, { joinedAt: 'asc' }],
      include: { user: { select: { fullName: true } } },
    });
    // Sinir: cok sayida lider varsa N round-trip'i sinirla (landing performansi).
    // Asimda log + kirpma yapilir; donen sekil degismez (sirali: depth/joinedAt).
    const MAX_LEADERS = 200;
    const leaders = leadersAll.slice(0, MAX_LEADERS);
    if (leadersAll.length > MAX_LEADERS) {
      this.logger.warn(`leaders(): tenant ${tenantId} icin ${leadersAll.length} lider, ${MAX_LEADERS} ile kirpildi`);
    }

    const rows = await Promise.all(
      leaders.map(async (l) => {
        // Tek round-trip: alt-agac (ltree path <@ lider.path) uzerinden ekip boyu +
        // bu-ay grup cirosu (onayli sales) + bu-ay grup komisyonu (monthly_summaries).
        // Toplamlar ::bigint cast'li — $queryRaw native bigint dondursun (para BigInt kalir).
        const agg = await this.prisma.$queryRaw<
          Array<{ team_size: bigint; vol_cents: bigint; comm_cents: bigint }>
        >`
          WITH sub AS (
            SELECT id FROM memberships
            WHERE tenant_id = ${tenantId}::uuid AND path::ltree <@ ${l.path}::ltree
          )
          SELECT
            (SELECT count(*)::bigint FROM sub) AS team_size,
            COALESCE((
              SELECT sum(s.amount_cents)::bigint FROM sales s
              WHERE s.tenant_id = ${tenantId}::uuid
                AND s.status = ${SaleStatus.approved}::"SaleStatus"
                AND s.summary_month = ${month}
                AND s.seller_membership_id IN (SELECT id FROM sub)
            ), 0)::bigint AS vol_cents,
            COALESCE((
              SELECT sum(ms.pending_cents + ms.payable_cents + ms.paid_cents)::bigint
              FROM monthly_summaries ms
              WHERE ms.tenant_id = ${tenantId}::uuid
                AND ms.month = ${month}
                AND ms.membership_id IN (SELECT id FROM sub)
            ), 0)::bigint AS comm_cents`;
        const r = agg[0];
        const teamSize = Number(r?.team_size ?? 0n) - 1; // kendisi haric
        return {
          id: l.id,
          fullName: l.user.fullName,
          referralCode: l.referralCode,
          role: l.role,
          isTeamLeader: l.isTeamLeader,
          isOwnerRoot: l.sponsorMembershipId === null && !l.isTeamLeader,
          teamSize: Math.max(0, teamSize),
          monthlyGroupVolumeCents: (r?.vol_cents ?? 0n).toString(),
          monthlyGroupCommissionCents: (r?.comm_cents ?? 0n).toString(),
        };
      }),
    );
    // Sessiz kirpmayi GORUNUR yap: FE 'N / M gosteriliyor' uyarisi cizebilsin.
    return { month, totalLeaders: leadersAll.length, shownLeaders: rows.length, truncated: leadersAll.length > MAX_LEADERS, leaders: rows };
  }

  /**
   * Ag saglik panosu (salt-okunur agregat): pasif kume, bu-ay satissiz aktif uye orani.
   * STAFF/ADMIN yuzeyi — isim+sayim doner; member-facing /app/team gizlilik kontratindan AYRI.
   * Tum sorgular salt-okunur (yerlesim/path'e dokunmaz).
   */
  async networkHealth(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const month = monthKey(new Date(), tenant.timezone);

    // 1) durum dagilimi
    const statusRows = await this.prisma.membership.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } });
    const members = statusRows.reduce((a, r) => a + r._count._all, 0);
    const active = statusRows.find((r) => r.status === MembershipStatus.active)?._count._all ?? 0;
    const inactive = members - active;

    // 2) bu ay onayli satis yapan DISTINCT satici -> satissiz aktif uye orani (retention sinyali)
    const sellers = await this.prisma.sale.findMany({
      where: { tenantId, status: SaleStatus.approved, summaryMonth: month },
      distinct: ['sellerMembershipId'],
      select: { sellerMembershipId: true },
    });
    const noSaleCount = Math.max(0, active - sellers.length);
    const noSaleActive = { count: noSaleCount, total: active, pct: active > 0 ? Math.round((noSaleCount / active) * 100) : 0 };

    // 3) pasif kumeler: lider (isTeamLeader|root), ekibi var ama alt-agaci BU AY $0 satis
    const leaders = await this.prisma.membership.findMany({
      where: { tenantId, OR: [{ isTeamLeader: true }, { sponsorMembershipId: null }] },
      orderBy: [{ depth: 'asc' }, { joinedAt: 'asc' }],
      take: 200,
      select: { id: true, referralCode: true, user: { select: { fullName: true } } },
    });
    let dormantClusters: Array<{ leaderId: string; leaderName: string; referralCode: string; teamSize: number }> = [];
    if (leaders.length > 0) {
      const leaderIds = leaders.map((l) => l.id);
      // ekip boyu (kendisi haric) — tek ltree self-join
      const teamRows = await this.prisma.$queryRaw<Array<{ id: string; team: bigint }>>(Prisma.sql`
        SELECT l.id::text AS id, count(d.id)::bigint AS team
        FROM memberships l
        JOIN memberships d ON d.tenant_id = l.tenant_id AND d.path::ltree <@ l.path::ltree
        WHERE l.tenant_id = ${tenantId}::uuid AND l.id::text IN (${Prisma.join(leaderIds)})
        GROUP BY l.id`);
      const teamById = new Map(teamRows.map((r) => [r.id, Math.max(0, Number(r.team) - 1)]));
      // bu ay alt-agacta >=1 onayli satisi olan liderler
      const soldRows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT DISTINCT l.id::text AS id
        FROM memberships l
        JOIN memberships d ON d.tenant_id = l.tenant_id AND d.path::ltree <@ l.path::ltree
        JOIN sales s ON s.tenant_id = l.tenant_id AND s.seller_membership_id = d.id
          AND s.status = ${SaleStatus.approved}::"SaleStatus" AND s.summary_month = ${month}
        WHERE l.tenant_id = ${tenantId}::uuid AND l.id::text IN (${Prisma.join(leaderIds)})`);
      const soldLeaderIds = new Set(soldRows.map((r) => r.id));
      dormantClusters = leaders
        .filter((l) => !soldLeaderIds.has(l.id) && (teamById.get(l.id) ?? 0) > 0)
        .map((l) => ({ leaderId: l.id, leaderName: l.user.fullName, referralCode: l.referralCode, teamSize: teamById.get(l.id) ?? 0 }))
        .sort((a, b) => b.teamSize - a.teamSize)
        .slice(0, 20);
    }

    return { month, totals: { members, active, inactive }, noSaleActive, dormantClusters };
  }

  async setStatus(actor: ActorContext, membershipId: string, status: MembershipStatus) {
    const m = await this.requireInTenant(actor.tenantId, membershipId);
    // owner pasife alinamaz: tenant'i aktif owner'siz birakmayi onler (setRole owner-guard'i ile simetrik)
    if (m.role === Role.tenant_owner && status === MembershipStatus.inactive) {
      throw new BadRequestException('owner uyeligi pasife alinamaz');
    }
    if (m.status === status) return { id: m.id, status };
    const updated = await this.prisma.membership.update({ where: { id: m.id }, data: { status } });
    // pasiflestirmede bu uyeligin canli API anahtarlarini iptal et (kullanici-disi erisim de kesilsin)
    if (status === MembershipStatus.inactive) {
      const revoked = await this.prisma.apiKey.updateMany({
        where: { tenantId: actor.tenantId, membershipId: m.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count > 0) await this.audit(actor, 'apikey.revoke_cascade', m.id, { reason: 'deactivate', count: revoked.count });
    }
    await this.audit(actor, status === MembershipStatus.inactive ? 'membership.deactivate' : 'membership.activate', m.id, {
      from: m.status,
      to: status,
    });
    return { id: updated.id, status: updated.status };
  }

  /**
   * Toplu islem (ADMIN): activate | deactivate | set_role. preview=true ise HICBIR SEY
   * yazilmaz — etki ozeti doner (kac uye degisecek, kac owner/no-op atlanacak, kaci acik
   * payout talebinde). Uygulama: tekil setStatus/setRole yeniden kullanilir (her biri audit'li).
   */
  async bulk(
    actor: ActorContext,
    input: { action: 'activate' | 'deactivate' | 'set_role'; ids: string[]; role?: Role; preview?: boolean },
  ) {
    const rows = await this.prisma.membership.findMany({
      where: { id: { in: input.ids }, tenantId: actor.tenantId },
      select: { id: true, role: true, status: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    // dry-run: her id icin uygulanacak/atlanacak kararini hesapla (mutasyon yok)
    if (input.preview) {
      let willChange = 0;
      const skipped: Array<{ id: string; reason: string }> = [];
      for (const id of input.ids) {
        const m = byId.get(id);
        if (!m) { skipped.push({ id, reason: 'bulunamadi' }); continue; }
        if (input.action === 'set_role') {
          if (m.role === Role.tenant_owner) { skipped.push({ id, reason: 'owner rolu degismez' }); continue; }
          if (m.role === input.role) { skipped.push({ id, reason: 'zaten bu rolde' }); continue; }
          willChange++;
        } else {
          const target = input.action === 'activate' ? MembershipStatus.active : MembershipStatus.inactive;
          if (m.role === Role.tenant_owner && target === MembershipStatus.inactive) { skipped.push({ id, reason: 'owner pasife alinamaz' }); continue; }
          if (m.status === target) { skipped.push({ id, reason: 'zaten bu durumda' }); continue; }
          willChange++;
        }
      }
      // pasiflestirmede etkilenecek acik payout talepleri (operasyonel uyari)
      let openPayoutRequests = 0;
      if (input.action === 'deactivate') {
        openPayoutRequests = await this.prisma.payout.count({
          where: { tenantId: actor.tenantId, membershipId: { in: input.ids }, status: PayoutStatus.requested },
        });
      }
      return { preview: true as const, total: input.ids.length, willChange, skipped, openPayoutRequests };
    }

    const succeeded: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of input.ids) {
      try {
        if (input.action === 'set_role') {
          if (!input.role) throw new Error('rol gerekli');
          await this.setRole(actor, id, input.role);
        } else {
          await this.setStatus(actor, id, input.action === 'activate' ? MembershipStatus.active : MembershipStatus.inactive);
        }
        succeeded.push(id);
      } catch (e) {
        failed.push({ id, reason: e instanceof Error ? e.message : 'bilinmeyen hata' });
      }
    }
    return { action: input.action, succeeded: succeeded.length, failed };
  }

  async setRole(actor: ActorContext, membershipId: string, role: Role) {
    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw new BadRequestException('bu rol bu uctan atanamaz');
    }
    const m = await this.requireInTenant(actor.tenantId, membershipId);
    if (m.role === Role.tenant_owner) {
      throw new BadRequestException('owner rolu bu uctan degistirilemez');
    }
    const updated = await this.prisma.membership.update({ where: { id: m.id }, data: { role } });
    // rol degisiminde bu uyeligin canli API anahtarlarini iptal et -- saklanmis eski yetkiyle calismaya devam etmesin
    if (role !== m.role) {
      const revoked = await this.prisma.apiKey.updateMany({
        where: { tenantId: actor.tenantId, membershipId: m.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count > 0) await this.audit(actor, 'apikey.revoke_cascade', m.id, { reason: 'role_change', from: m.role, to: role, count: revoked.count });
    }
    await this.audit(actor, 'membership.set_role', m.id, { from: m.role, to: role });
    return { id: updated.id, role: updated.role };
  }

  /**
   * Agac gorunumu (SPEC 9): tenant'taki tum uyeler + parent/depth (gorsellestirme icin).
   * Her dugume BU AY (tenant timezone, summaryMonth) approved satis sayisi + cirosu eklenir
   * (tek groupBy — node basina sorgu YOK). teamSize frontend'de hesaplanir.
   */
  async tree(tenantId: string, rootMembershipId?: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const month = monthKey(new Date(), tenant.timezone);

    // root verilirse YALNIZ o liderin alt-agaci (ltree path <@ root.path) — "tek lider, tek agac"
    let pathFilter: Prisma.MembershipWhereInput = {};
    if (rootMembershipId) {
      const root = await this.prisma.membership.findFirst({ where: { id: rootMembershipId, tenantId }, select: { id: true, path: true } });
      if (!root) throw new NotFoundException('lider/kok uyelik bu isletmede bulunamadi');
      const sub = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM memberships WHERE tenant_id = ${tenantId}::uuid AND path::ltree <@ ${root.path}::ltree`;
      pathFilter = { id: { in: sub.map((r) => r.id) } };
    }

    const [nodes, salesAgg, earnAgg, monthlyAgg] = await Promise.all([
      this.prisma.membership.findMany({
        where: { tenantId, ...pathFilter },
        orderBy: [{ depth: 'asc' }, { joinedAt: 'asc' }],
        include: { user: { select: { fullName: true } } },
      }),
      this.prisma.sale.groupBy({
        by: ['sellerMembershipId'],
        where: { tenantId, status: SaleStatus.approved, summaryMonth: month },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      // yasam-boyu kazanc (payable + paid) — isi haritasi + KPI + uye detayi icin
      this.prisma.ledgerEntry.groupBy({
        by: ['beneficiaryMembershipId'],
        where: { tenantId, status: { in: [LedgerStatus.payable, LedgerStatus.paid] } },
        _sum: { amountCents: true },
      }),
      // BU AY komisyon (pending+payable+paid) — "canli aylik komisyon" (urunun cekirdek vaadi)
      this.prisma.monthlySummary.groupBy({
        by: ['membershipId'],
        where: { tenantId, month },
        _sum: { pendingCents: true, payableCents: true, paidCents: true },
      }),
    ]);
    const bySeller = new Map(salesAgg.map((s) => [s.sellerMembershipId, s]));
    const byBenef = new Map(earnAgg.map((e) => [e.beneficiaryMembershipId, e._sum.amountCents ?? 0n]));
    const byMonthly = new Map(
      monthlyAgg.map((g) => [g.membershipId, (g._sum.pendingCents ?? 0n) + (g._sum.payableCents ?? 0n) + (g._sum.paidCents ?? 0n)]),
    );

    // teamSize (alt-agac kisi sayisi, kendisi haric) + subtreeRevenueCents (dugum + tum torunlarin
    // bu-ay cirosu). Eskiden NetworkExplorer client'ta recursive hesapliyordu (her render'da, yavas);
    // burada TEK GECISTE hesaplanir: nodes derinlik-artan sirali geldigi icin TERSTEN (en derin once)
    // her dugumun toplamini parent'ina yukleriz — recursion/self-join yok, O(n).
    const teamSize = new Map<string, number>();
    const subtreeRev = new Map<string, bigint>();
    for (const m of nodes) {
      teamSize.set(m.id, 0);
      subtreeRev.set(m.id, bySeller.get(m.id)?._sum.amountCents ?? 0n);
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const m = nodes[i];
      const pid = m.sponsorMembershipId;
      if (pid && teamSize.has(pid)) {
        teamSize.set(pid, teamSize.get(pid)! + teamSize.get(m.id)! + 1); // bu cocuk + onun alt-takimi
        subtreeRev.set(pid, subtreeRev.get(pid)! + subtreeRev.get(m.id)!);
      }
    }

    return nodes.map((m) => {
      const agg = bySeller.get(m.id);
      return {
        id: m.id,
        parentId: m.sponsorMembershipId,
        fullName: m.user.fullName,
        referralCode: m.referralCode,
        role: m.role,
        status: m.status,
        depth: m.depth,
        isTeamLeader: m.isTeamLeader,
        joinedAt: m.joinedAt.toISOString(),
        salesCount: agg?._count._all ?? 0,
        revenueCents: (agg?._sum.amountCents ?? 0n).toString(),
        earningsCents: (byBenef.get(m.id) ?? 0n).toString(),
        monthlyCommissionCents: (byMonthly.get(m.id) ?? 0n).toString(),
        teamSize: teamSize.get(m.id) ?? 0,
        subtreeRevenueCents: (subtreeRev.get(m.id) ?? 0n).toString(),
      };
    });
  }

  /** GDPR/KVKK DSAR (Dalga 3): uyenin tum kisisel verisini tek JSON'da derler (admin). */
  async exportData(tenantId: string, membershipId: string) {
    const m = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      include: { user: { select: { id: true, email: true, fullName: true, locale: true, emailVerifiedAt: true, createdAt: true } }, sponsor: { select: { referralCode: true } } },
    });
    if (!m) throw new NotFoundException('uyelik bu isletmede bulunamadi');

    const [sales, ledger, invites, payouts, profile, surveys] = await Promise.all([
      this.prisma.sale.findMany({ where: { tenantId, sellerMembershipId: membershipId } }),
      this.prisma.ledgerEntry.findMany({ where: { tenantId, beneficiaryMembershipId: membershipId } }),
      this.prisma.invite.findMany({ where: { tenantId, inviterMembershipId: membershipId } }),
      this.prisma.payout.findMany({ where: { tenantId, membershipId } }),
      this.prisma.payoutProfile.findUnique({ where: { membershipId } }),
      this.prisma.surveyResponse.findMany({ where: { membershipId } }),
    ]);

    return deBig({
      exportedAt: new Date().toISOString(),
      profile: {
        membershipId: m.id, referralCode: m.referralCode, role: m.role, status: m.status, depth: m.depth,
        joinedAt: m.joinedAt, sponsorReferralCode: m.sponsor?.referralCode ?? null,
        user: m.user,
      },
      // payout profili: yalniz son-4 saklanir (tam veri zaten yok)
      payoutProfile: profile ? { legalName: profile.legalName, taxIdType: profile.taxIdType, taxIdLast4: profile.taxIdLast4, routingNumber: profile.routingNumber, accountLast4: profile.accountLast4, status: profile.status } : null,
      sales, ledger, invites, payouts, surveys,
    });
  }

  private async requireInTenant(tenantId: string, membershipId: string) {
    const m = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: { id: true, role: true, status: true, isTeamLeader: true },
    });
    if (!m) throw new NotFoundException('uyelik bu isletmede bulunamadi');
    return m;
  }

  private async audit(actor: ActorContext, action: string, entityId: string, after: object) {
    await this.prisma.auditLog.create({
      data: { tenantId: actor.tenantId, actorUserId: actor.userId, action, entity: action.split('.')[0], entityId, after },
    });
  }
}

/** Derin BigInt → string (JSON serialize icin; DSAR export'unda cent alanlari BigInt). */
function deBig(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(deBig);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = deBig(val);
    return o;
  }
  return v;
}
