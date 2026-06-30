import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { authenticator } from 'otplib';
import {
  InviteStatus,
  Membership,
  MembershipStatus,
  NotificationChannel,
  Prisma,
  Role,
  TenantStatus,
  User,
  UserTokenPurpose,
} from '@prisma/client';
import { decryptSecret, randomToken, sha256 } from '../common/crypto';
import { defaultPermissionsForTier } from '../common/permissions';
import { MembershipsService } from '../memberships/memberships.service';
import { PrismaService } from '../prisma/prisma.service';
import { authConfig } from './auth.config';
import {
  AccessTokenPayload,
  AuthSession,
  LoginInput,
  MembershipSummary,
  RegisterByInviteInput,
} from './auth.types';

// argon2id parametreleri (OWASP onerisi)
export const ARGON2_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

// Kayit disclaimer'inin surumu — FE'deki metin degisirse artir; hangi metnin kabul edildigini izler.
export const DISCLAIMER_VERSION = 'v1';

// 2FA: TOTP saat kaymasi toleransi (+-1 adim) + login 2. adim challenge token omru (5 dk)
authenticator.options = { window: 1 };
const MFA_CHALLENGE_TTL_SECONDS = 300;

/** Login 2FA istiyorsa donen yanit (tam oturum YERINE). */
export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
}

// Kullanici yokken de sifre dogrulamasi kosulur (timing esitligi icin)
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hash('timing-equalizer-dummy', ARGON2_OPTS);
  return dummyHashPromise;
}

