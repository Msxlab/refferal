import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, RequireMembership } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { InvitesService } from './invites.service';

const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});
type CreateInviteInput = z.infer<typeof createInviteSchema>;

const codeSchema = z.string().trim().min(4).max(64);

/** Public: /i/{code} sayfasinin davet cozumlemesi. */
@Controller('invites')
export class PublicInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Public()
  @Get(':code')
  resolve(@Param('code', new ZodValidationPipe(codeSchema)) code: string) {
    return this.invites.resolve(code);
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
}
