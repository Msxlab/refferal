import { Body, Controller, ForbiddenException, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, RequirePermission, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ActorContext } from '../common/actor';
import { ZodValidationPipe } from '../common/zod.pipe';
import { SettingsService, UpdateSettingsInput } from './settings.service';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];
const ADMIN = [Role.tenant_owner, Role.tenant_admin];

const updateSchema = z.object({
  maturationRule: z.enum(['on_approval', 'on_delivery', 'days_after_approval']).optional(),
  maturationDays: z.number().int().min(0).max(365).nullable().optional(),
  payoutMinCents: z.number().int().min(0).optional(),
  timezone: z.string().min(3).max(64).optional(),
  notifyNewMemberName: z.boolean().optional(),
  compressionEnabled: z.boolean().optional(),
  inactiveMembersEarn: z.boolean().optional(),
  requireSeparateApprover: z.boolean().optional(),
  branding: z
    .object({
      logoText: z.string().trim().max(40).optional(),
      tagline: z.string().trim().max(120).optional(),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })
    .optional(),
});
type UpdateBody = z.infer<typeof updateSchema>;

@RequireMembership()
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  private assertSettingsPermissions(user: RequestUser, body: UpdateBody): void {
    if (user.role === Role.tenant_owner || user.role === Role.platform_admin) return;

    const needed = new Set<string>();
    if (
      body.maturationRule !== undefined ||
      body.maturationDays !== undefined ||
      body.timezone !== undefined ||
      body.compressionEnabled !== undefined ||
      body.inactiveMembersEarn !== undefined
    ) {
      needed.add('settings.general');
    }
    if (body.payoutMinCents !== undefined) needed.add('settings.payments');
    if (body.notifyNewMemberName !== undefined) needed.add('settings.notifications');
    if (body.requireSeparateApprover !== undefined) needed.add('settings.security');
    if (body.branding !== undefined) needed.add('settings.branding');

    const held = new Set(user.perms ?? []);
    const missing = [...needed].filter((p) => !held.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`bu islem icin yetkiniz yok: ${missing.join(', ')}`);
    }
  }

  @Roles(...STAFF)
  @RequirePermission('settings.view')
  @Get()
  get(@CurrentUser() user: RequestUser) {
    return this.settings.get(user.tid as string);
  }

  @Roles(...ADMIN)
  @RequirePermission('settings.data')
  @Get('data-status')
  dataStatus(@CurrentUser() user: RequestUser) {
    return this.settings.dataStatus(user.tid as string);
  }

  @Roles(...ADMIN)
  @RequirePermission('settings.view')
  @Patch()
  update(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(updateSchema)) body: UpdateBody) {
    this.assertSettingsPermissions(user, body);
    const actor: ActorContext = { userId: user.sub, tenantId: user.tid as string };
    const input: UpdateSettingsInput = {
      ...body,
      payoutMinCents: body.payoutMinCents === undefined ? undefined : BigInt(body.payoutMinCents),
    };
    return this.settings.update(actor, input);
  }
}
