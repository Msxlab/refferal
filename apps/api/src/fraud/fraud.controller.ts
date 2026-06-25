import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { FraudStatus, Role } from '@prisma/client';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { FraudService } from './fraud.service';
import { decideFraudSchema, DecideFraudInput, listFraudSchema, ListFraudInput } from './fraud.types';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];

/** Fraud inceleme — yalniz admin+ (audit'li). */
@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/fraud')
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Get()
  list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listFraudSchema)) q: ListFraudInput) {
    return this.fraud.list(user.tid as string, q.status as FraudStatus | undefined);
  }

  @HttpCode(200)
  @Post('scan')
  scan(@CurrentUser() user: RequestUser) {
    return this.fraud.scan(user.tid as string);
  }

  @HttpCode(200)
  @Post(':membershipId/decide')
  decide(
    @CurrentUser() user: RequestUser,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(decideFraudSchema)) body: DecideFraudInput,
  ) {
    return this.fraud.decide(this.actor(user), membershipId, body.action, body.note);
  }
}
