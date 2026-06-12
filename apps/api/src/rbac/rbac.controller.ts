import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, RequireMembership, RequirePermission } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ActorContext } from '../common/actor';
import { ZodValidationPipe } from '../common/zod.pipe';
import { RbacService } from './rbac.service';
import {
  AssignRoleInput,
  CreateRoleInput,
  UpdateRoleInput,
  assignRoleSchema,
  createRoleSchema,
  updateRoleSchema,
} from './rbac.types';

@RequireMembership()
@Controller('admin')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @RequirePermission('settings.roles')
  @Get('permissions')
  permissions() {
    return this.rbac.permissionCatalog();
  }

  @RequirePermission('settings.roles')
  @Get('roles')
  listRoles(@CurrentUser() user: RequestUser) {
    return this.rbac.listRoles(user.tid as string);
  }

  @RequirePermission('settings.roles')
  @Post('roles')
  createRole(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleInput,
  ) {
    return this.rbac.createRole(this.actor(user), body);
  }

  @RequirePermission('settings.roles')
  @Patch('roles/:id')
  updateRole(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleInput,
  ) {
    return this.rbac.updateRole(this.actor(user), id, body);
  }

  @RequirePermission('settings.roles')
  @Delete('roles/:id')
  deleteRole(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rbac.deleteRole(this.actor(user), id);
  }

  @RequirePermission('settings.roles')
  @Get('people')
  listPeople(@CurrentUser() user: RequestUser) {
    return this.rbac.listPeople(user.tid as string);
  }

  @RequirePermission('settings.roles')
  @Patch('people/:membershipId/role')
  assignRole(
    @CurrentUser() user: RequestUser,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(assignRoleSchema)) body: AssignRoleInput,
  ) {
    return this.rbac.assignRole(this.actor(user), membershipId, body);
  }
}
