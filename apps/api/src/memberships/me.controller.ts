import { Body, Controller, Get, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { MembershipStatus, TenantStatus } from '@prisma/client';
import { CurrentUser } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { RequestUser, switchTenantSchema, SwitchTenantInput } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async me(@CurrentUser() user: RequestUser) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarPath: true,
        locale: true,
        emailVerifiedAt: true,
        lastMembershipId: true,
      },
    });
    if (!u) throw new NotFoundException();
    return {
      ...u,
      emailVerified: u.emailVerifiedAt !== null,
      activeMembershipId: user.mid,
      tenantId: user.tid,
      role: user.role,
    };
  }

  @Get('memberships')
  async myMemberships(@CurrentUser() user: RequestUser) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.sub, status: MembershipStatus.active, tenant: { status: TenantStatus.active } },
      include: { tenant: { select: { id: true, slug: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.id,
      tenantId: m.tenant.id,
      tenantSlug: m.tenant.slug,
      tenantName: m.tenant.name,
      role: m.role,
      referralCode: m.referralCode,
      depth: m.depth,
      joinedAt: m.joinedAt,
    }));
  }

  @HttpCode(200)
  @Post('switch-tenant')
  switchTenant(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(switchTenantSchema)) body: SwitchTenantInput,
  ) {
    return this.auth.switchTenant(user.sub, body.membershipId);
  }
}
