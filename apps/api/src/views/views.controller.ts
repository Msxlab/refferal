import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { ViewsService } from './views.service';
import { createViewSchema, CreateViewInput, listViewsSchema, ListViewsInput, updateViewSchema, UpdateViewInput } from './views.types';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];

/** Kayitli gorunumler (filtre/siralama setleri). Her staff kendi + ekip paylasimlarini gorur. */
@RequireMembership()
@Roles(...STAFF)
@Controller('admin/views')
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Get()
  list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listViewsSchema)) q: ListViewsInput) {
    return this.views.list(user.tid as string, user.sub, q.target);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createViewSchema)) body: CreateViewInput) {
    return this.views.create(this.actor(user), body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateViewSchema)) body: UpdateViewInput,
  ) {
    return this.views.update(this.actor(user), id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.views.remove(this.actor(user), id);
  }
}
