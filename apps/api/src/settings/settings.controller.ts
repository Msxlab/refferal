import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ActorContext } from '../common/actor';
import { ZodValidationPipe } from '../common/zod.pipe';
import { SettingsService, UpdateSettingsInput } from './settings.service';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];
const ADMIN = [Role.tenant_owner, Role.tenant_admin];

const updateSchema = z.object({
  maturationRule: z.enum(['on_approval', 'on_delivery', 'days_after_approval', 'days_after_delivery']).optional(),
  maturationDays: z.number().int().min(0).max(365).nullable().optional(),
  payoutMinCents: z.number().int().min(0).optional(),
  timezone: z.string().min(3).max(64).optional(),
  notifyNewMemberName: z.boolean().optional(),
  compressionEnabled: z.boolean().optional(),
  inactiveMembersEarn: z.boolean().optional(),
  requireSeparateApprover: z.boolean().optional(),
  requireKycForPayout: z.boolean().optional(),
  requirePayoutApproval: z.boolean().optional(),
  autoRequestPayouts: z.boolean().optional(),
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

const planBonusSchema = z.object({
  fastStartBps: z.number().int().min(0).max(10000),
  fastStartDays: z.number().int().min(0).max(365),
  matchingBps: z.number().int().min(0).max(10000),
});

@RequireMembership()
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Roles(...STAFF)
  @Get()
  get(@CurrentUser() user: RequestUser) {
    return this.settings.get(user.tid as string);
  }

  @Roles(...ADMIN)
  @Patch()
  update(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(updateSchema)) body: UpdateBody) {
    const actor: ActorContext = { userId: user.sub, tenantId: user.tid as string };
    const input: UpdateSettingsInput = {
      ...body,
      payoutMinCents: body.payoutMinCents === undefined ? undefined : BigInt(body.payoutMinCents),
    };
    return this.settings.update(actor, input);
  }

  // MLM plan bonus katmanlari (unilevel+)
  @Roles(...STAFF)
  @Get('plan-bonus')
  getPlanBonus(@CurrentUser() user: RequestUser) {
    return this.settings.getPlanBonus(user.tid as string);
  }

  @Roles(...ADMIN)
  @Post('plan-bonus')
  updatePlanBonus(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(planBonusSchema)) body: z.infer<typeof planBonusSchema>) {
    return this.settings.updatePlanBonus({ userId: user.sub, tenantId: user.tid as string }, body);
  }
}
