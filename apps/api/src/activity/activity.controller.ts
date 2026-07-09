import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, RequireMembership } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActivityService } from './activity.service';
import { activityQuerySchema, ActivityQuery } from './activity.types';

/** Uye aktivite akisi (/app/activity). Aktif uyelik gerekli; her zaman KENDI verisi. */
@RequireMembership()
@Controller('app/activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  feed(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(activityQuerySchema)) q: ActivityQuery) {
    return this.activity.feed(user.mid as string, user.tid as string, q);
  }
}
