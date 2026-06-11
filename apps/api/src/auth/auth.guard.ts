import {
  CanActivate,
  createParamDecorator,
  CustomDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
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

    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_MEMBERSHIP_KEY, targets) && !payload.mid) {
      throw new ForbiddenException('aktif uyelik secimi gerekli (switch-tenant)');
    }

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (roles?.length) {
      if (!payload.role || !roles.includes(payload.role)) {
        throw new ForbiddenException('bu islem icin yetkiniz yok');
      }
    }

    return true;
  }
}
