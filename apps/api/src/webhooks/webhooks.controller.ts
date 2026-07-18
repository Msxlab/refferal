import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { WebhooksService } from './webhooks.service';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];
const createSchema = z.object({
  url: z.string().trim().url().max(500),
  events: z.array(z.string().trim().max(60)).max(20).default([]),
});

@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.webhooks.list(user.tid as string);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.webhooks.create(user.tid as string, body.url, body.events);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.remove(user.tid as string, id);
  }

  @Get('deliveries')
  deliveries(@CurrentUser() user: RequestUser) {
    return this.webhooks.deliveries(user.tid as string);
  }

  @HttpCode(200)
  @Post('test')
  test(@CurrentUser() user: RequestUser) {
    return this.webhooks.sendTest(user.tid as string);
  }

  @HttpCode(200)
  @Post('deliveries/:id/replay')
  replay(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.replay(user.tid as string, id);
  }
}
