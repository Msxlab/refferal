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
import { sha256 } from '../common/crypto';
import { defaultPermissionsForTier } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { authConfig } from './auth.config';
import { mfaRequiredRoles } from './mfa-policy';
import { RequestUser } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]): CustomDecorator => SetMetadata(ROLES_KEY, roles);

/** Fine-grained permission key required by the route. owner/platform pass automatically. */
export const PERMISSION_KEY = 'permission';
export const RequirePermission = (permission: string): CustomDecorator =>
  SetMetadata(PERMISSION_KEY, permission);

/** Cross-tenant platform surface: only isPlatformAdmin (plat claim) can access it. */
export const PLATFORM_KEY = 'platformOnly';
export const PlatformAdmin = (): CustomDecorator => SetMetadata(PLATFORM_KEY, true);

export const MFA_EXEMPT_KEY = 'mfaExempt';
export const MfaExempt = (): CustomDecorator => SetMetadata(MFA_EXEMPT_KEY, true);

/** Account recovery surface: authenticate the user without trusting selected tenant context. */
export const ACCOUNT_SESSION_ONLY_KEY = 'accountSessionOnly';
export const AccountSessionOnly = (): CustomDecorator => SetMetadata(ACCOUNT_SESSION_ONLY_KEY, true);

// Enum tiers that the guard treats as all-permission roles; perms are omitted from the token.
const GOD_TIERS: ReadonlySet<Role> = new Set([Role.platform_admin, Role.tenant_owner]);

/** Marks routes that require an active membership (`mid` claim), such as /app and /admin surfaces. */
export const REQUIRE_MEMBERSHIP_KEY = 'requireMembership';
export const RequireMembership = (): CustomDecorator => SetMetadata(REQUIRE_MEMBERSHIP_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();
  return req.user;
});

