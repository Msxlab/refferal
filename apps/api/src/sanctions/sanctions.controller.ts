import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { SanctionsService } from './sanctions.service';

const ADMIN = [Role.tenant_owner, Role.tenant_admin];
const screenSchema = z.object({ name: z.string().trim().min(1).max(200) });

@RequireMembership()
@Roles(...ADMIN)
@Controller('admin/sanctions')
export class SanctionsController {
  constructor(private readonly sanctions: SanctionsService) {}

  @Get()
  async status() {
    return { entries: await this.sanctions.count() };
  }

  @HttpCode(200)
  @Post('refresh')
  refresh() {
    return this.sanctions.refresh();
  }

  @Get('screen')
  screen(@CurrentUser() _user: RequestUser, @Query(new ZodValidationPipe(screenSchema)) q: z.infer<typeof screenSchema>) {
    return this.sanctions.screen(q.name);
  }
}
