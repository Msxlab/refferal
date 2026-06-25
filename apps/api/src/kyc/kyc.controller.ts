import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { PayoutProfileStatus, Role } from '@prisma/client';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { KycService } from './kyc.service';
import { decideProfileSchema, DecideProfileInput, listProfilesSchema, ListProfilesInput, upsertProfileSchema, UpsertProfileInput } from './kyc.types';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];

/** Uye odeme profili (KYC) — kendi profilini gorur/gunceller. */
@RequireMembership()
@Controller('app/payout-profile')
export class AppKycController {
  constructor(private readonly kyc: KycService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Get()
  mine(@CurrentUser() user: RequestUser) {
    return this.kyc.mine(user.mid as string);
  }

  @Put()
  @HttpCode(200)
  upsert(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(upsertProfileSchema)) body: UpsertProfileInput) {
    return this.kyc.upsert(this.actor(user), user.mid as string, body);
  }
}

/** Admin KYC inceleme — yalniz admin+ (audit'li). */
@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/payout-profiles')
export class AdminKycController {
  constructor(private readonly kyc: KycService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Get()
  list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listProfilesSchema)) q: ListProfilesInput) {
    return this.kyc.list(user.tid as string, q.status as PayoutProfileStatus | undefined);
  }

  @HttpCode(200)
  @Post(':membershipId/decide')
  decide(
    @CurrentUser() user: RequestUser,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(decideProfileSchema)) body: DecideProfileInput,
  ) {
    return this.kyc.decide(this.actor(user), membershipId, body.action, body.reason);
  }
}
