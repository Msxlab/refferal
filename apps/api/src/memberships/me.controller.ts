import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { MembershipStatus, NotificationChannel, Prisma, TenantStatus } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { RequestUser, switchTenantSchema, SwitchTenantInput } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { render } from '../notifications/templates';

// Gelen kutusunda gosterilen kanallar: e-posta haric (token/sir tasiyabilir).
const INBOX_CHANNELS: NotificationChannel[] = [NotificationChannel.in_app, NotificationChannel.push];

/** Sablon → gelen kutusu turu (ikon/renk + erisilebilir etiket). */
function kindOf(template: string): 'positive' | 'negative' | 'team' | 'system' {
  if (template === 'commission_earned' || template === 'payout_sent') return 'positive';
  if (template === 'commission_reversed') return 'negative';
  if (template === 'team_member_joined') return 'team';
  return 'system';
}

const deviceSchema = z.object({
  expoPushToken: z.string().trim().min(8).max(256),
  platform: z.enum(['ios', 'android', 'web']),
});
type DeviceInput = z.infer<typeof deviceSchema>;

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
    return this.auth.switchTenant(user.sub, body.membershipId, user.sid);
  }

  /** Expo push token kaydi (mobil); token'a gore upsert, last_seen guncellenir. */
  @HttpCode(200)
  @Post('devices')
  async registerDevice(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(deviceSchema)) body: DeviceInput,
  ) {
    const device = await this.prisma.device.upsert({
      where: { expoPushToken: body.expoPushToken },
      create: { userId: user.sub, expoPushToken: body.expoPushToken, platform: body.platform },
      update: { userId: user.sub, platform: body.platform, lastSeenAt: new Date() },
      select: { id: true, platform: true, lastSeenAt: true },
    });
    return device;
  }

  // ----------------------------------------------------- gelen kutusu (in-app inbox)

  /** Aktif uyeligin bildirimleri (en yeni once) + okunmamis sayisi. */
  @Get('notifications')
  async notifications(
    @CurrentUser() user: RequestUser,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    if (!user.mid) return { items: [], unreadCount: 0 };
    const take = Math.min(50, Math.max(1, Number(limit) || 20));
    // gecersiz cursor Prisma'ya Invalid Date dusurmesin — sessizce yok say
    const beforeDate = before ? new Date(before) : null;
    const validBefore = beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null;
    const where: Prisma.NotificationWhereInput = {
      recipientMembershipId: user.mid,
      channel: { in: INBOX_CHANNELS },
      ...(validBefore ? { createdAt: { lt: validBefore } } : {}),
    };
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take }),
      this.prisma.notification.count({
        where: { recipientMembershipId: user.mid, channel: { in: INBOX_CHANNELS }, readAt: null },
      }),
    ]);
    const items = rows.map((n) => {
      const { subject, body } = render(n.template, (n.payload ?? {}) as Record<string, unknown>);
      return {
        id: n.id,
        template: n.template,
        kind: kindOf(n.template),
        title: subject,
        body,
        read: n.readAt !== null,
        createdAt: n.createdAt,
      };
    });
    return { items, unreadCount, nextBefore: rows.length === take ? rows[rows.length - 1].createdAt : null };
  }

  @Get('notifications/unread-count')
  async unreadCount(@CurrentUser() user: RequestUser) {
    if (!user.mid) return { count: 0 };
    const count = await this.prisma.notification.count({
      where: { recipientMembershipId: user.mid, channel: { in: INBOX_CHANNELS }, readAt: null },
    });
    return { count };
  }

  /** Tek bildirimi okundu isaretle (yalniz aktif uyeligin satiri — capraz erisim yok). */
  @HttpCode(200)
  @Post('notifications/:id/read')
  async markRead(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    if (!user.mid) return { ok: true };
    await this.prisma.notification.updateMany({
      where: { id, recipientMembershipId: user.mid, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @HttpCode(200)
  @Post('notifications/read-all')
  async markAllRead(@CurrentUser() user: RequestUser) {
    if (!user.mid) return { ok: true, updated: 0 };
    const res = await this.prisma.notification.updateMany({
      where: { recipientMembershipId: user.mid, channel: { in: INBOX_CHANNELS }, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true, updated: res.count };
  }
}
