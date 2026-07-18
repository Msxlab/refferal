import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { SurveyService } from './survey.service';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];
const submitSchema = z.object({ score: z.number().int().min(0).max(10), comment: z.string().trim().max(1000).optional() });

/** Uye NPS: kendi durumu + yanit gonderme. */
@RequireMembership()
@Controller('app/survey')
export class AppSurveyController {
  constructor(private readonly survey: SurveyService) {}

  @Get()
  mine(@CurrentUser() user: RequestUser) {
    return this.survey.mine(user.mid as string);
  }

  @Post()
  @HttpCode(200)
  submit(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(submitSchema)) body: z.infer<typeof submitSchema>) {
    const actor: ActorContext = { userId: user.sub, tenantId: user.tid as string };
    return this.survey.submit(actor, user.mid as string, body.score, body.comment);
  }
}

/** Admin: NPS ozeti. */
@RequireMembership()
@Roles(...STAFF)
@Controller('admin/surveys')
export class AdminSurveyController {
  constructor(private readonly survey: SurveyService) {}

  @Get()
  summary(@CurrentUser() user: RequestUser) {
    return this.survey.summary(user.tid as string);
  }
}
