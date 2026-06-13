import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ActorContext } from '../common/actor';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PeriodsService } from './periods.service';
import { lockPeriodSchema, LockPeriodInput } from './periods.types';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];

/** Donem kilidi / muhasebe kapanisi (Dalga 3). Yalniz admin+. */
@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/periods')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.periods.list(user.tid as string);
  }

  @HttpCode(200)
  @Post(':period/lock')
  lock(
    @CurrentUser() user: RequestUser,
    @Param('period') period: string,
    @Body(new ZodValidationPipe(lockPeriodSchema)) body: LockPeriodInput,
  ) {
    return this.periods.lock(this.actor(user), period, body.note);
  }

  @HttpCode(200)
  @Post(':period/unlock')
  unlock(@CurrentUser() user: RequestUser, @Param('period') period: string) {
    return this.periods.unlock(this.actor(user), period);
  }
}
