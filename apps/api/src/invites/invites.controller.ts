import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Public, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { InvitesService } from './invites.service';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];

const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});
type CreateInviteInput = z.infer<typeof createInviteSchema>;

const codeSchema = z.string().trim().min(4).max(64);
const trackSchema = z.object({ event: z.literal('view'), utmSource: z.string().trim().max(80).optional() });
const messageSchema = z.object({ message: z.string().trim().max(280).nullable() });

/** Public: /i/{code} sayfasinin davet cozumlemesi + funnel tracking. */
@Controller('invites')
export class PublicInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Public()
  @Get(':code')
  resolve(@Param('code', new ZodValidationPipe(codeSchema)) code: string) {
    return this.invites.resolve(code);
  }

  @Public()
  @HttpCode(200)
  @Post(':code/event')
  track(
    @Param('code', new ZodValidationPipe(codeSchema)) code: string,
    @Body(new ZodValidationPipe(trackSchema)) body: z.infer<typeof trackSchema>,
  ) {
    return this.invites.track(code, body.event, body.utmSource);
  }
}

/** Admin: davet funnel ozeti. */
@RequireMembership()
@Roles(...STAFF)
@Controller('admin/invite-funnel')
export class AdminInviteFunnelController {
  constructor(private readonly invites: InvitesService) {}

  @Get()
  funnel(@CurrentUser() user: RequestUser) {
    return this.invites.funnel(user.tid as string);
  }
}

/** Uye yuzeyi: davet olustur + kendi davetlerini listele. */
@RequireMembership()
@Controller('app/invites')
export class AppInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createInviteSchema)) body: CreateInviteInput,
  ) {
    return this.invites.create(user.mid as string, body);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.invites.listMine(user.mid as string);
  }

  // kisisel davet karsilama mesaji (#23)
  @Get('message')
  getMessage(@CurrentUser() user: RequestUser) {
    return this.invites.getMessage(user.mid as string);
  }

  @Post('message')
  @HttpCode(200)
  setMessage(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(messageSchema)) body: z.infer<typeof messageSchema>) {
    return this.invites.setMessage(user.mid as string, body.message);
  }
}
