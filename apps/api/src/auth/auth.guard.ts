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
import { sha256 } from '../common/crypto';
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
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

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

    // Act-as istisna: platform admin bir sirket adina davranirken (plat && tid) uyeligi (mid) yoktur.
    // Boyle bir token YALNIZCA @PlatformAdmin()-korumali act-as endpoint'i mintleyebilir; siradan
    // platform tokenlerinin tid'i null'dir, bu yuzden /admin gecisini elde edemez.
    const actingAsTenant = payload.plat === true && !!payload.tid;
    if (
      this.reflector.getAllAndOverride<boolean>(REQUIRE_MEMBERSHIP_KEY, targets) &&
      !payload.mid &&
      !actingAsTenant
    ) {
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
