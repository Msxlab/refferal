import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ReportsService } from './reports.service';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];
const ADMIN = [Role.tenant_owner, Role.tenant_admin];

const dashboardSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
const auditSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

@RequireMembership()
@Controller('admin')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Roles(...STAFF)
  @Get('dashboard')
  dashboard(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(dashboardSchema)) q: z.infer<typeof dashboardSchema>) {
    return this.reports.dashboard(user.tid as string, q.month);
  }

  // audit yalniz admin+ (para/rol gecmisi)
  @Roles(...ADMIN)
  @Get('audit')
  audit(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(auditSchema)) q: z.infer<typeof auditSchema>) {
    return this.reports.audit(user.tid as string, q);
  }
}
