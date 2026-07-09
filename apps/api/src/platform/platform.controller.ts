import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, PlatformAdmin } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { BillingService } from './billing.service';
import { PlatformService } from './platform.service';
import {
  auditQuerySchema, AuditQuery,
  brandingSchema, BrandingInput,
  companiesQuerySchema, CompaniesQuery,
  issueInvoiceSchema, IssueInvoiceInput,
  issuePeriodSchema, IssuePeriodInput,
  markPaidSchema, MarkPaidInput,
  pageQuerySchema, PageQuery,
  searchQuerySchema, SearchQuery,
  setBillingSchema, SetBillingInput,
  setStatusSchema, SetStatusInput,
} from './platform.types';

const createCompanySchema = z.object({
  name: z.string().trim().min(2).max(80),
  // subdomain-guvenli slug (ileride sirket-basi subdomain icin de uygun)
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'gecersiz slug (a-z, 0-9, tire)'),
  currency: z.string().trim().toUpperCase().length(3).default('USD'),
  timezone: z.string().trim().min(1).max(64).default('America/New_York'),
  ownerEmail: z.string().trim().email(),
  ownerName: z.string().trim().min(1).max(120),
});

/** /platform — kiracci-ustu yuzey. @RequireMembership YOK (platform admin uyelik tasimaz). */
@PlatformAdmin()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly billing: BillingService,
  ) {}

  @Get('overview')
  overview() {
    return this.platform.overview();
  }

  // ---- Item 7: sistem sagligi paneli (DB + scheduler job'lari + backup tazeligi) ----
  @Get('health')
  health() {
    return this.platform.health();
  }

  @Get('companies')
  companies(@Query(new ZodValidationPipe(companiesQuerySchema)) q: CompaniesQuery) {
    return this.platform.companies(q);
  }

  // ---- Item 5: yaptirimli capraz-kiraci arama (kullanici/uye/satis/odeme) ----
  @Get('search')
  search(@Query(new ZodValidationPipe(searchQuerySchema)) q: SearchQuery) {
    return this.platform.search(q.q);
  }

  // ---- Company onboarding: yeni sirket (tenant + plan + owner) ----
  @HttpCode(201)
  @Post('companies')
  createCompany(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createCompanySchema)) body: z.infer<typeof createCompanySchema>,
  ) {
    return this.platform.createCompany(user.sub, body);
  }

  @Get('companies/:id')
  company(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.company(id);
  }

  @Get('companies/:id/network')
  network(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.network(id);
  }

  // ---- Item 3: sirket sekmeleri (uyeler + odemeler), sayfali ----
  @Get('companies/:id/members')
  members(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(pageQuerySchema)) q: PageQuery) {
    return this.platform.members(id, q);
  }

  @Get('companies/:id/payouts')
  payouts(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(pageQuerySchema)) q: PageQuery) {
    return this.platform.payouts(id, q);
  }

  // ---- Item 6: audit viewer (tek tenant + global feed) ----
  @Get('companies/:id/audit')
  companyAudit(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(auditQuerySchema)) q: AuditQuery) {
    return this.platform.companyAudit(id, q);
  }

  @Get('audit')
  globalAudit(@Query(new ZodValidationPipe(auditQuerySchema)) q: AuditQuery) {
    return this.platform.globalAudit(q);
  }

  // ---- C1: sirket durumu (askiya al / aktive et) ----
  @Patch('companies/:id/status')
  setStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setStatusSchema)) body: SetStatusInput,
  ) {
    return this.platform.setStatus(user.sub, id, body.status);
  }

  // ---- Item 2: sirket branding (logo + hex renkler) ----
  @Put('companies/:id/branding')
  setBranding(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(brandingSchema)) body: BrandingInput,
  ) {
    return this.platform.setBranding(user.sub, id, body);
  }

  // ---- C2: billing (manuel — Stripe yok) ----
  @Get('billing')
  billingOverview() {
    return this.billing.overview();
  }

  @Get('companies/:id/billing')
  companyBilling(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.forTenant(id);
  }

  @Put('companies/:id/billing')
  setBilling(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setBillingSchema)) body: SetBillingInput,
  ) {
    return this.billing.setConfig(id, { monthlyFeeCents: BigInt(body.monthlyFeeCents), active: body.active, notes: body.notes });
  }

  @HttpCode(200)
  @Post('companies/:id/invoices')
  issueInvoice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(issueInvoiceSchema)) body: IssueInvoiceInput,
  ) {
    return this.billing.issueOne(user.sub, id, body.period, body.dueInDays);
  }

  @HttpCode(200)
  @Post('invoices/run')
  issuePeriod(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(issuePeriodSchema)) body: IssuePeriodInput) {
    return this.billing.issuePeriod(user.sub, body.period, body.dueInDays);
  }

  @HttpCode(200)
  @Post('invoices/:id/paid')
  markPaid(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(markPaidSchema)) body: MarkPaidInput,
  ) {
    return this.billing.markPaid(user.sub, id, body.note);
  }

  @HttpCode(200)
  @Post('invoices/:id/void')
  voidInvoice(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.voidInvoice(user.sub, id);
  }

  // ---- Item 4: guvenli platform impersonation (salt-okunur owner-view) ----
  @HttpCode(200)
  @Post('companies/:id/impersonate')
  impersonate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.impersonate(user.sub, id);
  }

  @HttpCode(200)
  @Post('companies/:id/impersonate/end')
  impersonateEnd(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.impersonateEnd(user.sub, id);
  }
}
