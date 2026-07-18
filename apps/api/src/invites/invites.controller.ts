import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { AccountSessionOnly, CurrentUser, Public, RequireMembership, Roles } from '../auth/auth.guard';
import { InviteContinuationDto, InviteResolveDto, RequestUser } from '../auth/auth.types';
import { parseIdempotencyKey } from '../common/idempotency-key';
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

/** Public invite resolution for the /i/{code} registration page. */
@Controller('invites')
export class PublicInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Public()
  @Get(':code')
  resolve(@Param('code', new ZodValidationPipe(codeSchema)) code: string): Promise<InviteResolveDto> {
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

/** Authenticated recovery for a user who already consumed an invite. */
@AccountSessionOnly()
@Controller('invite-continuations')
export class InviteContinuationsController {
  constructor(private readonly invites: InvitesService) {}

  @Get(':code')
  resolve(
    @CurrentUser() user: RequestUser,
    @Param('code', new ZodValidationPipe(codeSchema)) code: string,
  ): Promise<InviteContinuationDto> {
    return this.invites.continuation(code, user.sub);
  }
}

/** Member surface: create invites and list the caller's own invites. */
@RequireMembership()
@Controller('app/invites')
export class AppInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createInviteSchema)) body: CreateInviteInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.invites.create(user.mid as string, body, parseIdempotencyKey(idempotencyKey));
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
