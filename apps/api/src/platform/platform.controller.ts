import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, PlatformAdmin } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { BillingService } from './billing.service';
import { PlatformService } from './platform.service';
import {
  issueInvoiceSchema, IssueInvoiceInput,
  issuePeriodSchema, IssuePeriodInput,
  markPaidSchema, MarkPaidInput,
  setBillingSchema, SetBillingInput,
  setStatusSchema, SetStatusInput,
} from './platform.types';

// Subdomain yonlendirmesinde ozel anlami olan etiketler — bir tenant slug'i bunlarla
// CAKISAMAZ (ornegin slug='hq' olsa hq.{ROOT_DOMAIN} sahip kapisiyla karisir).
const RESERVED_SLUGS = new Set([
  'hq', 'www', 'api', 'admin', 'app', 'login', 'platform', 'auth',
  'assets', 'static', 'cdn', 'mail', 'ns1', 'ns2',
]);

const createCompanySchema = z.object({
  name: z.string().trim().min(2).max(80),
  // subdomain-guvenli slug (sirket-basi markali subdomain icin kullanilir — bkz. Alt-proje B)
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'gecersiz slug (a-z, 0-9, tire)')
    .refine((s) => !RESERVED_SLUGS.has(s), { message: 'bu slug rezerve edilmis' }),
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

  @Get('companies')
  companies() {
    return this.platform.companies();
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

  // ---- Act-as: sirket icin tenant-scoped owner token (platform admin) ----
  @Post('companies/:id/act-as')
  actAs(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.actAs(user.sub, id);
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
}
