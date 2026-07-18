import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { MembershipStatus, NotificationChannel, Prisma, TenantStatus } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { RequestUser, switchTenantSchema, SwitchTenantInput } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { notificationPreferenceRows, notificationPrefsJson } from '../notifications/preferences';
import { render } from '../notifications/templates';

// Inbox-visible channels exclude email because email can carry tokens or secrets.
const INBOX_CHANNELS: NotificationChannel[] = [NotificationChannel.in_app, NotificationChannel.push];

/** Maps template to inbox kind for icon, color, and accessible label. */
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

const channelPreferenceSchema = z
  .object({
    in_app: z.boolean().optional(),
    email: z.boolean().optional(),
    push: z.boolean().optional(),
  })
  .strict();
const notificationPreferencesSchema = z.object({
  preferences: z.record(channelPreferenceSchema).default({}),
});
type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

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
    const capabilities =
      typeof user.mid === 'string' &&
      typeof user.tid === 'string' &&
      typeof user.role === 'string' &&
      Array.isArray(user.perms) &&
      user.perms.every((permission) => typeof permission === 'string')
        ? {
            authority: 'active-tenant' as const,
            activeTenant: {
              membershipId: user.mid,
              tenantId: user.tid,
              role: user.role,
              permissions: [...new Set(user.perms)].sort(),
            },
          }
        : { authority: 'unavailable' as const, activeTenant: null };
    return {
      ...u,
      emailVerified: u.emailVerifiedAt !== null,
      activeMembershipId: user.mid,
      tenantId: user.tid,
      role: user.role,
      capabilities,
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
    return this.auth.switchTenant(user, body.membershipId);
  }

  /** Registers Expo push tokens for mobile; upserts by token and refreshes lastSeenAt. */
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

  @Get('notification-preferences')
  async notificationPreferences(@CurrentUser() user: RequestUser) {
    if (!user.mid) return { events: notificationPreferenceRows({}) };
    const membership = await this.prisma.membership.findFirst({
      where: { id: user.mid, userId: user.sub },
      select: { notificationPrefs: true },
    });
    if (!membership) throw new NotFoundException('membership not found');
    return { events: notificationPreferenceRows(membership.notificationPrefs) };
  }

  @HttpCode(200)
  @Post('notification-preferences')
  async updateNotificationPreferences(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(notificationPreferencesSchema)) body: NotificationPreferencesInput,
  ) {
    if (!user.mid) return { events: notificationPreferenceRows({}) };
    const prefs = notificationPrefsJson(body.preferences);
    const updated = await this.prisma.membership.updateMany({
      where: { id: user.mid, userId: user.sub },
      data: { notificationPrefs: prefs },
    });
    if (updated.count === 0) throw new NotFoundException('membership not found');
    return { events: notificationPreferenceRows(prefs) };
  }

  // ----------------------------------------------------- in-app inbox

  /** Active membership notifications, newest first, plus unread count. */
  @Get('notifications')
  async notifications(
    @CurrentUser() user: RequestUser,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    if (!user.mid) return { items: [], unreadCount: 0 };
    const take = Math.min(50, Math.max(1, Number(limit) || 20));
    // Ignore invalid cursors so Prisma never receives Invalid Date.
    const beforeDate = before ? new Date(before) : null;
    const validBefore = beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null;
    const where: Prisma.NotificationWhereInput = {
      recipientMembershipId: user.mid,
      channel: { in: INBOX_CHANNELS },
      ...(validBefore ? { createdAt: { lt: validBefore } } : {}),
    };
    const [rows, unreadCount, tenant] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take }),
      this.prisma.notification.count({
        where: { recipientMembershipId: user.mid, channel: { in: INBOX_CHANNELS }, readAt: null },
      }),
      this.prisma.tenant.findUnique({ where: { id: user.tid as string }, select: { currency: true } }),
    ]);
    const currency = tenant?.currency ?? 'USD';
    const items = rows.map((n) => {
      const { subject, body } = render(n.template, (n.payload ?? {}) as Record<string, unknown>, currency);
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

  /** Marks one notification as read for the active membership only; no cross-membership access. */
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
