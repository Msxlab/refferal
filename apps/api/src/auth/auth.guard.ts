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
import { MembershipStatus, Role, TenantStatus } from '@prisma/client';
import { Request } from 'express';
import { defaultPermissionsForTier } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
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

export const MFA_EXEMPT_KEY = 'mfaExempt';
export const MfaExempt = (): CustomDecorator => SetMetadata(MFA_EXEMPT_KEY, true);

// enum katmani → guard'da tum-izinli sayilan roller (perms claim'i gomulmez)
const GOD_TIERS: ReadonlySet<Role> = new Set([Role.platform_admin, Role.tenant_owner]);
const DEFAULT_MFA_REQUIRED_ROLES = process.env.NODE_ENV === 'test' ? '' : 'tenant_owner,tenant_admin,platform_admin';
const VALID_ROLES = new Set<string>(Object.values(Role));

function mfaRequiredRoles(): ReadonlySet<Role> {
  const raw = process.env.MFA_REQUIRED_ROLES ?? DEFAULT_MFA_REQUIRED_ROLES;
  return new Set(
    raw
      .split(',')
      .map((r) => r.trim())
      .filter((r): r is Role => VALID_ROLES.has(r)),
  );
}

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
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const requireMembership = this.reflector.getAllAndOverride<boolean>(REQUIRE_MEMBERSHIP_KEY, targets);
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    const platformOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_KEY, targets);
    const permission = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, targets);
    const mfaExempt = this.reflector.getAllAndOverride<boolean>(MFA_EXEMPT_KEY, targets);

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
    let userMfaEnabled = payload.mfa === true;

    if (requireMembership && !payload.mid) {
      throw new ForbiddenException('aktif uyelik secimi gerekli (switch-tenant)');
    }

    if (payload.mid) {
      const membership = await this.prisma.membership.findFirst({
        where: { id: payload.mid, userId: payload.sub, tenantId: payload.tid ?? undefined },
        select: {
          role: true,
          status: true,
          updatedAt: true,
          roleRef: { select: { permissions: true, updatedAt: true } },
          tenant: { select: { status: true } },
          user: { select: { totpEnabledAt: true } },
        },
      });
      if (!membership || membership.status !== MembershipStatus.active || membership.tenant.status !== TenantStatus.active) {
        this.logger.warn(`[security] inactive_membership user=${payload.sub} mid=${payload.mid} ${req.method} ${req.url}`);
        throw new ForbiddenException('aktif uyelik bulunamadi');
      }
      const membershipVersion = membership.updatedAt.getTime();
      const roleVersion = membership.roleRef?.updatedAt.getTime() ?? null;
      const tokenHasVersion = payload.mver !== undefined || payload.rver !== undefined;
      if (tokenHasVersion && (payload.mver !== membershipVersion || (payload.rver ?? null) !== roleVersion)) {
        this.logger.warn(`[security] stale_authz_token user=${payload.sub} mid=${payload.mid} ${req.method} ${req.url}`);
      }
      payload.role = membership.role;
      payload.perms =
        membership.role === Role.tenant_admin || membership.role === Role.tenant_staff
          ? membership.roleRef?.permissions ?? defaultPermissionsForTier(membership.role)
          : defaultPermissionsForTier(membership.role);
      payload.mver = membershipVersion;
      if (roleVersion === null) delete payload.rver;
      else payload.rver = roleVersion;
      userMfaEnabled = membership.user.totpEnabledAt !== null;
      if (userMfaEnabled) payload.mfa = true;
      else delete payload.mfa;
      req.user = payload;
    }

    if (roles?.length) {
      if (!payload.role || !roles.includes(payload.role)) {
        // yetki ihlali: tespit/forensics icin logla (DB yazimi guard'da agir, structured log yeterli)
        this.logger.warn(
          `[security] authz_denied user=${payload.sub} role=${payload.role} need=${roles.join('|')} ${req.method} ${req.url}`,
        );
        throw new ForbiddenException('bu islem icin yetkiniz yok');
      }
    }

    if (platformOnly) {
      if (!payload.plat) {
        this.logger.warn(`[security] platform_denied user=${payload.sub} ${req.method} ${req.url}`);
        throw new ForbiddenException('platform yetkisi gerekli');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isPlatformAdmin: true, totpEnabledAt: true },
      });
      if (!user?.isPlatformAdmin) {
        this.logger.warn(`[security] platform_revoked user=${payload.sub} ${req.method} ${req.url}`);
        throw new ForbiddenException('platform yetkisi gerekli');
      }
      userMfaEnabled = user.totpEnabledAt !== null;
      if (userMfaEnabled) payload.mfa = true;
      else delete payload.mfa;
    } else if (payload.plat) {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isPlatformAdmin: true, totpEnabledAt: true },
      });
      if (!user?.isPlatformAdmin) {
        payload.plat = false;
      }
      userMfaEnabled = user?.totpEnabledAt != null;
      if (userMfaEnabled) payload.mfa = true;
      else delete payload.mfa;
    }

    if (platformOnly && !payload.plat) {
      this.logger.warn(`[security] platform_denied user=${payload.sub} ${req.method} ${req.url}`);
      throw new ForbiddenException('platform yetkisi gerekli');
    }

    if (!mfaExempt) {
      this.enforceMfa(payload, userMfaEnabled, req);
    }

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

  private enforceMfa(payload: RequestUser, userMfaEnabled: boolean, req: Request): void {
    const required = mfaRequiredRoles();
    const roleRequiresMfa = !!payload.role && required.has(payload.role);
    const platformRequiresMfa = !!payload.plat && required.has(Role.platform_admin);
    if ((roleRequiresMfa || platformRequiresMfa) && !userMfaEnabled) {
      this.logger.warn(`[security] mfa_required user=${payload.sub} role=${payload.role} ${req.method} ${req.url}`);
      throw new ForbiddenException('2FA required for this account');
    }
  }
}
