import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { MembershipStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
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
const roleSchema = z.object({ role: z.enum(['tenant_admin', 'tenant_staff', 'member']) });

@RequireMembership()
@Controller('admin/members')
export class MembersAdminController {
  constructor(private readonly members: MembersAdminService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Roles(...STAFF)
  @Get()
  list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.members.list(user.tid as string, { ...q, status: q.status as MembershipStatus | undefined });
  }

  @Roles(...STAFF)
  @Get('tree')
  tree(@CurrentUser() user: RequestUser) {
    return this.members.tree(user.tid as string);
  }

  // davet/pasiflestir/rol → admin+ (audit'li)
  @Roles(...ADMIN)
  @HttpCode(200)
  @Post('invite')
  invite(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(inviteSchema)) body: z.infer<typeof inviteSchema>) {
    return this.members.invite(this.actor(user), user.mid as string, body);
  }

  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/deactivate')
  deactivate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.setStatus(this.actor(user), id, MembershipStatus.inactive);
  }

  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/activate')
  activate(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.setStatus(this.actor(user), id, MembershipStatus.active);
  }

  @Roles(...ADMIN)
  @HttpCode(200)
  @Post(':id/role')
  setRole(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(roleSchema)) body: z.infer<typeof roleSchema>,
  ) {
    return this.members.setRole(this.actor(user), id, body.role as Role);
  }
}
