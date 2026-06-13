import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ActorContext } from '../common/actor';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PlansService } from './plans.service';
import { createPlanSchema, CreatePlanInput, simulatePlanSchema, SimulatePlanInput } from './plans.types';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];
const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];

/** Komisyon plani: goruntule + simule (STAFF) + yeni versiyon (ADMIN). */
@RequireMembership()
@Controller('admin/plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Roles(...STAFF)
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.plans.list(user.tid as string);
  }

  @Roles(...STAFF)
  @HttpCode(200)
  @Post('simulate')
  simulate(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(simulatePlanSchema)) body: SimulatePlanInput) {
    return this.plans.simulate(user.tid as string, body);
  }

  @Roles(...ADMIN)
  @HttpCode(200)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createPlanSchema)) body: CreatePlanInput) {
    return this.plans.createVersion(this.actor(user), body);
  }
}
