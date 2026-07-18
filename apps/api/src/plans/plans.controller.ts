import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, RequireMembership, RequirePermission, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ActorContext } from '../common/actor';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PlansService } from './plans.service';
import { createPlanSchema, CreatePlanInput, simulatePlanSchema, SimulatePlanInput } from './plans.types';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];

@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @RequirePermission('settings.plan')
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.plans.list(this.actor(user));
  }

  @RequirePermission('settings.plan')
  @Post()
  create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createPlanSchema)) body: CreatePlanInput) {
    return this.plans.create(this.actor(user), body);
  }

  @HttpCode(200)
  @RequirePermission('settings.plan')
  @Post('simulate')
  simulate(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(simulatePlanSchema)) body: SimulatePlanInput) {
    return this.plans.simulate(this.actor(user), body);
  }

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }
}
