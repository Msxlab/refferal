import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { MembershipStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, RequirePermission, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { parseIdempotencyKey } from '../common/idempotency-key';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ActorContext } from '../common/actor';
import { MembersAdminService } from './members.admin.service';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];
const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];

const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const inviteSchema = z.object({
  sponsorReferralCode: z.string().trim().min(3).max(32).optional(),
  sponsorMembershipId: z.string().uuid().optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});

@RequireMembership()
@Controller('admin/members')
export class MembersAdminController {
  constructor(private readonly members: MembersAdminService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Roles(...STAFF)
  @RequirePermission('members.view')
  @Get()
  list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.members.list(user.tid as string, { ...q, status: q.status as MembershipStatus | undefined });
  }

  @Roles(...STAFF)
  @RequirePermission('network.view')
  @Get('tree')
  tree(@CurrentUser() user: RequestUser) {
    return this.members.tree(user.tid as string);
  }

  // Invites and membership status changes are admin+ only and audited.
  @Roles(...ADMIN)
  @RequirePermission('invites.create')
  @HttpCode(200)
  @Post('invite')
  invite(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(inviteSchema)) body: z.infer<typeof inviteSchema>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.members.invite(this.actor(user), user.mid as string, body, parseIdempotencyKey(idempotencyKey));
  }

  @Roles(...ADMIN)
  @RequirePermission('members.suspend')
  @HttpCode(200)
  @Post(':id/deactivate')
  deactivate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.setStatus(this.actor(user), id, MembershipStatus.inactive);
  }

  @Roles(...ADMIN)
  @RequirePermission('members.suspend')
  @HttpCode(200)
  @Post(':id/activate')
  activate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.setStatus(this.actor(user), id, MembershipStatus.active);
  }

}
