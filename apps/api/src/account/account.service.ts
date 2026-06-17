import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { ARGON2_OPTS } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordInput, UpdateProfileInput } from './account.types';

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
}
