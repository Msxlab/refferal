import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, RequirePermission, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ReportsService } from './reports.service';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];
const ADMIN = [Role.tenant_owner, Role.tenant_admin];

const dashboardSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
const analyticsSchema = z.object({ months: z.coerce.number().int().min(3).max(12).default(6) });
const auditSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

@RequireMembership()
@Controller('admin')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Roles(...STAFF)
  @RequirePermission('dashboard.view')
  @Get('dashboard')
  dashboard(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(dashboardSchema)) q: z.infer<typeof dashboardSchema>) {
    return this.reports.dashboard(user.tid as string, q.month);
  }

  @Roles(...STAFF)
  @RequirePermission('reports.view')
  @Get('analytics')
  analytics(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(analyticsSchema)) q: z.infer<typeof analyticsSchema>,
  ) {
    return this.reports.analytics(user.tid as string, q.months);
  }

  // audit yalniz admin+ (para/rol gecmisi)
  @Roles(...ADMIN)
  @RequirePermission('audit.view')
  @Get('audit')
  audit(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(auditSchema)) q: z.infer<typeof auditSchema>) {
    return this.reports.audit(user.tid as string, q);
  }
}
