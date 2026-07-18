import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser, RequireMembership, RequirePermission, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { parseIdempotencyKey } from '../common/idempotency-key';
import { ALL_PERMISSIONS } from '../common/permissions';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { SalesService } from './sales.service';
import {
  confirmBulkSchema,
  ConfirmBulkInput,
  createSaleSchema,
  CreateSaleInput,
  deliverSchema,
  DeliverInput,
  importSchema,
  ImportInput,
  listMySalesSchema,
  ListMySalesInput,
  listSalesSchema,
  ListSalesInput,
  previewBulkSchema,
  PreviewBulkInput,
  salesFilterSchema,
  SalesFilterInput,
  selfCreateSaleSchema,
  SelfCreateSaleInput,
} from './sales.types';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];
const ADMIN = [Role.tenant_owner, Role.tenant_admin];

/** Tenant sales management (SPEC 8/9). All actions require active membership and role checks. */
@RequireMembership()
@Controller('admin/sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  private assertPermission(user: RequestUser, permission: string): void {
    if (user.role === Role.tenant_owner || user.role === Role.platform_admin) return;
    if (!ALL_PERMISSIONS.includes(permission) || !user.perms?.includes(permission)) {
      throw new ForbiddenException('you do not have permission for this action');
    }
  }

  // Staff can create sales but cannot see payout or plan data (SPEC 4.2).
  @Roles(...STAFF)
  @RequirePermission('sales.create')
  @Post()
  create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createSaleSchema)) body: CreateSaleInput) {
    return this.sales.create(this.actor(user), body);
  }

  @Roles(...STAFF)
  @RequirePermission('sales.view')
  @Get()
  list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listSalesSchema)) q: ListSalesInput) {
    return this.sales.list(this.actor(user), q);
  }

  // DIKKAT: statik GET route'lar ':id'den ONCE tanimlanmali (yoksa 'summary' UUID sanilir → 400)
  @Roles(...STAFF)
  @Get('summary')
  summary(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(salesFilterSchema)) q: SalesFilterInput) {
    return this.sales.summary(this.actor(user), q);
  }

  @Roles(...STAFF)
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="sales.csv"')
  async export(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(salesFilterSchema)) q: SalesFilterInput,
    @Res() res: Response,
  ) {
    const csv = await this.sales.exportCsv(this.actor(user), q);
    res.send(csv);
  }

  @Roles(...STAFF)
  @RequirePermission('sales.import')
  @HttpCode(200)
  @Post('import')
  import(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(importSchema)) body: ImportInput) {
    return this.sales.importCsv(this.actor(user), body.csv, body.mapping, body.preview ?? false);
  }

  // Money-impacting bulk actions are admin+ only.
  @Roles(...ADMIN)
  @HttpCode(200)
  @Post('bulk/preview')
  previewBulk(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(previewBulkSchema)) body: PreviewBulkInput,
  ) {
    this.assertPermission(user, body.action === 'approve' ? 'sales.approve' : 'sales.void');
    return this.sales.previewBulk(this.actor(user), body);
  }

  @Roles(...ADMIN)
  @HttpCode(200)
  @Post('bulk')
  bulk(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(confirmBulkSchema)) body: ConfirmBulkInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const parsedIdempotencyKey = parseIdempotencyKey(idempotencyKey);
    if (!parsedIdempotencyKey) throw new BadRequestException('Idempotency-Key is required');
    const actor = this.actor(user);
    const action = this.sales.reviewedBulkAction(actor, body.previewToken);
    this.assertPermission(user, action === 'approve' ? 'sales.approve' : 'sales.void');
    return this.sales.bulk(actor, body, parsedIdempotencyKey);
  }

  @Roles(...STAFF)
  @RequirePermission('sales.view')
  @Get(':id')
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.detail(this.actor(user), id);
  }

  // Money-impacting actions are admin+ only and audited (SPEC 4.2).
  @Roles(...ADMIN)
  @RequirePermission('sales.approve')
  @HttpCode(200)
  @Post(':id/approve')
  approve(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.approve(this.actor(user), id);
  }

  @Roles(...ADMIN)
  @RequirePermission('sales.void')
  @HttpCode(200)
  @Post(':id/void')
  void(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.void(this.actor(user), id);
  }

  @Roles(...ADMIN)
  @RequirePermission('sales.approve')
  @HttpCode(200)
  @Post(':id/deliver')
  deliver(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(deliverSchema)) body: DeliverInput,
  ) {
    return this.sales.deliver(this.actor(user), id, body.deliveredAt);
  }

  // hard delete yalnizca taslak icin; para etkileyen aksiyon gibi admin+ ve audit'li
  @Roles(...ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.remove(this.actor(user), id);
  }
}

/** Uye self-servis satis (SPEC 8): her aktif uye kendi adina satis girer/listeler. Rol sarti yok. */
@RequireMembership()
@Controller('app/sales')
export class AppSalesController {
  constructor(private readonly sales: SalesService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(selfCreateSaleSchema)) body: SelfCreateSaleInput,
  ) {
    return this.sales.selfCreate(this.actor(user), user.mid as string, body);
  }

  @Get()
  mine(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listMySalesSchema)) q: ListMySalesInput) {
    return this.sales.listMine(this.actor(user), user.mid as string, q);
  }
}
