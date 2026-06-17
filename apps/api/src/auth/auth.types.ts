import { Role } from '@prisma/client';
import { z } from 'zod';

/** JWT claim'leri (SPEC 4.1): user_id, active_membership_id, tenant_id, role + ince izinler.
 * perms: ozel rol/katmandan turetilen izin anahtarlari. owner/platform tokeninde GOMULMEZ —
 * guard bu katmanlari otomatik tum-izinli sayar (token boyutu kucuk kalir). */
export interface AccessTokenPayload {
  sub: string;
  mid: string | null;
  tid: string | null;
  role: Role | null;
  perms?: string[];
  // platform sahibi (kiracci-ustu) — yalnizca true iken gomulur.
  plat?: boolean;
  // oturum (cihaz) kimligi = refresh-token familyId. "aktif oturumlar"da current'i isaretler.
  sid?: string;
  // impersonation: dolu ise bu token bir admin'in (imp = admin userId) uye adina actigi
  // SALT-OKUNUR oturumdur. Guard GET disi tum istekleri reddeder.
  imp?: string;
}

export interface RequestUser extends AccessTokenPayload {
  iat: number;
  exp: number;
}

export interface MembershipSummary {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: Role;
  referralCode: string;
  depth: number;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; fullName: string; locale: string; emailVerified: boolean; isPlatformAdmin: boolean };
  activeMembershipId: string | null;
  memberships: MembershipSummary[];
}

export const registerByInviteSchema = z.object({
  inviteCode: z.string().trim().min(4).max(64),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(128),
  fullName: z.string().trim().min(2).max(120),
  locale: z.enum(['en', 'tr']).default('en'),
});
export type RegisterByInviteInput = z.infer<typeof registerByInviteSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Login 2. adim: MFA challenge token + 6 haneli TOTP veya kurtarma kodu. */
export const loginTwoFactorSchema = z.object({
  mfaToken: z.string().min(10).max(1024),
  code: z.string().trim().min(6).max(20),
});
export type LoginTwoFactorInput = z.infer<typeof loginTwoFactorSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(16).max(256),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const switchTenantSchema = z.object({
  membershipId: z.string().uuid(),
});
export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(16).max(256),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(16).max(256),
  newPassword: z.string().min(10).max(128),
});
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
