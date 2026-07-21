import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { PayoutStatus, Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser, RequireMembership, RequirePermission, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { withPayoutActionCandidates } from './payout-presentation';
import { PayoutsService } from './payouts.service';
import { PayoutComplianceService } from './payout-compliance.service';
import {
  decidePayoutSchema,
  DecidePayoutInput,
  dispatchPayoutBatchSchema,
  DispatchPayoutBatchInput,
  exportPayoutsSchema,
  ExportPayoutsInput,
  failPayoutBatchSchema,
  FailPayoutBatchInput,
  approvePayoutRequestSchema,
  ApprovePayoutRequestInput,
  reconcilePayoutsSchema,
  ReconcilePayoutsInput,
  listPayoutsSchema,
  ListPayoutsInput,
  previewPayoutBatchSchema,
  PreviewPayoutBatchInput,
  rejectPayoutRequestSchema,
  RejectPayoutRequestInput,
  runPayoutSchema,
  RunPayoutInput,
  settlePayoutBatchSchema,
  SettlePayoutBatchInput,
  startPayoutBatchSchema,
  StartPayoutBatchInput,
  payoutComplianceDecisionSchema,
  PayoutComplianceDecisionInput,
  payoutComplianceKeySchema,
  PayoutComplianceKeyInput,
  payoutDestinationSchema,
  PayoutDestinationInput,
} from './payouts.types';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];

