import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { CampaignsService } from './campaigns.service';
import { createCampaignSchema, CreateCampaignInput, updateCampaignSchema, UpdateCampaignInput } from './campaigns.types';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];
const ADMIN = [Role.tenant_owner, Role.tenant_admin];

/** Admin kampanya yonetimi. Goruntuleme STAFF; odul tanimlayan/bonus dagitan mutasyonlar ADMIN. */
@RequireMembership()
@Controller('admin/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Roles(...STAFF)
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.campaigns.list(user.tid as string);
  }

  @Roles(...ADMIN)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createCampaignSchema)) body: CreateCampaignInput) {
    return this.campaigns.create(this.actor(user), body);
  }

  @Roles(...STAFF)
  @Get(':id')
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.detail(user.tid as string, id);
  }

  @Roles(...ADMIN)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCampaignSchema)) body: UpdateCampaignInput,
  ) {
    return this.campaigns.update(this.actor(user), id, body);
  }

  @Roles(...ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.remove(this.actor(user), id);
  }

  // bonus dagitan, para etkileyen aksiyon — ADMIN + audit'li
  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/finalize')
  finalize(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.finalize(this.actor(user), id);
  }
}

/** Uye yuzeyi: aktif kampanyalar + kendi sirasi. */
@RequireMembership()
@Controller('app/campaigns')
export class AppCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  mine(@CurrentUser() user: RequestUser) {
    return this.campaigns.forMember(user.tid as string, user.mid as string);
  }
}
