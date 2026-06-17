import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { Prisma } from '@prisma/client';
import { authenticator } from 'otplib';
import { ARGON2_OPTS } from '../auth/auth.service';
import { decryptSecret, encryptSecret, randomCode, sha256 } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordInput, Disable2faInput, Enable2faInput, UpdateProfileInput } from './account.types';

// Saat kaymasina tolerans: +-1 adim (30sn) kabul et.
authenticator.options = { window: 1 };

/** Kurtarma kodu: okunabilir, tek-kullanimlik. Saklamada sha256(hash) — kod yuksek-entropili. */
function newRecoveryCode(): string {
  const c = randomCode(10).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10).padEnd(10, '0');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

/** userAgent -> okunabilir cihaz etiketi ("Chrome on Windows"). Harici dep yok, kaba ama yeterli. */
function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}

/**
 * Kullanici KENDI hesabi (membership-bagimsiz). Authenticated; admin'in baska uyeyi
 * duzenledigi members.admin.updateProfile'dan AYRI — burada principal yalniz kendini gunceller.
 */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, fullName: true, locale: true, avatarPath: true,
        emailVerifiedAt: true, totpEnabledAt: true, createdAt: true,
      },
    });
    if (!u) {
      throw new NotFoundException('kullanici bulunamadi');
    }
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      locale: u.locale,
      avatarPath: u.avatarPath,
      emailVerified: !!u.emailVerifiedAt,
      twoFactorEnabled: !!u.totpEnabledAt,
      createdAt: u.createdAt,
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    const data: { fullName?: string; locale?: string } = {};
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.locale !== undefined) data.locale = input.locale;
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.me(userId);
  }

  async changePassword(userId: string, input: ChangePasswordInput) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!u) {
      throw new NotFoundException('kullanici bulunamadi');
    }
    const ok = await verify(u.passwordHash, input.currentPassword).catch(() => false);
    if (!ok) {
      throw new BadRequestException('mevcut sifre yanlis');
    }
    if (input.newPassword === input.currentPassword) {
      throw new BadRequestException('yeni sifre eskisinden farkli olmali');
    }
    const passwordHash = await hash(input.newPassword, ARGON2_OPTS);
    // password-reset/confirm ile AYNI guvenlik kalibi: sifre degisince TUM refresh token'lari iptal et
    // (diger cihazlar/oturumlar yeniden giris yapmali). Mevcut oturum access-token TTL'i kadar surer.
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { changed: true };
  }

  /**
   * 2FA kurulumu baslat: yeni TOTP secret uret, SIFRELI sakla (henuz etkin DEGIL — enable'da
   * dogrulanir). otpauth URL + base32 secret doner (QR + manuel giris icin).
   */
  async setup2fa(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, totpEnabledAt: true } });
    if (!u) {
      throw new NotFoundException('kullanici bulunamadi');
    }
    if (u.totpEnabledAt) {
      throw new BadRequestException('2fa zaten etkin');
    }
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: encryptSecret(secret), totpEnabledAt: null } });
    return { otpauthUrl: authenticator.keyuri(u.email, 'Refearn', secret), secret };
  }

  /**
   * 2FA etkinlestir: bekleyen secret'a karsi kodu dogrula; gecerse totpEnabledAt set edilir ve
   * kurtarma kodlari (10 adet) uretilir. Plaintext kodlar YALNIZ burada bir kez doner.
   */
  async enable2fa(userId: string, input: Enable2faInput) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpEnabledAt: true } });
    if (!u || !u.totpSecret) {
      throw new BadRequestException('once 2fa kurulumunu baslatin');
    }
    if (u.totpEnabledAt) {
      throw new BadRequestException('2fa zaten etkin');
    }
    const secret = decryptSecret(u.totpSecret);
    if (!authenticator.verify({ token: input.code.replace(/\s/g, ''), secret })) {
      throw new BadRequestException('dogrulama kodu hatali');
    }
    const recoveryCodes = Array.from({ length: 10 }, () => newRecoveryCode());
    // normalize: dash'siz + uppercase sakla (login dogrulamasi ayni normalize'i yapar -> kullanici dash'li/dash'siz girebilir)
    const hashes = recoveryCodes.map((c) => sha256(c.replace(/-/g, '').toUpperCase()));
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date(), mfaRecoveryCodes: hashes } });
    return { enabled: true, recoveryCodes };
  }

  /** 2FA kapat: guvenlik icin mevcut sifre dogrulanir; secret + recovery kodlari silinir. */
  async disable2fa(userId: string, input: Disable2faInput) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, totpEnabledAt: true } });
    if (!u) {
      throw new NotFoundException('kullanici bulunamadi');
    }
    if (!u.totpEnabledAt) {
      throw new BadRequestException('2fa etkin degil');
    }
    const ok = await verify(u.passwordHash, input.password).catch(() => false);
    if (!ok) {
      throw new BadRequestException('sifre yanlis');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null, mfaRecoveryCodes: Prisma.DbNull } });
    return { disabled: true };
  }

  // ---- Aktif oturumlar (cihazlar) ----

  /** Kullanicinin aktif oturumlari (familyId basina tek). currentSid = bu access token'in sid'i. */
  async listSessions(userId: string, currentSid?: string) {
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, familyId: true, ip: true, userAgent: true, createdAt: true },
    });
    // familyId basina TEK oturum (en yeni token = rotasyon ucu). familyId yoksa (migration oncesi) id'yi family say.
    const byFamily = new Map<string, (typeof tokens)[number]>();
    for (const t of tokens) {
      const fam = t.familyId ?? t.id;
      if (!byFamily.has(fam)) byFamily.set(fam, t); // tokens createdAt desc -> ilk gorulen = en yeni
    }
    const sessions = [...byFamily.entries()].map(([fam, t]) => ({
      id: fam,
      device: deviceLabel(t.userAgent),
      ip: t.ip,
      lastActive: t.createdAt, // refresh her ~15dk rotates -> son token ~ son aktivite
      current: !!currentSid && fam === currentSid,
    }));
    sessions.sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || (b.lastActive > a.lastActive ? 1 : -1));
    return { sessions };
  }

  /** Tek oturumu kapat: o family'nin (ya da migration-oncesi id eslesen) tum token'larini iptal et. */
  async revokeSession(userId: string, familyId: string) {
    const res = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, OR: [{ familyId }, { id: familyId }] },
      data: { revokedAt: new Date() },
    });
    return { revoked: res.count };
  }

  /** "Diger tum cihazlardan cik": mevcut oturum (sid) HARIC tum aktif token'lari iptal et. */
  async revokeOtherSessions(userId: string, currentSid?: string) {
    const where: Prisma.RefreshTokenWhereInput = { userId, revokedAt: null };
    // currentSid disindaki HER SEYI iptal et — NULL familyId (migration-oncesi) DAHIL.
    // (SQL'de family_id <> sid NULL'lari disladigi icin acik OR ile NULL'lari da kapsa.)
    if (currentSid) where.OR = [{ familyId: { not: currentSid } }, { familyId: null }];
    const res = await this.prisma.refreshToken.updateMany({ where, data: { revokedAt: new Date() } });
    return { revoked: res.count };
  }
}
