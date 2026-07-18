import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
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
import { encryptSecret, randomToken, sha256 } from '../common/crypto';
import { auditFingerprint } from '../common/audit-redaction';
import { defaultPermissionsForTier } from '../common/permissions';
import {
  createInviteConsentSnapshot,
  InviteConsentSnapshot,
  verifyStoredInviteConsentSnapshot,
} from '../invites/invite-consent';
import { MembershipsService } from '../memberships/memberships.service';
import { PrismaService } from '../prisma/prisma.service';
import { authConfig } from './auth.config';
import {
  AccessTokenPayload,
  AuthSession,
  LoginInput,
  LoginMfaChallenge,
  LoginResult,
  MembershipSummary,
  RegisterByInviteInput,
  RequestUser,
} from './auth.types';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  otpauthUrl,
  safeHashEqual,
  verifyTotp,
} from './mfa';

// argon2id parameters (OWASP recommendation).
const ARGON2_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

// Password verification still runs when the user is missing to keep timing comparable.
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hash('timing-equalizer-dummy', ARGON2_OPTS);
  return dummyHashPromise;
}

/** Malformed or legacy hashes should not throw during verify; return false instead. */
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
  roleRef?: { permissions: string[]; updatedAt: Date } | null;
};

type MfaAssurance = Pick<AccessTokenPayload, 'mfaAt' | 'mfaEpoch'> & {
  mfaAt: number;
  mfaEpoch: number;
};

