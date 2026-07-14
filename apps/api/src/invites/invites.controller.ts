import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, RequireMembership } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { parseIdempotencyKey } from '../common/idempotency-key';
import { ZodValidationPipe } from '../common/zod.pipe';
import { InvitesService } from './invites.service';

const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});
type CreateInviteInput = z.infer<typeof createInviteSchema>;

const codeSchema = z.string().trim().min(4).max(64);

/** Public invite resolution for the /i/{code} registration page. */
@Controller('invites')
export class PublicInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Public()
  @Get(':code')
  resolve(@Param('code', new ZodValidationPipe(codeSchema)) code: string) {
    return this.invites.resolve(code);
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
}
