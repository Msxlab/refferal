import { Body, Controller, Get, Header, HttpCode, Post, Put, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ReportsService } from './reports.service';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];
const ADMIN = [Role.tenant_owner, Role.tenant_admin];

const dashboardSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
const analyticsSchema = z.object({ months: z.coerce.number().int().min(3).max(12).default(6) });
// audit ortak filtre + sayfalama
const auditFilterSchema = z.object({
  q: z.string().trim().max(120).optional(),
  entity: z.string().trim().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const auditSchema = auditFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
const yearSchema = z.object({ year: z.coerce.number().int().min(2020).max(2100) });
const reportSubSchema = z.object({
  frequency: z.enum(['weekly', 'monthly']),
  recipients: z.array(z.string().trim().toLowerCase().email().max(254)).max(20),
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

  @Roles(...STAFF)
  @Get('analytics')
  analytics(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(analyticsSchema)) q: z.infer<typeof analyticsSchema>,
  ) {
    return this.reports.analytics(user.tid as string, q.months);
  }

  // audit yalniz admin+ (para/rol gecmisi)
  @Roles(...ADMIN)
  @Get('audit')
  audit(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(auditSchema)) q: z.infer<typeof auditSchema>) {
    return this.reports.audit(user.tid as string, q);
  }

  // zamanlanmis rapor abonelikleri (#18)
  @Roles(...ADMIN)
  @Get('report-subscription')
  getReportSub(@CurrentUser() user: RequestUser) {
    return this.reports.getSubscription(user.tid as string);
  }

  @Roles(...ADMIN)
  @Put('report-subscription')
  setReportSub(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(reportSubSchema)) body: z.infer<typeof reportSubSchema>) {
    return this.reports.setSubscription(user.tid as string, body.frequency, body.recipients);
  }

  @Roles(...ADMIN)
  @HttpCode(200)
  @Post('report-subscription/test')
  async sendTestReport(@CurrentUser() user: RequestUser) {
    const sub = await this.reports.getSubscription(user.tid as string);
    return this.reports.sendDigest(user.tid as string, sub.recipients);
  }

  // clawback / negatif bakiye raporu (admin)
  @Roles(...ADMIN)
  @Get('clawbacks')
  clawbacks(@CurrentUser() user: RequestUser) {
    return this.reports.clawbacks(user.tid as string);
  }

  // 1099-NEC vergi raporu (admin)
  @Roles(...ADMIN)
  @Get('tax/1099')
  tax1099(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(yearSchema)) q: z.infer<typeof yearSchema>) {
    return this.reports.tax1099(user.tid as string, q.year);
  }

  @Roles(...ADMIN)
  @Get('tax/1099.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="1099-nec.csv"')
  async tax1099Csv(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(yearSchema)) q: z.infer<typeof yearSchema>, @Res() res: Response) {
    res.send(await this.reports.tax1099Csv(user.tid as string, q.year));
  }

  // finansal invariant denetimi (admin)
  @Roles(...ADMIN)
  @Get('financials/verify')
  verifyFinancials(@CurrentUser() user: RequestUser) {
    return this.reports.verifyFinancials(user.tid as string);
  }

  // audit zincir butunlugu: seal + verify (admin)
  @Roles(...ADMIN)
  @HttpCode(200)
  @Post('audit/verify')
  verifyAudit(@CurrentUser() user: RequestUser) {
    return this.reports.sealAndVerify(user.tid as string);
  }

  @Roles(...ADMIN)
  @Get('audit/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit.csv"')
  async auditExport(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(auditFilterSchema)) q: z.infer<typeof auditFilterSchema>,
    @Res() res: Response,
  ) {
    const csv = await this.reports.auditExportCsv(user.tid as string, q);
    res.send(csv);
  }
}
