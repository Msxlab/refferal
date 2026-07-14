import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { PayoutStatus, Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser, RequireMembership, RequirePermission, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { PayoutsService } from './payouts.service';
import {
  exportPayoutsSchema,
  ExportPayoutsInput,
  failPayoutBatchSchema,
  FailPayoutBatchInput,
  approvePayoutRequestSchema,
  ApprovePayoutRequestInput,
  listPayoutsSchema,
  ListPayoutsInput,
  rejectPayoutRequestSchema,
  RejectPayoutRequestInput,
  runPayoutSchema,
  RunPayoutInput,
  settlePayoutBatchSchema,
  SettlePayoutBatchInput,
  startPayoutBatchSchema,
  StartPayoutBatchInput,
} from './payouts.types';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];

/** Admin payout management (SPEC 9): payable list -> run -> CSV. Admin roles only; staff cannot access it. */
@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Get('payable')
  @RequirePermission('payouts.view')
  payable(@CurrentUser() user: RequestUser) {
    return this.payouts.payable(user.tid as string);
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
  list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listPayoutsSchema)) q: ListPayoutsInput) {
    return this.payouts.list(user.tid as string, { ...q, status: q.status as PayoutStatus | undefined });
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
  mine(@CurrentUser() user: RequestUser) {
    return this.payouts.listMine(user.mid as string);
  }
}