/**
 * Global guard: every non-@Public() route requires a Bearer access token.
 * If @Roles(...) is present, the role claim is checked; @RequireMembership() requires active membership.
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
    const accountSessionOnly = this.reflector.getAllAndOverride<boolean>(ACCOUNT_SESSION_ONLY_KEY, targets);

    const req = ctx.switchToHttp().getRequest<Request & { user?: RequestUser }>();

    // API anahtari (entegrasyon): X-Api-Key → olusturan admin'in uyeligi/rolu adina davranir.
    const apiKey = req.headers['x-api-key'];
    let payload: RequestUser;
    // Principal'in API anahtarindan mi (uyelik+kiraci zaten dogrulandi) yoksa JWT'den mi geldigini izle.
    let fromApiKey = false;
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      const k = await this.prisma.apiKey.findUnique({
        where: { keyHash: sha256(apiKey) },
        include: { membership: { select: { status: true, role: true, tenant: { select: { status: true } } } } },
      });
      // yasam-dongusu kapilari: revoke / sure dolmus / uyelik pasif / kiraci askida -> reddet
      if (!k || k.revokedAt || (k.expiresAt && k.expiresAt.getTime() <= Date.now())) {
        throw new UnauthorizedException('gecersiz api anahtari');
      }
      if (k.membership.status !== 'active' || k.membership.tenant.status !== 'active') {
        this.logger.warn(`[security] apikey_inactive_principal key=${k.id} mid=${k.membershipId} tid=${k.tenantId}`);
        throw new UnauthorizedException('gecersiz api anahtari');
      }
      void this.prisma.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
      // rol her zaman CANLI uyelikten (k.membership.role) -- saklanmis stale rol downgrade'i asamaz
      payload = { sub: k.createdByUserId, mid: k.membershipId, tid: k.tenantId, role: k.membership.role, iat: 0, exp: 0 };
      fromApiKey = true;
    } else {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        throw new UnauthorizedException('erisim tokeni gerekli');
      }
      try {
        payload = await this.jwt.verifyAsync<RequestUser>(header.slice(7), { secret: authConfig.accessSecret() });
      } catch {
        throw new UnauthorizedException('erisim tokeni gecersiz veya suresi dolmus');
      }
    }

    let dbUser: { isPlatformAdmin: boolean; totpEnabledAt: Date | null; authGeneration: number } | null = null;
    if (!fromApiKey) {
      dbUser = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isPlatformAdmin: true, totpEnabledAt: true, authGeneration: true },
      });
      if (!dbUser || !this.hasCurrentAuthGeneration(payload, dbUser.authGeneration)) {
        this.logger.warn(`[security] stale_session user=${payload.sub} ${req.method} ${req.url}`);
        throw new UnauthorizedException('session is no longer active');
      }
    }

    if (accountSessionOnly) {
      payload.mid = null;
      payload.tid = null;
      payload.role = null;
      delete payload.perms;
      delete payload.mver;
      delete payload.rver;
      delete payload.plat;
    }

    const userMfaEnabled = !fromApiKey && dbUser?.totpEnabledAt !== null;
    const mfaEpoch = !fromApiKey ? (dbUser?.totpEnabledAt?.getTime() ?? null) : null;

    // A revoked platform grant must not remain usable for the remainder of an access-token TTL.
    if (payload.plat && !dbUser?.isPlatformAdmin) delete payload.plat;
    req.user = payload;

    // impersonation salt-okunur: admin uye adina yalniz GET yapabilir (para/mutasyon yasak)
    if (payload.imp && req.method !== 'GET') {
      this.logger.warn(`[security] impersonation_write_blocked imp=${payload.imp} as=${payload.sub} ${req.method} ${req.url}`);
      throw new ForbiddenException('impersonation oturumu salt-okunurdur');
    }

    // JWT bayatligi (#jwt-staleness): erisim tokeni statelessdir — pasif/yetkisi-dusurulmus uye token
    // dolana dek (~15dk) yazma yapabilir. Yalnizca DURUM-DEGISTIREN (GET disi) JWT isteklerinde TEK
    // indexli uyelik bakisi yap; api-key yolu zaten dogrulandi, GET okumalar 15dk tokeni korur.
    // Canli uyelik ASKIDA/PASIF ise reddet; rolu CANLI uyelikten tazele (downgrade aninda etki etsin).
    if (!fromApiKey && req.method !== 'GET' && payload.mid) {
      const m = await this.prisma.membership.findUnique({
        where: { id: payload.mid },
        select: { status: true, role: true, tenant: { select: { status: true } } },
      });
      if (!m || m.status !== 'active' || m.tenant.status !== 'active') {
        this.logger.warn(`[security] jwt_inactive_principal user=${payload.sub} mid=${payload.mid} ${req.method} ${req.url}`);
        throw new ForbiddenException('uyelik veya kiraci artik aktif degil');
      }
      // rol CANLI uyelikten — saklanmis stale rol bir downgrade'i asamaz
      payload.role = m.role;
      // NOT: ince izinler (perms) burada CANLI tazelenMEZ — bilincli (access-TTL tradeoff). Tazeleme,
      // servis assertGrantable tavanini aktorun perms'inden hesapladigi icin RBAC davranisini degistirir
      // (audit-remediation regresyonu). Coarse rol-downgrade + money-move re-gating B2 cekirdegini karsilar.
    }

    // Act-as (platform admin, uyelik yok): mid-bazli staleness kontrolu calismaz (mid=null).
    // Yuksek yetkili token oldugu icin write'larda CANLI dogrula: tenant hala aktif + kullanici
    // hala platform admin. Mint sonrasi askiya alinan tenant veya geri alinan platform-yetkisi
    // token TTL'i boyunca yazma yapamaz.
    if (!fromApiKey && req.method !== 'GET' && !payload.mid && payload.plat === true && payload.tid) {
      const [tenant, user] = await Promise.all([
        this.prisma.tenant.findUnique({ where: { id: payload.tid }, select: { status: true } }),
        this.prisma.user.findUnique({ where: { id: payload.sub }, select: { isPlatformAdmin: true } }),
      ]);
      if (!tenant || tenant.status !== TenantStatus.active || !user?.isPlatformAdmin) {
        this.logger.warn(`[security] act_as_inactive_principal user=${payload.sub} tid=${payload.tid} ${req.method} ${req.url}`);
        throw new ForbiddenException('act-as: tenant askida veya platform yetkisi yok');
      }
    }

    // Act-as istisna: platform admin bir sirket adina davranirken (plat && tid) uyeligi (mid) yoktur.
    // Boyle bir token YALNIZCA @PlatformAdmin()-korumali act-as endpoint'i mintleyebilir; siradan
    // platform tokenlerinin tid'i null'dir, bu yuzden /admin gecisini elde edemez.
    const actingAsTenant = payload.plat === true && !!payload.tid;
    if (
      requireMembership &&
      !payload.mid &&
      !actingAsTenant
    ) {
      throw new ForbiddenException('aktif uyelik secimi gerekli (switch-tenant)');
    }

    // Rehydrate membership and custom-role grants on every request. This closes both
    // stale-read and stale-write windows after a membership, tenant, or role change.
    if (payload.mid) {
      const membership = await this.prisma.membership.findFirst({
        where: { id: payload.mid, userId: payload.sub, tenantId: payload.tid ?? undefined },
        select: {
          role: true,
          status: true,
          updatedAt: true,
          roleRef: { select: { permissions: true, updatedAt: true } },
          tenant: { select: { status: true } },
        },
      });
      if (!membership || membership.status !== MembershipStatus.active || membership.tenant.status !== TenantStatus.active) {
        this.logger.warn(`[security] inactive_membership user=${payload.sub} mid=${payload.mid} ${req.method} ${req.url}`);
        throw new ForbiddenException('active membership not found');
      }
      const membershipVersion = membership.updatedAt.getTime();
      const roleRefControlsPermissions = membership.role === Role.tenant_admin || membership.role === Role.tenant_staff;
      const roleVersion = roleRefControlsPermissions ? (membership.roleRef?.updatedAt.getTime() ?? null) : null;
      if (
        (payload.mver !== undefined || payload.rver !== undefined) &&
        (payload.mver !== membershipVersion || (payload.rver ?? null) !== roleVersion)
      ) {
        this.logger.warn(`[security] stale_authz_token user=${payload.sub} mid=${payload.mid} ${req.method} ${req.url}`);
      }
      payload.role = membership.role;
      payload.perms = roleRefControlsPermissions
        ? membership.roleRef?.permissions ?? defaultPermissionsForTier(membership.role)
        : defaultPermissionsForTier(membership.role);
      payload.mver = membershipVersion;
      if (roleVersion === null) delete payload.rver;
      else payload.rver = roleVersion;
    }

    if (roles?.length) {
      if (!payload.role || !roles.includes(payload.role)) {
        // Authorization denial: structured logs are enough here; DB writes in the guard would be too heavy.
        this.logger.warn(
          `[security] authz_denied user=${payload.sub} role=${payload.role} need=${roles.join('|')} ${req.method} ${req.url}`,
        );
        throw new ForbiddenException('you do not have permission for this action');
      }
    }

    if (platformOnly) {
      if (!payload.plat || !dbUser?.isPlatformAdmin) {
        this.logger.warn(`[security] platform_denied user=${payload.sub} ${req.method} ${req.url}`);
        throw new ForbiddenException('platform permission required');
      }
    } else if (payload.plat) {
      if (!dbUser?.isPlatformAdmin) {
        payload.plat = false;
      }
    }

    if (platformOnly && !payload.plat) {
      this.logger.warn(`[security] platform_denied user=${payload.sub} ${req.method} ${req.url}`);
      throw new ForbiddenException('platform permission required');
    }

    // A tenant switch can change the required role. Remove stale/legacy proof before
    // passing the guarded principal to the controller so it cannot be re-signed there.
    if (!userMfaEnabled || !this.hasCurrentMfaAssurance(payload, mfaEpoch)) {
      delete payload.mfa;
      delete payload.mfaAt;
      delete payload.mfaEpoch;
    }
    req.user = payload;

    // API keys are independently revocable integration credentials and cannot carry an
    // interactive session-assurance proof.
    if (!mfaExempt && !fromApiKey) {
      this.enforceMfa(payload, userMfaEnabled, mfaEpoch, req);
    }

    if (permission) {
      const granted = !!payload.role && GOD_TIERS.has(payload.role);
      if (!granted && !payload.perms?.includes(permission)) {
        this.logger.warn(
          `[security] perm_denied user=${payload.sub} role=${payload.role} need=${permission} ${req.method} ${req.url}`,
        );
        throw new ForbiddenException('you do not have permission for this action');
      }
    }

    return true;
  }

  private enforceMfa(
    payload: RequestUser,
    userMfaEnabled: boolean,
    mfaEpoch: number | null,
    req: Request,
  ): void {
    const required = mfaRequiredRoles();
    const roleRequiresMfa = !!payload.role && required.has(payload.role);
    const platformRequiresMfa = !!payload.plat && required.has(Role.platform_admin);
    if ((roleRequiresMfa || platformRequiresMfa) && !userMfaEnabled) {
      this.logger.warn(`[security] mfa_required user=${payload.sub} role=${payload.role} ${req.method} ${req.url}`);
      throw new ForbiddenException('2FA required for this account');
    }
    if (!(roleRequiresMfa || platformRequiresMfa)) return;

    if (!this.hasCurrentMfaAssurance(payload, mfaEpoch)) {
      this.logger.warn(`[security] mfa_session_unassured user=${payload.sub} role=${payload.role} ${req.method} ${req.url}`);
      throw new ForbiddenException('2FA verification is required for this session');
    }
  }

  private hasCurrentMfaAssurance(payload: RequestUser, mfaEpoch: number | null): boolean {
    return (
      mfaEpoch !== null &&
      payload.mfa === true &&
      typeof payload.mfaAt === 'number' &&
      typeof payload.mfaEpoch === 'number' &&
      Number.isFinite(payload.mfaAt) &&
      Number.isFinite(payload.mfaEpoch) &&
      payload.mfaAt >= payload.mfaEpoch &&
      payload.mfaEpoch === mfaEpoch
    );
  }

  private hasCurrentAuthGeneration(payload: RequestUser, authGeneration: number): boolean {
    return (
      typeof payload.authGeneration === 'number' &&
      Number.isSafeInteger(payload.authGeneration) &&
      payload.authGeneration > 0 &&
      payload.authGeneration === authGeneration
    );
  }
}
