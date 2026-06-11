import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Prisma, Role, TenantStatus } from '@prisma/client';
import { randomCode } from '../common/crypto';
import { authConfig } from '../auth/auth.config';
import { PrismaService } from '../prisma/prisma.service';
import { ActorContext } from '../sales/sales.service';

// Admin'in atayabilecegi roller (owner devri ve platform_admin bu uctan YAPILMAZ)
const ASSIGNABLE_ROLES: Role[] = [Role.tenant_admin, Role.tenant_staff, Role.member];

@Injectable()
export class MembersAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, q: { search?: string; status?: MembershipStatus; page: number; pageSize: number }) {
    const where: Prisma.MembershipWhereInput = {
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
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.membership.count({ where }),
      this.prisma.membership.findMany({
        where,
        orderBy: { joinedAt: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          user: { select: { fullName: true, email: true, emailVerifiedAt: true } },
          sponsor: { select: { referralCode: true } },
        },
      }),
    ]);
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
        joinedAt: m.joinedAt,
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

  async setStatus(actor: ActorContext, membershipId: string, status: MembershipStatus) {
    const m = await this.requireInTenant(actor.tenantId, membershipId);
    if (m.status === status) return { id: m.id, status };
    const updated = await this.prisma.membership.update({ where: { id: m.id }, data: { status } });
    await this.audit(actor, status === MembershipStatus.inactive ? 'membership.deactivate' : 'membership.activate', m.id, {
      from: m.status,
      to: status,
    });
    return { id: updated.id, status: updated.status };
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
    await this.audit(actor, 'membership.set_role', m.id, { from: m.role, to: role });
    return { id: updated.id, role: updated.role };
  }

  /** Agac gorunumu (SPEC 9): tenant'taki tum uyeler + parent/depth (gorsellestirme icin). */
  async tree(tenantId: string) {
    const nodes = await this.prisma.membership.findMany({
      where: { tenantId },
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

  private async requireInTenant(tenantId: string, membershipId: string) {
    const m = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: { id: true, role: true, status: true },
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
