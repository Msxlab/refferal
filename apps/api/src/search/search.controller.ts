import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { SearchService } from './search.service';

const STAFF = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];
const searchSchema = z.object({ q: z.string().trim().max(120) });

@RequireMembership()
@Roles(...STAFF)
@Controller('admin/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  query(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(searchSchema)) q: z.infer<typeof searchSchema>) {
    return this.search.search(user.tid as string, q.q);
  }
}
