import { Body, Controller, Get, Header, HttpCode, Post, Query, Res } from '@nestjs/common';
import { PayoutStatus, Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../sales/sales.service';
import { PayoutsService } from './payouts.service';
import {
  exportPayoutsSchema,
  ExportPayoutsInput,
  listPayoutsSchema,
  ListPayoutsInput,
  runPayoutSchema,
  RunPayoutInput,
} from './payouts.types';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];

/** Admin payout yonetimi (SPEC 9): payable liste → run → CSV. Yalniz admin+ (staff goremez). */
@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Get('payable')
  payable(@CurrentUser() user: RequestUser) {
    return this.payouts.payable(user.tid as string);
  }

  @HttpCode(200)
  @Post('run')
  run(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(runPayoutSchema)) body: RunPayoutInput) {
    return this.payouts.run(this.actor(user), body);
  }

  @Get()
  list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listPayoutsSchema)) q: ListPayoutsInput) {
    return this.payouts.list(user.tid as string, { ...q, status: q.status as PayoutStatus | undefined });
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="payouts.csv"')
  async export(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(exportPayoutsSchema)) q: ExportPayoutsInput,
    @Res() res: Response,
  ) {
    const csv = await this.payouts.exportCsv(user.tid as string, q.period);
    res.send(csv);
  }
}

/** Uye payout talebi + gecmisi (SPEC 8). */
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
