import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ApiKeysService } from './apikeys.service';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];
const createSchema = z.object({ name: z.string().trim().min(1).max(60) });

@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.keys.list(user.tid as string);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.keys.create({ tenantId: user.tid as string, membershipId: user.mid as string, userId: user.sub, role: (user.role as Role) ?? Role.tenant_admin, name: body.name });
  }

  @Delete(':id')
  revoke(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.keys.revoke(user.tid as string, user.sub, id);
  }
}
