import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { AnnouncementsService } from './announcements.service';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];
const createSchema = z.object({ title: z.string().trim().min(1).max(140), body: z.string().trim().min(1).max(4000) });

@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/announcements')
export class AdminAnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}
  private actor(user: RequestUser): ActorContext { return { userId: user.sub, tenantId: user.tid as string }; }

  @Get()
  list(@CurrentUser() user: RequestUser) { return this.svc.listAdmin(user.tid as string); }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.svc.create(this.actor(user), body.title, body.body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(this.actor(user), id);
  }
}

@RequireMembership()
@Controller('app/announcements')
export class AppAnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Get()
  mine(@CurrentUser() user: RequestUser) { return this.svc.listForMember(user.tid as string, user.mid as string); }

  @HttpCode(200)
  @Post(':id/read')
  read(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(user.tid as string, user.mid as string, id);
  }
}
