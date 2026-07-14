import { Role } from '@prisma/client';
import { z } from 'zod';

/** JWT claims (SPEC 4.1): user_id, active_membership_id, tenant_id, role, and fine-grained permissions.
 * perms are derived from custom roles or tiers. Owner/platform tokens do not embed them;
 * the guard treats those tiers as all-permission users to keep tokens small. */
export interface AccessTokenPayload {
  sub: string;
  mid: string | null;
  tid: string | null;
  role: Role | null;
  perms?: string[];
  // Authorization freshness hints. Guard still rehydrates from DB.
  mver?: number;
  rver?: number;
  // Per-user session generation. Missing legacy credentials must fail closed.
  authGeneration?: number;
  // Present only when the refresh session completed MFA after the current enrollment epoch.
  mfa?: boolean;
  mfaAt?: number;
  mfaEpoch?: number;
  // platform owner flag; only embedded when true.
  plat?: boolean;
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

export interface LoginMfaChallenge {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
}

export type LoginResult = AuthSession | LoginMfaChallenge;

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

export const loginMfaSchema = z.object({
  challengeToken: z.string().min(16).max(256),
  code: z.string().trim().min(6).max(32),
});
export type LoginMfaInput = z.infer<typeof loginMfaSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(16).max(256).optional(),
}).default({});
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

export const mfaCodeSchema = z.object({
  code: z.string().trim().min(6).max(32),
});
export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;
