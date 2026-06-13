import {
  CanActivate,
  createParamDecorator,
  CustomDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { authConfig } from './auth.config';
import { RequestUser } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]): CustomDecorator => SetMetadata(ROLES_KEY, roles);

/** Ince yetki: gereken izin anahtari (common/permissions.ts). owner/platform otomatik gecer. */
export const PERMISSION_KEY = 'permission';
export const RequirePermission = (permission: string): CustomDecorator =>
  SetMetadata(PERMISSION_KEY, permission);

/** Kiracci-ustu platform yuzeyi: yalnizca isPlatformAdmin (plat claim) erisebilir. */
export const PLATFORM_KEY = 'platformOnly';
export const PlatformAdmin = (): CustomDecorator => SetMetadata(PLATFORM_KEY, true);

// enum katmani → guard'da tum-izinli sayilan roller (perms claim'i gomulmez)
const GOD_TIERS: ReadonlySet<Role> = new Set([Role.platform_admin, Role.tenant_owner]);

/** Aktif uyelik (mid claim) gerektiren rotalar icin — /app ve /admin yuzeyleri. */
export const REQUIRE_MEMBERSHIP_KEY = 'requireMembership';
export const RequireMembership = (): CustomDecorator => SetMetadata(REQUIRE_MEMBERSHIP_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();
  return req.user;
});

/**
 * Global guard: @Public() haric her rota Bearer access token ister.
 * @Roles(...) varsa rol claim'i kontrol edilir; @RequireMembership() aktif uyelik ister.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly logger = new Logger(AccessTokenGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('erisim tokeni gerekli');
    }

    let payload: RequestUser;
    try {
      payload = await this.jwt.verifyAsync<RequestUser>(header.slice(7), {
        secret: authConfig.accessSecret(),
      });
    } catch {
      throw new UnauthorizedException('erisim tokeni gecersiz veya suresi dolmus');
    }
    req.user = payload;

    // impersonation salt-okunur: admin uye adina yalniz GET yapabilir (para/mutasyon yasak)
    if (payload.imp && req.method !== 'GET') {
      this.logger.warn(`[security] impersonation_write_blocked imp=${payload.imp} as=${payload.sub} ${req.method} ${req.url}`);
      throw new ForbiddenException('impersonation oturumu salt-okunurdur');
    }

    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_MEMBERSHIP_KEY, targets) && !payload.mid) {
      throw new ForbiddenException('aktif uyelik secimi gerekli (switch-tenant)');
    }

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (roles?.length) {
      if (!payload.role || !roles.includes(payload.role)) {
        // yetki ihlali: tespit/forensics icin logla (DB yazimi guard'da agir, structured log yeterli)
        this.logger.warn(
          `[security] authz_denied user=${payload.sub} role=${payload.role} need=${roles.join('|')} ${req.method} ${req.url}`,
        );
        throw new ForbiddenException('bu islem icin yetkiniz yok');
      }
    }

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_KEY, targets) && !payload.plat) {
      this.logger.warn(`[security] platform_denied user=${payload.sub} ${req.method} ${req.url}`);
      throw new ForbiddenException('platform yetkisi gerekli');
    }

    const permission = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, targets);
    if (permission) {
      const granted = !!payload.role && GOD_TIERS.has(payload.role);
      if (!granted && !payload.perms?.includes(permission)) {
        this.logger.warn(
          `[security] perm_denied user=${payload.sub} role=${payload.role} need=${permission} ${req.method} ${req.url}`,
        );
        throw new ForbiddenException('bu islem icin yetkiniz yok');
      }
    }

    return true;
  }
}
