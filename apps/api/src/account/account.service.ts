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
}
