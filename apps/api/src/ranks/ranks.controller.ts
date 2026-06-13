import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { RanksService } from './ranks.service';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];
const tierSchema = z.object({
  name: z.string().trim().min(1).max(40),
  sortOrder: z.number().int().min(0).max(100),
  minTeam: z.number().int().min(0).max(1_000_000),
  minEarningsCents: z.number().int().min(0),
});
const tierUpdateSchema = tierSchema.partial();

/** Admin rutbe merdiveni yonetimi. */
@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/ranks')
export class RanksController {
  constructor(private readonly ranks: RanksService) {}
  private actor(user: RequestUser): ActorContext { return { userId: user.sub, tenantId: user.tid as string }; }

  @Get()
  list(@CurrentUser() user: RequestUser) { return this.ranks.list(user.tid as string); }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(tierSchema)) body: z.infer<typeof tierSchema>) {
    return this.ranks.create(this.actor(user), body);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(tierUpdateSchema)) body: z.infer<typeof tierUpdateSchema>) {
    return this.ranks.update(this.actor(user), id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ranks.remove(this.actor(user), id);
  }
}

/** Uye: kendi rutbesi + ilerleme + rozetler. */
@RequireMembership()
@Controller('app/rank')
export class AppRankController {
  constructor(private readonly ranks: RanksService) {}

  @Get()
  mine(@CurrentUser() user: RequestUser) {
    return this.ranks.memberRank(user.mid as string, user.tid as string);
  }
}
