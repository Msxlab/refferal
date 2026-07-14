import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Prisma, Role } from '@prisma/client';
import { authConfig } from '../auth/auth.config';
import { auditFingerprint } from '../common/audit-redaction';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { ActorContext } from '../common/actor';
import { InvitesService } from '../invites/invites.service';

@Injectable()
export class MembersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly invites: InvitesService,
  ) {}

  async list(tenantId: string, q: { search?: string; status?: MembershipStatus; page: number; pageSize: number }) {
    this.tenantContext.assertTenant(tenantId);
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

  /** Creates an admin invite. The sponsor code/id must belong to the tenant; default sponsor is the admin. */
  async invite(
    actor: ActorContext,
    actorMembershipId: string,
    input: { sponsorReferralCode?: string; sponsorMembershipId?: string; email?: string },
    idempotencyKey?: string,
  ) {
    this.tenantContext.assertActor(actor);
    this.tenantContext.assertMembership(actorMembershipId);
    let sponsorId = actorMembershipId;
    if (input.sponsorMembershipId || input.sponsorReferralCode) {
      const sponsor = await this.prisma.membership.findFirst({
        where: {
          tenantId: actor.tenantId,
          ...(input.sponsorMembershipId ? { id: input.sponsorMembershipId } : { referralCode: input.sponsorReferralCode }),
        },
        select: { id: true, status: true },
      });
      if (!sponsor) throw new NotFoundException('sponsor membership was not found in this business');
      if (sponsor.status !== MembershipStatus.active) throw new BadRequestException('sponsor is not active');
      sponsorId = sponsor.id;
    }

    const invite = await this.invites.createForAdmin(actor, sponsorId, { email: input.email }, idempotencyKey);
    const emailFingerprint = auditFingerprint(invite.email ?? undefined, 'email', authConfig.accessSecret());
    await this.audit(actor, 'invite.create', invite.id, {
      sponsorId,
      ...(emailFingerprint ? { emailFingerprint } : {}),
    });
    return { ...invite, inviterMembershipId: sponsorId };
  }

  async setStatus(actor: ActorContext, membershipId: string, status: MembershipStatus) {
    this.tenantContext.assertActor(actor);
    const m = await this.requireInTenant(actor.tenantId, membershipId);
    // The owner cannot be deactivated; this prevents an active tenant from losing its owner.
    if (m.role === Role.tenant_owner && status === MembershipStatus.inactive) {
      throw new BadRequestException('owner membership cannot be deactivated');
    }
    if (m.status === status) return { id: m.id, status };
    const updated = await this.prisma.membership.update({ where: { id: m.id }, data: { status } });
    await this.audit(actor, status === MembershipStatus.inactive ? 'membership.deactivate' : 'membership.activate', m.id, {
      from: m.status,
      to: status,
    });
    return { id: updated.id, status: updated.status };
  }

  /** Tree view (SPEC 9): every tenant member with parent/depth data for visualization. */
  async tree(tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
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
    if (!m) throw new NotFoundException('membership was not found in this business');
    return m;
  }

  private async audit(actor: ActorContext, action: string, entityId: string, after: object) {
    await this.prisma.auditLog.create({
      data: { tenantId: actor.tenantId, actorUserId: actor.userId, action, entity: action.split('.')[0], entityId, after },
    });
  }
}
