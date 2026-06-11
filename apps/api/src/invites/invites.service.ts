import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InviteStatus, MembershipStatus, Prisma, TenantStatus } from '@prisma/client';
import { randomCode } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { authConfig } from '../auth/auth.config';

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Her aktif uye davet olusturabilir (agac davetle buyur — SPEC 1). */
  async create(inviterMembershipId: string, opts: { email?: string } = {}) {
    const inviter = await this.prisma.membership.findUnique({
      where: { id: inviterMembershipId },
      include: { tenant: { select: { status: true } } },
    });
    if (!inviter || inviter.status !== MembershipStatus.active) {
      throw new BadRequestException('aktif uyelik gerekli');
    }
    if (inviter.tenant.status !== TenantStatus.active) {
      throw new BadRequestException('isletme aktif degil');
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.invite.create({
          data: {
            tenantId: inviter.tenantId,
            inviterMembershipId: inviter.id,
            code: randomCode(10),
            email: opts.email?.toLowerCase(),
            expiresAt: new Date(Date.now() + authConfig.inviteTtlMs),
          },
          select: { id: true, code: true, email: true, expiresAt: true, status: true, createdAt: true },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          continue; // kod carpismasi — yeniden uret
        }
        throw e;
      }
    }
    throw new BadRequestException('davet kodu uretilemedi');
  }

  /** Uyenin kendi davetleri + durumlari (satis verisi yok — gizlilik). */
  async listMine(inviterMembershipId: string) {
    const invites = await this.prisma.invite.findMany({
      where: { inviterMembershipId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const now = new Date();
    return invites.map((i) => ({
      id: i.id,
      code: i.code,
      email: i.email,
      status: i.status === InviteStatus.active && i.expiresAt < now ? InviteStatus.expired : i.status,
      expiresAt: i.expiresAt,
      usedByMembershipId: i.usedByMembershipId,
      createdAt: i.createdAt,
    }));
  }

  /** Public cozumleme: /i/{code} kayit sayfasinin ihtiyaci kadar veri. */
  async resolve(code: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { code },
      include: {
        tenant: { select: { name: true, slug: true, status: true } },
        inviter: { include: { user: { select: { fullName: true } } } },
      },
    });
    if (!invite) {
      throw new NotFoundException('davet bulunamadi');
    }
    const valid =
      invite.status === InviteStatus.active &&
      invite.expiresAt > new Date() &&
      invite.tenant.status === TenantStatus.active &&
      invite.inviter.status === MembershipStatus.active;
    return {
      code: invite.code,
      valid,
      tenantName: invite.tenant.name,
      tenantSlug: invite.tenant.slug,
      inviterName: invite.inviter.user.fullName,
      expiresAt: invite.expiresAt,
      emailLocked: invite.email !== null,
    };
  }
}