/** Bozuk/eski formatli hash'te verify firlatmasin — false donsun. */
async function safeVerify(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

type ActiveMembership = Membership & {
  tenant: { id: string; slug: string; name: string };
  roleRef?: { permissions: string[] } | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Guvenlik olayi: structured log + audit (tespit/forensics icin). */
  private async securityEvent(action: string, payload: object, userId?: string): Promise<void> {
    this.logger.warn(`[security] ${action} ${JSON.stringify(payload)}`);
    await this.prisma.auditLog.create({
      data: { actorUserId: userId ?? null, action, entity: 'security', after: payload },
    });
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly memberships: MembershipsService,
  ) {}

  /** Uye kaydi YALNIZCA davetle (SPEC 4.3). Tenant+sponsor davet kodundan cozulur. */
  async registerByInvite(input: RegisterByInviteInput, meta: RequestMeta = {}): Promise<AuthSession> {
    // Suresi dolmus daveti transaction DISINDA tembel temizle: transaction icinde
    // isaretleyip throw edersek rollback isaretlemeyi de geri alirdi.
    const pre = await this.prisma.invite.findUnique({ where: { code: input.inviteCode } });
    if (pre && pre.status === InviteStatus.active && pre.expiresAt < new Date()) {
      await this.prisma.invite.update({ where: { id: pre.id }, data: { status: InviteStatus.expired } });
      throw new BadRequestException('davetin suresi dolmus');
    }

    const userId = await this.prisma.$transaction(async (tx) => {
      const invite = await tx.invite.findUnique({
        where: { code: input.inviteCode },
        include: { inviter: true, tenant: true },
      });
      if (!invite || invite.status !== InviteStatus.active) {
        throw new BadRequestException('davet kodu gecersiz');
      }
      if (invite.expiresAt < new Date()) {
        throw new BadRequestException('davetin suresi dolmus');
      }
      if (invite.tenant.status !== TenantStatus.active) {
        throw new BadRequestException('bu isletme su an kayit kabul etmiyor');
      }
      // pasiflik yeni daveti kisitlar (SPEC 7 notu)
      if (invite.inviter.status !== MembershipStatus.active) {
        throw new BadRequestException('davet eden uyelik aktif degil');
      }
      if (invite.email && invite.email.toLowerCase() !== input.email) {
        throw new BadRequestException('davet baska bir e-posta adresine kesilmis');
      }

      let user = await tx.user.findUnique({ where: { email: input.email } });
      const isNewUser = !user;
      if (user) {
        // mevcut global hesap: sifre dogrulamadan ikinci tenanta uyelik ACILMAZ
        const ok = await safeVerify(user.passwordHash, input.password);
        if (!ok) {
          throw new ConflictException('bu e-posta kayitli; mevcut hesabin sifresiyle dogrulayin');
        }
      } else {
        user = await tx.user.create({
          data: {
            email: input.email,
            passwordHash: await hash(input.password, ARGON2_OPTS),
            fullName: input.fullName,
            locale: input.locale,
          },
        });
      }

      const existing = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: invite.tenantId, userId: user.id } },
      });
      if (existing) {
        throw new ConflictException('bu isletmede zaten uyeliginiz var');
      }

      const membership = await this.memberships.createUnder(tx, {
        tenantId: invite.tenantId,
        userId: user.id,
        sponsor: invite.inviter,
      });
      // sybil sinyali (#16): kayit IP'si + Faz A1 disclaimer onayi (zod true zorunlu kildi).
      await tx.membership.update({
        where: { id: membership.id },
        data: {
          ...(meta.ip ? { signupIp: meta.ip } : {}),
          disclaimerAcceptedAt: new Date(),
          disclaimerVersion: DISCLAIMER_VERSION,
        },
      });

      await tx.invite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.used, usedByMembershipId: membership.id },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastMembershipId: membership.id } });

      // davet edene "ekibine katilim" bildirimi — isim tenant ayariyla gizlenebilir (SPEC 9)
      await tx.notification.create({
        data: {
          tenantId: invite.tenantId,
          recipientMembershipId: invite.inviterMembershipId,
          channel: NotificationChannel.push,
          template: 'team_member_joined',
          payload: invite.tenant.notifyNewMemberName ? { memberName: user.fullName } : {},
        },
      });

      if (isNewUser) {
        const raw = randomToken(32);
        await tx.userToken.create({
          data: {
            userId: user.id,
            purpose: UserTokenPurpose.email_verify,
            tokenHash: sha256(raw),
            expiresAt: new Date(Date.now() + authConfig.emailTokenTtlMs),
          },
        });
        await tx.notification.create({
          data: {
            tenantId: invite.tenantId,
            recipientMembershipId: membership.id,
            channel: NotificationChannel.email,
            template: 'verify_email',
            payload: { token: raw },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: invite.tenantId,
          actorUserId: user.id,
          action: 'membership.register_by_invite',
          entity: 'membership',
          entityId: membership.id,
          after: { sponsorMembershipId: invite.inviterMembershipId, inviteId: invite.id },
          ip: meta.ip,
        },
      });

      return user.id;
    });

    return this.issueSession(userId, meta);
  }

  async login(input: LoginInput, meta: RequestMeta = {}): Promise<AuthSession | MfaChallenge> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const ok = await safeVerify(user?.passwordHash ?? (await dummyHash()), input.password);
    if (!user || !ok) {
      await this.securityEvent('security.login_failed', { email: input.email, ip: meta.ip }, user?.id);
      throw new UnauthorizedException('e-posta veya sifre hatali');
    }
    // 2FA etkinse: tam oturum yerine kisa-omurlu MFA challenge token'i don. Bu token AYRI
    // secret ile imzalidir -> AccessTokenGuard (accessSecret) onu gecerli access-token SAYMAZ.
    if (user.totpEnabledAt) {
      const mfaToken = await this.jwt.signAsync(
        { sub: user.id, mfa: true },
        { secret: this.mfaSecret(), expiresIn: MFA_CHALLENGE_TTL_SECONDS },
      );
      return { mfaRequired: true, mfaToken };
    }
    return this.issueSession(user.id, meta);
  }

  /** Login 2. adim: MFA challenge token + (6 haneli TOTP | kurtarma kodu) -> tam oturum. */
  async loginTwoFactor(mfaToken: string, code: string, meta: RequestMeta = {}): Promise<AuthSession> {
    let claims: { sub?: string; mfa?: boolean };
    try {
      claims = await this.jwt.verifyAsync(mfaToken, { secret: this.mfaSecret() });
    } catch {
      throw new UnauthorizedException('2fa oturumu suresi doldu, tekrar giris yapin');
    }
    if (!claims?.mfa || !claims.sub) {
      throw new UnauthorizedException('gecersiz 2fa oturumu');
    }
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || !user.totpEnabledAt || !user.totpSecret) {
      throw new UnauthorizedException('2fa etkin degil');
    }
    if (!(await this.verifyTotpOrRecovery(user, code))) {
      await this.securityEvent('security.login_2fa_failed', { ip: meta.ip }, user.id);
      throw new UnauthorizedException('dogrulama kodu hatali');
    }
    return this.issueSession(user.id, meta);
  }

  /** access secret'tan TUREYEN ayri anahtar: guard bu token'i access-token saymaz (2FA-oncesi sizma onlenir). */
  private mfaSecret(): string {
    return authConfig.accessSecret() + ':mfa-challenge';
  }

  /** 6 haneli TOTP VEYA tek-kullanimlik kurtarma kodu dogrula (recovery eslesirse TUKETILIR). */
  private async verifyTotpOrRecovery(
    user: { id: string; totpSecret: string | null; mfaRecoveryCodes: Prisma.JsonValue },
    code: string,
  ): Promise<boolean> {
    const clean = code.replace(/\s/g, '');
    if (/^\d{6}$/.test(clean) && user.totpSecret) {
      const secret = decryptSecret(user.totpSecret);
      if (authenticator.verify({ token: clean, secret })) return true;
    }
    // kurtarma kodu: dash/uppercase normalize edilip sha256 — enable2fa ile AYNI kalip
    const codes = Array.isArray(user.mfaRecoveryCodes) ? (user.mfaRecoveryCodes as string[]) : [];
    const h = sha256(clean.replace(/-/g, '').toUpperCase());
    const idx = codes.indexOf(h);
    if (idx >= 0) {
      const remaining = codes.filter((_, i) => i !== idx);
      await this.prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryCodes: remaining } });
      return true;
    }
    return false;
  }

  /** Rotasyonlu refresh: eski token iptal, yenisi verilir. Reuse → tum oturumlar kapanir. */
  async refresh(refreshTokenRaw: string, meta: RequestMeta = {}): Promise<AuthSession> {
    const tokenHash = sha256(refreshTokenRaw);
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!token) {
      throw new UnauthorizedException('gecersiz refresh token');
    }
    if (token.revokedAt) {
      // calinti/yeniden kullanim isareti: kullanicinin TUM aktif refresh token'lari iptal
      await this.prisma.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // kritik guvenlik olayi: tespit/forensics icin logla + audit'le
      await this.securityEvent('security.refresh_reuse_detected', { ip: meta.ip }, token.userId);
      throw new UnauthorizedException('refresh token yeniden kullanimi tespit edildi');
    }
    if (token.expiresAt < new Date()) {
      throw new UnauthorizedException('refresh token suresi dolmus');
    }

    const familyId = token.familyId ?? randomUUID(); // ayni oturum (cihaz) — eski token'da yoksa (migration oncesi) yeni ata
    return this.prisma.$transaction(async (tx) => {
      const newRaw = randomToken();
      const newToken = await tx.refreshToken.create({
        data: {
          userId: token.userId,
          tokenHash: sha256(newRaw),
          familyId,
          expiresAt: new Date(Date.now() + authConfig.refreshTtlMs),
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      // atomik rotasyon: yarisi kaybeden istek 401 alir
      const rotated = await tx.refreshToken.updateMany({
        where: { id: token.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: newToken.id },
      });
      if (rotated.count === 0) {
        throw new UnauthorizedException('refresh token zaten kullanilmis');
      }
      return this.buildSession(tx, token.userId, newRaw, familyId);
    });
  }

  async logout(refreshTokenRaw: string): Promise<{ ok: true }> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshTokenRaw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  /** Coklu uyelikte tenant secimi; "son secim hatirlanir" (SPEC 4.1). */
  async switchTenant(userId: string, membershipId: string, sid?: string): Promise<{ accessToken: string; activeMembershipId: string }> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        userId,
        status: MembershipStatus.active,
        tenant: { status: TenantStatus.active },
      },
      include: {
        tenant: { select: { id: true, slug: true, name: true } },
        roleRef: { select: { permissions: true } },
      },
    });
    if (!membership) {
      throw new NotFoundException('uyelik bulunamadi veya aktif degil');
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { lastMembershipId: membership.id },
    });
    const accessToken = await this.signAccess(user, membership, sid);
    return { accessToken, activeMembershipId: membership.id };
  }

  /** Platform admin "act-as": bir sirket icin tenant-scoped owner token uretir (plat:true korunur). */
  async actAsTenant(userId: string, tenantId: string): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, isPlatformAdmin: true }, select: { id: true, isPlatformAdmin: true } });
    if (!user) throw new ForbiddenException('platform yetkisi gerekli');
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, status: TenantStatus.active }, select: { id: true } });
    if (!tenant) throw new NotFoundException('sirket bulunamadi veya aktif degil');
    const payload: AccessTokenPayload = { sub: user.id, mid: null, tid: tenant.id, role: Role.tenant_owner, plat: true };
    const accessToken = await this.jwt.signAsync(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
    return { accessToken };
  }

  async verifyEmail(tokenRaw: string): Promise<{ ok: true }> {
    const token = await this.prisma.userToken.findUnique({ where: { tokenHash: sha256(tokenRaw) } });
    if (!token || token.purpose !== UserTokenPurpose.email_verify || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('dogrulama linki gecersiz veya suresi dolmus');
    }
    await this.prisma.$transaction([
      this.prisma.userToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
    return { ok: true };
  }

  /** Kullanici var/yok bilgisi sizdirilmaz: her durumda ayni cevap. */
  async requestPasswordReset(email: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { status: MembershipStatus.active }, take: 1 } },
    });
    if (user) {
      const raw = randomToken(32);
      const recipient = user.lastMembershipId ?? user.memberships[0]?.id;
      // Bildirim hangi uyelige gidiyorsa o uyeligin tenant'ina ait olmali. lastMembershipId
      // include edilen (aktif, take:1) listede olmayabilir; tenantId'yi dogrudan cozeriz.
      const recipientTenantId = recipient
        ? (
            await this.prisma.membership.findUnique({
              where: { id: recipient },
              select: { tenantId: true },
            })
          )?.tenantId ?? null
        : null;
      await this.prisma.$transaction(async (tx) => {
        await tx.userToken.updateMany({
          where: { userId: user.id, purpose: UserTokenPurpose.password_reset, usedAt: null },
          data: { usedAt: new Date() }, // onceki istekler gecersizlesir
        });
        await tx.userToken.create({
          data: {
            userId: user.id,
            purpose: UserTokenPurpose.password_reset,
            tokenHash: sha256(raw),
            expiresAt: new Date(Date.now() + authConfig.passwordResetTtlMs),
          },
        });
        if (recipient) {
          await tx.notification.create({
            data: {
              tenantId: recipientTenantId,
              recipientMembershipId: recipient,
              channel: NotificationChannel.email,
              template: 'password_reset',
              payload: { token: raw },
            },
          });
        }
      });
    }
    return { ok: true };
  }

  async confirmPasswordReset(tokenRaw: string, newPassword: string): Promise<{ ok: true }> {
    const token = await this.prisma.userToken.findUnique({ where: { tokenHash: sha256(tokenRaw) } });
    if (!token || token.purpose !== UserTokenPurpose.password_reset || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('sifirlama linki gecersiz veya suresi dolmus');
    }
    const passwordHash = await hash(newPassword, ARGON2_OPTS);
    await this.prisma.$transaction([
      this.prisma.userToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: token.userId }, data: { passwordHash } }),
      // guvenlik: sifre degisince tum oturumlar kapanir
      this.prisma.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- internals

  private async issueSession(userId: string, meta: RequestMeta): Promise<AuthSession> {
    const raw = randomToken();
    const familyId = randomUUID(); // yeni oturum (cihaz) — rotasyon boyunca sabit kalir
    return this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.create({
        data: {
          userId,
          tokenHash: sha256(raw),
          familyId,
          expiresAt: new Date(Date.now() + authConfig.refreshTtlMs),
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      return this.buildSession(tx, userId, raw, familyId);
    });
  }

  private async buildSession(
    tx: Prisma.TransactionClient,
    userId: string,
    refreshTokenRaw: string,
    familyId: string,
  ): Promise<AuthSession> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: MembershipStatus.active, tenant: { status: TenantStatus.active } },
          include: {
            tenant: { select: { id: true, slug: true, name: true } },
            roleRef: { select: { permissions: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    const list = user.memberships;
    let active: ActiveMembership | null = list.find((m) => m.id === user.lastMembershipId) ?? null;
    if (!active && list.length === 1) {
      active = list[0];
      await tx.user.update({ where: { id: user.id }, data: { lastMembershipId: active.id } });
    }

    const accessToken = await this.signAccess(user, active, familyId);
    const memberships: MembershipSummary[] = list.map((m) => ({
      id: m.id,
      tenantId: m.tenant.id,
      tenantSlug: m.tenant.slug,
      tenantName: m.tenant.name,
      role: m.role,
      referralCode: m.referralCode,
      depth: m.depth,
    }));

    return {
      accessToken,
      refreshToken: refreshTokenRaw,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        locale: user.locale,
        emailVerified: user.emailVerifiedAt !== null,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      activeMembershipId: active?.id ?? null,
      memberships,
    };
  }

  private signAccess(user: Pick<User, 'id' | 'isPlatformAdmin'>, membership: ActiveMembership | null, familyId?: string): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      mid: membership?.id ?? null,
      tid: membership?.tenant.id ?? null,
      role: membership?.role ?? null,
    };
    if (familyId) payload.sid = familyId; // oturum (cihaz) kimligi — switchTenant'ta mevcut sid korunur
    if (user.isPlatformAdmin) payload.plat = true;
    // owner/platform → perms gomulmez (guard tum-izinli sayar). Diger katmanlarda
    // ozel rolun izinleri, yoksa enum katmaninin varsayilanlari token'a yazilir.
    const tier = membership?.role;
    if (membership && tier && tier !== Role.tenant_owner && tier !== Role.platform_admin) {
      payload.perms = membership.roleRef?.permissions ?? defaultPermissionsForTier(tier);
    }
    return this.jwt.signAsync(payload, {
      secret: authConfig.accessSecret(),
      expiresIn: authConfig.accessTtlSeconds,
    });
  }
}
