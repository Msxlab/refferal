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
  exportPayoutsSchema,
  ExportPayoutsInput,
  failPayoutBatchSchema,
  FailPayoutBatchInput,
  approvePayoutRequestSchema,
  ApprovePayoutRequestInput,
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
        presentation: withPayoutActionCandidates(payout.presentation, user),
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
