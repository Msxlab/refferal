import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ActorContext } from '../common/actor';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ChecksService } from './checks.service';
import {
  checksPdfSchema,
  ChecksPdfInput,
  generateRunSchema,
  GenerateRunInput,
  markMailedSchema,
  MarkMailedInput,
} from './checks.types';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];

/** Cek-run yonetimi (Faz A2.2). Yalniz admin+ (para artefakti). */
@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/checks')
export class AdminChecksController {
  constructor(private readonly checks: ChecksService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.checks.list(user.tid as string);
  }

  @HttpCode(200)
  @Post('run')
  run(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(generateRunSchema)) body: GenerateRunInput) {
    return this.checks.generateRun(this.actor(user), body);
  }

  @HttpCode(200)
  @Post('mark-mailed')
  markMailed(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(markMailedSchema)) body: MarkMailedInput) {
    return this.checks.markMailed(this.actor(user), body);
  }

  /** Yazdirilabilir cek PDF'i (cek + register). Binary doner. */
  @Post('pdf')
  async pdf(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(checksPdfSchema)) body: ChecksPdfInput,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, fileName } = await this.checks.buildPdf(user.tid as string, body.payoutIds);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}
