import { Controller, Get, Header } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, PlatformAdmin, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { RecommendationsService } from './recommendations.service';

const CACHE_CONTROL = 'private, no-store';
const TENANT_ADMIN_SURFACE = [Role.tenant_owner, Role.tenant_admin, Role.tenant_staff];

/** Member recommendations are read-only and derived solely from the active membership claim. */
@RequireMembership()
@Controller('app')
export class AppRecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get('recommendations')
  @Header('Cache-Control', CACHE_CONTROL)
  list(@CurrentUser() user: RequestUser) {
    return this.recommendations.member(user);
  }
}

/** Tenant candidate visibility is decided in the service from the guard's live permission set. */
@RequireMembership()
@Roles(...TENANT_ADMIN_SURFACE)
@Controller('admin')
export class AdminRecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get('recommendations')
  @Header('Cache-Control', CACHE_CONTROL)
  list(@CurrentUser() user: RequestUser) {
    return this.recommendations.tenant(user);
  }
}

/** Platform recommendations intentionally expose only cross-tenant aggregate counts. */
@PlatformAdmin()
@Controller('platform')
export class PlatformRecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get('recommendations')
  @Header('Cache-Control', CACHE_CONTROL)
  list() {
    return this.recommendations.platform();
  }
}