/** Admin payout management (SPEC 9): payable list -> run -> CSV. Admin roles only; staff cannot access it. */
@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly compliance: PayoutComplianceService,
  ) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Get('payable')
  @RequirePermission('payouts.view')
  payable(@CurrentUser() user: RequestUser) {
    return this.payouts.payable(user.tid as string);
  }

  private complianceActor(user: RequestUser) {
    return {
      userId: user.sub,
      tenantId: user.tid as string,
      membershipId: user.mid as string,
    };
  }

  @Get('members/:membershipId/readiness')
  @RequirePermission('compliance.view')
  readiness(
    @CurrentUser() user: RequestUser,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.compliance.getReadiness(this.complianceActor(user), membershipId);
  }

  @Put('members/:membershipId/readiness/:key')
  @RequirePermission('compliance.review')
  decideReadiness(
    @CurrentUser() user: RequestUser,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Param('key', new ZodValidationPipe(payoutComplianceKeySchema)) key: PayoutComplianceKeyInput,
    @Body(new ZodValidationPipe(payoutComplianceDecisionSchema)) body: PayoutComplianceDecisionInput,
  ) {
    return this.compliance.decide(this.complianceActor(user), membershipId, key, body);
  }

  @Put('members/:membershipId/destination')
  @RequirePermission('compliance.review')
  replaceDestination(
    @CurrentUser() user: RequestUser,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(payoutDestinationSchema)) body: PayoutDestinationInput,
  ) {
    return this.compliance.replaceDestination(this.complianceActor(user), membershipId, body);
  }

  @HttpCode(200)
  @Post('batches/preview')
  @RequirePermission('payouts.process')
  previewBatch(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(previewPayoutBatchSchema)) body: PreviewPayoutBatchInput,
  ) {
    return this.payouts.previewBatch(this.actor(user), body);
  }

  @HttpCode(200)
  @Post('batches')
  @RequirePermission('payouts.process')
  startBatch(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(startPayoutBatchSchema)) body: StartPayoutBatchInput,
  ) {
    return this.payouts.startBatch(this.actor(user), body);
  }

  @HttpCode(200)
  @Post('run')
  @RequirePermission('payouts.process')
  run(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(runPayoutSchema)) body: RunPayoutInput) {
    return this.payouts.run(this.actor(user), body);
  }

  @Get()
  @RequirePermission('payouts.view')
  async list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listPayoutsSchema)) q: ListPayoutsInput) {
    const payouts = await this.payouts.list(user.tid as string, { ...q, status: q.status as PayoutStatus | undefined });
    return {
      ...payouts,
      items: payouts.items.map((payout) => ({
        ...payout,
        presentation: withPayoutActionCandidates(payout.presentation, user, false, payout.batchStatus),
      })),
    };
  }

  @HttpCode(200)
  @Post('batches/:id/settle')
  @RequirePermission('payouts.process')
  settleBatch(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(settlePayoutBatchSchema)) body: SettlePayoutBatchInput,
  ) {
    return this.payouts.settleBatch(this.actor(user), id, body);
  }

  @HttpCode(200)
  @Post('batches/:id/dispatch')
  @RequirePermission('payouts.process')
  dispatchBatch(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(dispatchPayoutBatchSchema)) body: DispatchPayoutBatchInput,
  ) {
    return this.payouts.dispatchBatch(this.actor(user), id, body);
  }

  @HttpCode(200)
  @Post('batches/:id/fail')
  @RequirePermission('payouts.process')
  failBatch(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(failPayoutBatchSchema)) body: FailPayoutBatchInput,
  ) {
    return this.payouts.failBatch(this.actor(user), id, body.reason);
  }

  @HttpCode(200)
  @Post(':id/approve')
  @RequirePermission('payouts.process')
  approveRequest(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(approvePayoutRequestSchema)) body: ApprovePayoutRequestInput,
  ) {
    return this.payouts.approveRequest(this.actor(user), id, body.method);
  }

  @HttpCode(200)
  @Post(':id/reject')
  @RequirePermission('payouts.process')
  rejectRequest(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rejectPayoutRequestSchema)) body: RejectPayoutRequestInput,
  ) {
    return this.payouts.rejectRequest(this.actor(user), id, body.reason);
  }

  @Get('export.csv')
  @RequirePermission('payouts.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="payouts.csv"')
  async export(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(exportPayoutsSchema)) q: ExportPayoutsInput,
    @Res() res: Response,
  ) {
    const csv = await this.payouts.exportPaidCsv(user.tid as string, q.period);
    res.send(csv);
  }

  @Get('batches/:id/export.csv')
  @RequirePermission('payouts.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="payout-batch.csv"')
  async exportBatch(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const csv = await this.payouts.exportBatchCsv(user.tid as string, id);
    res.send(csv);
  }

  // self-hosted ACH/NACHA banka dosyasi (statik route ':id'den ONCE)
  @Get('ach.txt')
  @RequirePermission('payouts.export')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="payouts-ach.txt"')
  async ach(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(exportPayoutsSchema)) q: ExportPayoutsInput,
    @Res() res: Response,
  ) {
    // Banka bilgisi olmadigi icin dosyaya GIRMEYEN 'paid' payout'lar header ile yuzeye cikar
    // (govde/NACHA byte'lari degismez — indirme sozlesmesi korunur).
    const { file, skipped } = await this.payouts.achFile(user.tid as string, q.period);
    res.setHeader('X-Refearn-Skipped', String(skipped.length));
    if (skipped.length) {
      res.setHeader('X-Refearn-Skipped-Ids', skipped.map((s) => s.membershipId).join(','));
    }
    res.send(file);
  }

  // banka mutabakati: ekstre satirlarini odenmis payout'larla esle, 'cleared' isaretle
  @HttpCode(200)
  @Post('reconcile')
  @RequirePermission('payouts.process')
  reconcile(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(reconcilePayoutsSchema)) body: ReconcilePayoutsInput,
  ) {
    return this.payouts.reconcile(this.actor(user), body.rows);
  }

  // maker-checker: bekleyen oneriler + onay/red (statik route'lar ':id'den ONCE)
  @Get('batches')
  @RequirePermission('payouts.view')
  batches(@CurrentUser() user: RequestUser) {
    return this.payouts.listBatches(user.tid as string);
  }

  @HttpCode(200)
  @Post('batches/:id/approve')
  @RequirePermission('payouts.process')
  approveBatch(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.approveBatch(this.actor(user), id);
  }

  @HttpCode(200)
  @Post('batches/:id/reject')
  @RequirePermission('payouts.process')
  rejectBatch(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.rejectBatch(this.actor(user), id);
  }

  // DIKKAT: ':id' GET'i statik GET'lerden (payable, export.csv, batches) SONRA tanimli.
  @Get(':id')
  @RequirePermission('payouts.view')
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.detail(user.tid as string, id);
  }

  // talep karari (onay/red) — para etkileyen, audit'li
  @HttpCode(200)
  @Post(':id/decide')
  @RequirePermission('payouts.process')
  decide(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decidePayoutSchema)) body: DecidePayoutInput,
  ) {
    return this.payouts.decide(this.actor(user), id, body);
  }

  // basarisiz odemeyi yeniden dene
  @HttpCode(200)
  @Post(':id/retry')
  @RequirePermission('payouts.process')
  retry(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.retry(this.actor(user), id);
  }
}

/** Member payout requests and history (SPEC 8). */
@RequireMembership()
@Controller('app/payout-requests')
export class AppPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @HttpCode(200)
  @Post()
  request(@CurrentUser() user: RequestUser) {
    return this.payouts.requestPayout(user.mid as string, user.tid as string);
  }

  @Get()
  async mine(@CurrentUser() user: RequestUser) {
    const payouts = await this.payouts.listMine(user.mid as string);
    return payouts.map((payout) => ({
      ...payout,
      presentation: withPayoutActionCandidates(payout.presentation, user, true),
    }));
  }
}
