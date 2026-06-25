import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, RequireMembership, RequirePermission, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ALL_PERMISSIONS } from '../common/permissions';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { SalesService } from './sales.service';
import {
  bulkSchema,
  BulkInput,
  createSaleSchema,
  CreateSaleInput,
  deliverSchema,
  DeliverInput,
  importSchema,
  ImportInput,
  listSalesSchema,
  ListSalesInput,
} from './sales.types';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];
const ADMIN = [Role.tenant_owner, Role.tenant_admin];

/** Tenant yonetimi — satis (SPEC 8/9). Tum islemler aktif uyelik + rol ister. */
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
      throw new ForbiddenException('bu islem icin yetkiniz yok');
    }
  }

  // staff satis girebilir; payout/plan goremez (SPEC 4.2)
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

  @Roles(...STAFF)
  @RequirePermission('sales.import')
  @HttpCode(200)
  @Post('import')
  import(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(importSchema)) body: ImportInput) {
    return this.sales.importCsv(this.actor(user), body.csv, body.mapping, body.preview ?? false);
  }

  // para etkileyen toplu aksiyon yalnizca admin+
  @Roles(...ADMIN)
  @HttpCode(200)
  @Post('bulk')
  bulk(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(bulkSchema)) body: BulkInput) {
    this.assertPermission(user, body.action === 'approve' ? 'sales.approve' : 'sales.void');
    return this.sales.bulk(this.actor(user), body.action, body.ids);
  }

  @Roles(...STAFF)
  @RequirePermission('sales.view')
  @Get(':id')
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.detail(this.actor(user), id);
  }

  // para etkileyen aksiyonlar yalnizca admin+ (SPEC 4.2, audit'li)
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
}
