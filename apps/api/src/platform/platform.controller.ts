import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, PlatformAdmin } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PlatformService } from './platform.service';

const reasonSchema = z.object({ reason: z.string().trim().max(180).optional() }).default({});

/** /platform — kiracci-ustu yuzey. @RequireMembership YOK (platform admin uyelik tasimaz). */
@PlatformAdmin()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('companies')
  companies() {
    return this.platform.companies();
  }

  @Get('companies/:id')
  company(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.company(id);
  }

  @Get('companies/:id/network')
  network(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.network(id);
  }

  @HttpCode(200)
  @Post('companies/:id/suspend')
  suspend(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.platform.setStatus(id, TenantStatus.suspended, user.sub, body.reason);
  }

  @HttpCode(200)
  @Post('companies/:id/reactivate')
  reactivate(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.platform.setStatus(id, TenantStatus.active, user.sub, body.reason);
  }
}
