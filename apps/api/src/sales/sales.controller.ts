import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext, SalesService } from './sales.service';
import {
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

  // staff satis girebilir; payout/plan goremez (SPEC 4.2)
  @Roles(...STAFF)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createSaleSchema)) body: CreateSaleInput) {
    return this.sales.create(this.actor(user), body);
  }

  @Roles(...STAFF)
  @Get()
  list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listSalesSchema)) q: ListSalesInput) {
    return this.sales.list(this.actor(user), q);
  }

  @Roles(...STAFF)
  @HttpCode(200)
  @Post('import')
  import(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(importSchema)) body: ImportInput) {
    return this.sales.importCsv(this.actor(user), body.csv);
  }

  // para etkileyen aksiyonlar yalnizca admin+ (SPEC 4.2, audit'li)
  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/approve')
  approve(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.approve(this.actor(user), id);
  }

  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/void')
  void(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.void(this.actor(user), id);
  }

  @Roles(...ADMIN)
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