type LoginMfaContext =
  | { kind: 'login' }
  | { kind: 'invite'; inviteId: string; snapshot: InviteConsentSnapshot & { tenantId: string } };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Security event: structured log plus audit trail for detection and forensics. */
  private async securityEvent(action: string, pii: { email?: string; ip?: string }, userId?: string): Promise<void> {
    const emailFingerprint = auditFingerprint(pii.email, 'email', authConfig.accessSecret());
    const ipFingerprint = auditFingerprint(pii.ip, 'ip', authConfig.accessSecret());
    const after = {
      ...(emailFingerprint ? { emailFingerprint } : {}),
      ...(ipFingerprint ? { ipFingerprint } : {}),
    };
    this.logger.warn(`[security] ${action} ${JSON.stringify(after)}`);
    await this.prisma.auditLog.create({
      data: { actorUserId: userId ?? null, action, entity: 'security', after },
    });
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly memberships: MembershipsService,
  ) {}

  /** Member registration is invite-only (SPEC 4.3). Tenant and sponsor are resolved from the invite code. */
  async registerByInvite(input: RegisterByInviteInput, meta: RequestMeta = {}): Promise<LoginResult> {
    // Lazily expire old invites outside the transaction.
    // If this happened inside the transaction, throwing would roll back the expired marker.
    const pre = await this.prisma.invite.findUnique({ where: { code: input.inviteCode } });
    if (pre && pre.status === InviteStatus.active && pre.expiresAt < new Date()) {
      await this.prisma.invite.update({ where: { id: pre.id }, data: { status: InviteStatus.expired } });
      throw new BadRequestException('invite has expired');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const initialInvite = await tx.invite.findUnique({
        where: { code: input.inviteCode },
        select: { id: true, email: true },
      });
      if (!initialInvite) {
        throw new BadRequestException('invite code is invalid');
      }

      const clientEmail = input.email?.trim().toLowerCase();
      const initialLockedEmail = initialInvite.email?.trim().toLowerCase();
      if (initialLockedEmail && clientEmail && initialLockedEmail !== clientEmail) {
        throw new BadRequestException('this invite was issued for a different email address');
      }
      const effectiveEmail = initialLockedEmail ?? clientEmail;
      if (!effectiveEmail) {
        throw new BadRequestException('email is required for an open invite');
      }

      let user = await tx.user.findUnique({ where: { email: effectiveEmail } });
      const isNewUser = !user;
      if (user) {
        // Existing global accounts cannot join a second tenant without password verification.
        const ok = await safeVerify(user.passwordHash, input.password);
        if (!ok) {
          throw new ConflictException('this email is already registered; verify with the existing account password');
        }
        await this.lockUserForAuth(tx, user.id);
        user = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        // Password resets can win the row lock after the timing-safe precheck above.
        // Revalidate the locked, current hash before any invite or MFA side effect.
        if (!(await safeVerify(user.passwordHash, input.password))) {
          throw new ConflictException('this email is already registered; verify with the existing account password');
        }
      }

      // Existing-account registration and pending MFA completion both acquire locks as
      // user -> invite. New accounts have no user row yet, so they only lock the invite.
      await this.lockInviteForAcceptance(tx, initialInvite.id);
      const invite = await tx.invite.findUnique({
        where: { id: initialInvite.id },
        include: { inviter: true, tenant: true },
      });
      if (!invite || invite.status !== InviteStatus.active) {
        throw new BadRequestException('invite code is invalid');
      }
      if (invite.expiresAt < new Date()) {
        throw new BadRequestException('invite has expired');
      }
      if (invite.tenant.status !== TenantStatus.active) {
        throw new BadRequestException('this business is not accepting registrations right now');
      }
      // Inactive inviters cannot be used for new registrations (SPEC 7 note).
      if (invite.inviter.status !== MembershipStatus.active) {
        throw new BadRequestException('the inviting membership is not active');
      }
      const authoritativeLockedEmail = invite.email?.trim().toLowerCase();
      if (authoritativeLockedEmail && clientEmail && authoritativeLockedEmail !== clientEmail) {
        throw new BadRequestException('this invite was issued for a different email address');
      }
      const authoritativeEmail = authoritativeLockedEmail ?? clientEmail;
      if (!authoritativeEmail) {
        throw new BadRequestException('email is required for an open invite');
      }
      if (authoritativeEmail !== effectiveEmail) {
        throw new BadRequestException('invite registration details changed; try again');
      }

      const acceptedAt = new Date();
      const effectivePlan = await tx.commissionPlan.findFirst({
        where: { tenantId: invite.tenantId, effectiveFrom: { lte: acceptedAt } },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: { name: true, poolRateBps: true, depth: true, effectiveFrom: true },
      });
      if (!effectivePlan) {
        throw new BadRequestException('this business has no effective commission plan');
      }
      const consent = createInviteConsentSnapshot({
        disclaimerVersion: input.disclaimerVersion,
        locale: input.disclaimerLocale,
        tenantDisplayName: invite.tenant.name,
        plan: effectivePlan,
        acceptedAt,
      });

      if (!user) {
        user = await tx.user.create({
          data: {
            email: effectiveEmail,
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
        throw new ConflictException('you already have a membership in this business');
      }

      // An existing MFA account must not consume an invite or create any membership state
      // until the challenge tied to this intent succeeds.
      if (!isNewUser && user.totpEnabledAt) {
        return {
          kind: 'mfa_challenge' as const,
          challenge: await this.createLoginMfaChallengeInTransaction(tx, user.id, {
            kind: 'invite',
            inviteId: invite.id,
            snapshot: { tenantId: invite.tenantId, ...consent },
          }),
        };
      }

      const membership = await this.memberships.createUnderWithInviteConsent(tx, {
        tenantId: invite.tenantId,
        userId: user.id,
        sponsor: invite.inviter,
        inviteId: invite.id,
        consent,
      });

      const consumed = await tx.invite.updateMany({
        where: { id: invite.id, status: InviteStatus.active, expiresAt: { gt: new Date() } },
        data: { status: InviteStatus.used, usedByMembershipId: membership.id },
      });
      if (consumed.count === 0) {
        throw new BadRequestException('invite code is invalid or expired');
      }
      await tx.user.update({ where: { id: user.id }, data: { lastMembershipId: membership.id } });
      // Notify the inviter; the member name can be hidden by tenant settings (SPEC 9).
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
            payload: { tokenCiphertext: encryptSecret(raw, authConfig.accessSecret()) },
          },
        });
      }

      const ipFingerprint = auditFingerprint(meta.ip, 'ip', authConfig.accessSecret());
      await tx.auditLog.create({
        data: {
          tenantId: invite.tenantId,
          actorUserId: user.id,
          action: 'membership.register_by_invite',
          entity: 'membership',
          entityId: membership.id,
          after: {
            sponsorMembershipId: invite.inviterMembershipId,
            inviteId: invite.id,
            ...(ipFingerprint ? { ipFingerprint } : {}),
          },
        },
      });

      // Keep issuance in this transaction. For an existing account, the user row
      // remains locked from the current-password verification through session creation.
      return {
        kind: 'session' as const,
        session: await this.issueSessionInTransaction(tx, user.id, meta, null),
      };
    });

    if (result.kind === 'mfa_challenge') return result.challenge;
    return result.session;
  }

  async login(input: LoginInput, meta: RequestMeta = {}): Promise<AuthSession | LoginMfaChallenge> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const ok = await safeVerify(user?.passwordHash ?? (await dummyHash()), input.password);
    if (!user || !ok) {
      await this.securityEvent('security.login_failed', { email: input.email, ip: meta.ip }, user?.id);
      throw new UnauthorizedException('incorrect email or password');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockUserForAuth(tx, user.id);
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (!(await safeVerify(current.passwordHash, input.password))) {
        throw new UnauthorizedException('incorrect email or password');
      }
      if (current.totpEnabledAt) {
        return this.createLoginMfaChallengeInTransaction(tx, current.id, { kind: 'login' });
      }
      return this.issueSessionInTransaction(tx, current.id, meta, null);
    });
  }

  async completeLoginMfa(challengeToken: string, code: string, meta: RequestMeta = {}): Promise<AuthSession> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const token = await tx.userToken.findUnique({
        where: { tokenHash: sha256(challengeToken) },
        include: { pendingInviteAcceptance: true },
      });
      if (!token || token.purpose !== UserTokenPurpose.login_otp || token.usedAt || token.expiresAt < new Date()) {
        throw new UnauthorizedException('2FA session is invalid or expired');
      }

      await this.lockUserForAuth(tx, token.userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
      if (token.usedAt || token.expiresAt < new Date()) {
        throw new UnauthorizedException('2FA session is invalid or expired');
      }

      const verified = await this.verifyMfaCode(user, code, true);
      if (!verified.ok) return { kind: 'failed' as const, userId: token.userId };

      const now = new Date();
      const consumed = await tx.userToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count === 0) throw new UnauthorizedException('2FA session is invalid or expired');
      if (verified.nextRecoveryHashes) {
        await tx.user.update({ where: { id: user.id }, data: { mfaRecoveryCodes: verified.nextRecoveryHashes } });
      }

      if (token.pendingInviteAcceptance) {
        await this.completePendingInviteAcceptance(tx, token.pendingInviteAcceptance.id, user, meta, now);
      }
      return { kind: 'session' as const, session: await this.issueSessionInTransaction(tx, user.id, meta, now) };
    });

    if (outcome.kind === 'failed') {
      await this.securityEvent('security.mfa_failed', { ip: meta.ip }, outcome.userId);
      throw new UnauthorizedException('2FA code is invalid');
    }
    return outcome.session;
  }

  async mfaStatus(userId: string): Promise<{ enabled: boolean; recoveryCodeCount: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpEnabledAt: true, mfaRecoveryCodes: true },
    });
    return {
      enabled: user.totpEnabledAt !== null,
      recoveryCodeCount: this.recoveryHashes(user.mfaRecoveryCodes).length,
    };
  }

  async setupMfa(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, totpEnabledAt: true },
    });
    if (user.totpEnabledAt) {
      throw new ConflictException('2FA is already enabled');
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }

  async enableMfa(userId: string, code: string): Promise<{ enabled: true; recoveryCodes: string[] }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUserForAuth(tx, userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.totpSecret) throw new BadRequestException('start 2FA setup first');
      if (!verifyTotp(user.totpSecret, code)) throw new BadRequestException('2FA code is invalid');
      const recoveryCodes = generateRecoveryCodes();
      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        data: {
          totpEnabledAt: now,
          mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
          authGeneration: { increment: 1 },
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return { enabled: true, recoveryCodes };
    });
  }

  async disableMfa(userId: string, code: string): Promise<{ enabled: false }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUserForAuth(tx, userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.totpEnabledAt) throw new BadRequestException('2FA is not enabled');
      const verified = await this.verifyMfaCode(user, code, false);
      if (!verified.ok) throw new BadRequestException('2FA code is invalid');
      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        data: {
          totpSecret: null,
          totpEnabledAt: null,
          mfaRecoveryCodes: Prisma.JsonNull,
          authGeneration: { increment: 1 },
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return { enabled: false };
    });
  }
  /** Rotating refresh: revoke the old token and issue a new one. Reuse revokes all sessions. */
  async refresh(refreshTokenRaw: string, meta: RequestMeta = {}): Promise<AuthSession> {
    const tokenHash = sha256(refreshTokenRaw);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!token) return { kind: 'invalid' as const };

      await this.lockUserForAuth(tx, token.userId);
      const user = await tx.user.findUniqueOrThrow({
        where: { id: token.userId },
        select: { authGeneration: true },
      });
      if (token.revokedAt) {
        await this.advanceAuthGenerationAndRevokeSessions(tx, token.userId, new Date());
        return { kind: 'reuse' as const, userId: token.userId };
      }
      if (token.authGeneration === null || token.authGeneration !== user.authGeneration) {
        await tx.refreshToken.updateMany({
          where: { id: token.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { kind: 'invalid' as const };
      }
      if (token.expiresAt < new Date()) return { kind: 'expired' as const };

      const newRaw = randomToken();
      const newToken = await tx.refreshToken.create({
        data: {
          userId: token.userId,
          tokenHash: sha256(newRaw),
          expiresAt: new Date(Date.now() + authConfig.refreshTtlMs),
          mfaVerifiedAt: token.mfaVerifiedAt,
          authGeneration: user.authGeneration,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      const rotated = await tx.refreshToken.updateMany({
        where: { id: token.id, revokedAt: null, authGeneration: user.authGeneration },
        data: { revokedAt: new Date(), replacedById: newToken.id },
      });
      if (rotated.count === 0) {
        throw new UnauthorizedException('refresh token has already been used');
      }
      return { kind: 'session' as const, session: await this.buildSession(tx, token.userId, newRaw, token.mfaVerifiedAt) };
    });

    if (outcome.kind === 'session') return outcome.session;
    if (outcome.kind === 'reuse') {
      await this.securityEvent('security.refresh_reuse_detected', { ip: meta.ip }, outcome.userId);
      throw new UnauthorizedException('refresh token reuse detected');
    }
    if (outcome.kind === 'expired') throw new UnauthorizedException('refresh token has expired');
    throw new UnauthorizedException('invalid refresh token');
  }

  async logout(refreshTokenRaw: string): Promise<{ ok: true }> {
    const tokenHash = sha256(refreshTokenRaw);
    await this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!token || token.revokedAt) return;
      await this.advanceAuthGenerationAndRevokeSessions(tx, token.userId, new Date());
    });
    return { ok: true };
  }

  async listSessions(userId: string) {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, expiresAt: true, ip: true, userAgent: true },
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      ip: r.ip,
      userAgent: r.userAgent,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockUserForAuth(tx, userId);
      const session = await tx.refreshToken.findFirst({ where: { id: sessionId, userId, revokedAt: null } });
      if (!session) throw new NotFoundException('session not found');
      await this.advanceAuthGenerationAndRevokeSessions(tx, userId, new Date());
    });
    return { ok: true };
  }

  async revokeAllSessions(userId: string): Promise<{ revoked: number }> {
    const revoked = await this.prisma.$transaction((tx) =>
      this.advanceAuthGenerationAndRevokeSessions(tx, userId, new Date()),
    );
    return { revoked };
  }

  /** Tenant selection for multi-membership accounts; the last selection is remembered (SPEC 4.1). */
  async switchTenant(user: RequestUser, membershipId: string): Promise<{ accessToken: string; activeMembershipId: string }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUserForAuth(tx, user.sub);
      const dbUser = await tx.user.findUniqueOrThrow({ where: { id: user.sub } });
      if (!this.hasCurrentAuthGeneration(user, dbUser.authGeneration)) {
        throw new UnauthorizedException('session is no longer active');
      }
      const membership = await tx.membership.findFirst({
        where: {
          id: membershipId,
          userId: user.sub,
          status: MembershipStatus.active,
          tenant: { status: TenantStatus.active },
        },
        include: {
          tenant: { select: { id: true, slug: true, name: true } },
          roleRef: { select: { permissions: true, updatedAt: true } },
        },
      });
      if (!membership) {
        throw new NotFoundException('membership not found or inactive');
      }
      const updatedUser = await tx.user.update({
        where: { id: user.sub },
        data: { lastMembershipId: membership.id },
      });
      const accessToken = await this.signAccess(
        updatedUser,
        membership,
        this.mfaAssuranceFromCurrentClaims(user, updatedUser),
      );
      return { accessToken, activeMembershipId: membership.id };
    });
  }

  async verifyEmail(tokenRaw: string): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      const token = await this.consumeUserTokenInTransaction(
        tx,
        sha256(tokenRaw),
        UserTokenPurpose.email_verify,
        'verification link is invalid or expired',
      );
      await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } });
    });
    return { ok: true };
  }
  /** Do not reveal whether the user exists; always return the same response. */
  async requestPasswordReset(email: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { status: MembershipStatus.active }, take: 1 } },
    });
    if (user) {
      const raw = randomToken(32);
      const recipient = user.lastMembershipId ?? user.memberships[0]?.id;
      await this.prisma.$transaction(async (tx) => {
        await this.lockUserForAuth(tx, user.id);
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
              recipientMembershipId: recipient,
              channel: NotificationChannel.email,
              template: 'password_reset',
              payload: { tokenCiphertext: encryptSecret(raw, authConfig.accessSecret()) },
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
      throw new BadRequestException('reset link is invalid or expired');
    }
    const passwordHash = await hash(newPassword, ARGON2_OPTS);
    await this.prisma.$transaction(async (tx) => {
      await this.lockUserForAuth(tx, token.userId);
      const now = new Date();
      const consumed = await tx.userToken.updateMany({
        where: { id: token.id, purpose: UserTokenPurpose.password_reset, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count === 0) throw new BadRequestException('reset link is invalid or expired');
      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash, authGeneration: { increment: 1 } },
      });
      await tx.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- internals

  private async createLoginMfaChallengeInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    context: LoginMfaContext,
  ): Promise<LoginMfaChallenge> {
    const raw = randomToken(32);
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await tx.userToken.updateMany({
      where: { userId, purpose: UserTokenPurpose.login_otp, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = await tx.userToken.create({
      data: {
        userId,
        purpose: UserTokenPurpose.login_otp,
        tokenHash: sha256(raw),
        expiresAt,
      },
    });
    if (context.kind === 'invite') {
      await tx.pendingInviteAcceptance.create({
        data: {
          userId,
          inviteId: context.inviteId,
          challengeTokenId: token.id,
          tenantId: context.snapshot.tenantId,
          disclaimerVersion: context.snapshot.disclaimerVersion,
          disclaimerLocale: context.snapshot.locale,
          disclaimerContentHash: context.snapshot.disclaimerContentHash,
          tenantDisplayName: context.snapshot.tenantDisplayName,
          programSummary: context.snapshot.programSummary,
          programSummaryHash: context.snapshot.programSummaryHash,
          consentAcceptedAt: context.snapshot.acceptedAt,
        },
      });
    }
    return { mfaRequired: true, challengeToken: raw, expiresAt: expiresAt.toISOString() };
  }

  private async completePendingInviteAcceptance(
    tx: Prisma.TransactionClient,
    pendingId: string,
    user: User,
    meta: RequestMeta,
    now: Date,
  ): Promise<void> {
    const pending = await tx.pendingInviteAcceptance.findUniqueOrThrow({ where: { id: pendingId } });
    if (pending.userId !== user.id || pending.completedAt) {
      throw new UnauthorizedException('2FA session is invalid or expired');
    }
    const pendingTenantId = pending.tenantId;
    const consent = verifyStoredInviteConsentSnapshot({
      disclaimerVersion: pending.disclaimerVersion,
      locale: pending.disclaimerLocale,
      disclaimerContentHash: pending.disclaimerContentHash,
      tenantDisplayName: pending.tenantDisplayName,
      programSummary: pending.programSummary,
      programSummaryHash: pending.programSummaryHash,
      acceptedAt: pending.consentAcceptedAt,
    });
    if (!pendingTenantId?.trim() || !consent) {
      throw new BadRequestException('invite acceptance consent is invalid; start a new invite acceptance');
    }

    await this.lockInviteForAcceptance(tx, pending.inviteId);
    const invite = await tx.invite.findUnique({
      where: { id: pending.inviteId },
      include: { inviter: true, tenant: true },
    });
    if (!invite) {
      throw new BadRequestException('invite code is invalid');
    }
    if (pendingTenantId !== invite.tenantId) {
      throw new BadRequestException('invite acceptance consent is invalid; start a new invite acceptance');
    }
    if (invite.status !== InviteStatus.active) {
      throw new BadRequestException('invite code is invalid');
    }
    if (invite.expiresAt < now) {
      throw new BadRequestException('invite has expired');
    }
    if (invite.tenant.status !== TenantStatus.active) {
      throw new BadRequestException('this business is not accepting registrations right now');
    }
    if (invite.inviter.status !== MembershipStatus.active) {
      throw new BadRequestException('the inviting membership is not active');
    }
    if (invite.email && invite.email.toLowerCase() !== user.email) {
      throw new BadRequestException('this invite was issued for a different email address');
    }

    const existing = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: invite.tenantId, userId: user.id } },
    });
    if (existing) {
      throw new ConflictException('you already have a membership in this business');
    }

    const membership = await this.memberships.createUnderWithInviteConsent(tx, {
      tenantId: invite.tenantId,
      userId: user.id,
      sponsor: invite.inviter,
      inviteId: invite.id,
      consent,
    });
    const consumed = await tx.invite.updateMany({
      where: { id: invite.id, status: InviteStatus.active, expiresAt: { gt: now } },
      data: { status: InviteStatus.used, usedByMembershipId: membership.id },
    });
    if (consumed.count === 0) {
      throw new BadRequestException('invite code is invalid or expired');
    }
    await tx.user.update({ where: { id: user.id }, data: { lastMembershipId: membership.id } });
    await tx.notification.create({
      data: {
        tenantId: invite.tenantId,
        recipientMembershipId: invite.inviterMembershipId,
        channel: NotificationChannel.push,
        template: 'team_member_joined',
        payload: invite.tenant.notifyNewMemberName ? { memberName: user.fullName } : {},
      },
    });
    const ipFingerprint = auditFingerprint(meta.ip, 'ip', authConfig.accessSecret());
    await tx.auditLog.create({
      data: {
        tenantId: invite.tenantId,
        actorUserId: user.id,
        action: 'membership.register_by_invite',
        entity: 'membership',
        entityId: membership.id,
        after: {
          sponsorMembershipId: invite.inviterMembershipId,
          inviteId: invite.id,
          ...(ipFingerprint ? { ipFingerprint } : {}),
        },
      },
    });
    await tx.pendingInviteAcceptance.update({ where: { id: pending.id }, data: { completedAt: now } });
  }

  private async lockUserForAuth(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException('user not found');
  }

  private async lockInviteForAcceptance(tx: Prisma.TransactionClient, inviteId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "invites" WHERE "id" = ${inviteId}::uuid FOR UPDATE
    `;
    if (rows.length === 0) throw new BadRequestException('invite code is invalid');
  }

  /**
   * Claims a one-time token under a row lock. The conditional update is kept even
   * after locking so expiry/replay is enforced at the state transition itself.
   */
  private async consumeUserTokenInTransaction(
    tx: Prisma.TransactionClient,
    tokenHash: string,
    purpose: UserTokenPurpose,
    invalidMessage: string,
  ): Promise<{ id: string; userId: string }> {
    const rows = await tx.$queryRaw<Array<{ id: string; userId: string }>>`
      SELECT id, user_id AS "userId"
      FROM user_tokens
      WHERE token_hash = ${tokenHash}
        AND purpose = ${purpose}::"UserTokenPurpose"
      FOR UPDATE`;
    const token = rows[0];
    if (!token) throw new BadRequestException(invalidMessage);

    const now = new Date();
    const claimed = await tx.userToken.updateMany({
      where: {
        id: token.id,
        tokenHash,
        purpose,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw new BadRequestException(invalidMessage);
    return token;
  }

  private async advanceAuthGenerationAndRevokeSessions(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ): Promise<number> {
    await this.lockUserForAuth(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { authGeneration: { increment: 1 } } });
    const revoked = await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return revoked.count;
  }

  private recoveryHashes(value: Prisma.JsonValue | null): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  }

  private async verifyMfaCode(
    user: Pick<User, 'id' | 'totpSecret' | 'mfaRecoveryCodes'>,
    code: string,
    consumeRecovery: boolean,
  ): Promise<{ ok: boolean; nextRecoveryHashes?: string[] }> {
    if (user.totpSecret && verifyTotp(user.totpSecret, code)) return { ok: true };

    const normalized = normalizeRecoveryCode(code);
    if (!normalized) return { ok: false };
    const candidate = hashRecoveryCode(normalized);
    const hashes = this.recoveryHashes(user.mfaRecoveryCodes);
    const index = hashes.findIndex((h) => safeHashEqual(h, candidate));
    if (index < 0) return { ok: false };
    if (!consumeRecovery) return { ok: true };
    return { ok: true, nextRecoveryHashes: hashes.filter((_, i) => i !== index) };
  }

  private async issueSessionInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    meta: RequestMeta,
    mfaVerifiedAt: Date | null,
  ): Promise<AuthSession> {
    await this.lockUserForAuth(tx, userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { authGeneration: true, totpEnabledAt: true },
    });
    if (user.totpEnabledAt && !mfaVerifiedAt) {
      throw new UnauthorizedException('2FA verification is required for this session');
    }
    const raw = randomToken();
    await tx.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + authConfig.refreshTtlMs),
        mfaVerifiedAt,
        authGeneration: user.authGeneration,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return this.buildSession(tx, userId, raw, mfaVerifiedAt);
  }

  private async buildSession(
    tx: Prisma.TransactionClient,
    userId: string,
    refreshTokenRaw: string,
    mfaVerifiedAt: Date | null,
  ): Promise<AuthSession> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: MembershipStatus.active, tenant: { status: TenantStatus.active } },
          include: {
            tenant: { select: { id: true, slug: true, name: true } },
            roleRef: { select: { permissions: true, updatedAt: true } },
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

    const accessToken = await this.signAccess(user, active, this.mfaAssuranceForUser(user, mfaVerifiedAt));
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

  private signAccess(
    user: Pick<User, 'id' | 'isPlatformAdmin' | 'authGeneration'>,
    membership: ActiveMembership | null,
    mfaAssurance: MfaAssurance | null = null,
  ): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      mid: membership?.id ?? null,
      tid: membership?.tenant.id ?? null,
      role: membership?.role ?? null,
      authGeneration: user.authGeneration,
    };
    if (membership) {
      payload.mver = membership.updatedAt.getTime();
      if (
        (membership.role === Role.tenant_admin || membership.role === Role.tenant_staff) &&
        membership.roleRef?.updatedAt
      ) {
        payload.rver = membership.roleRef.updatedAt.getTime();
      }
    }
    if (mfaAssurance) {
      payload.mfa = true;
      payload.mfaAt = mfaAssurance.mfaAt;
      payload.mfaEpoch = mfaAssurance.mfaEpoch;
    }
    if (user.isPlatformAdmin) payload.plat = true;
    // owner/platform -> perms are omitted; the guard treats them as all-permission tiers.
    // Other tiers receive either roleRef permissions or their default enum-tier permissions.
    const tier = membership?.role;
    if (membership && tier && tier !== Role.tenant_owner && tier !== Role.platform_admin) {
      const roleRefPerms =
        tier === Role.tenant_admin || tier === Role.tenant_staff
          ? membership.roleRef?.permissions
          : undefined;
      payload.perms = roleRefPerms ?? defaultPermissionsForTier(tier);
    }
    return this.jwt.signAsync(payload, {
      secret: authConfig.accessSecret(),
      expiresIn: authConfig.accessTtlSeconds,
    });
  }

  private mfaAssuranceForUser(
    user: Pick<User, 'totpEnabledAt'>,
    mfaVerifiedAt: Date | null,
  ): MfaAssurance | null {
    if (!user.totpEnabledAt || !mfaVerifiedAt || mfaVerifiedAt < user.totpEnabledAt) return null;
    return {
      mfaAt: mfaVerifiedAt.getTime(),
      mfaEpoch: user.totpEnabledAt.getTime(),
    };
  }

  private mfaAssuranceFromClaims(user: Pick<RequestUser, 'mfa' | 'mfaAt' | 'mfaEpoch'>): MfaAssurance | null {
    if (
      user.mfa !== true ||
      typeof user.mfaAt !== 'number' ||
      typeof user.mfaEpoch !== 'number' ||
      !Number.isFinite(user.mfaAt) ||
      !Number.isFinite(user.mfaEpoch) ||
      user.mfaAt < user.mfaEpoch
    ) {
      return null;
    }
    return { mfaAt: user.mfaAt, mfaEpoch: user.mfaEpoch };
  }

  private mfaAssuranceFromCurrentClaims(
    user: Pick<RequestUser, 'mfa' | 'mfaAt' | 'mfaEpoch'>,
    dbUser: Pick<User, 'totpEnabledAt'>,
  ): MfaAssurance | null {
    const assurance = this.mfaAssuranceFromClaims(user);
    const epoch = dbUser.totpEnabledAt?.getTime();
    if (!assurance || epoch === undefined || assurance.mfaEpoch !== epoch || assurance.mfaAt < epoch) return null;
    return assurance;
  }

  private hasCurrentAuthGeneration(user: Pick<RequestUser, 'authGeneration'>, authGeneration: number): boolean {
    return (
      typeof user.authGeneration === 'number' &&
      Number.isSafeInteger(user.authGeneration) &&
      user.authGeneration > 0 &&
      user.authGeneration === authGeneration
    );
  }
}
