import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InviteStatus, MembershipStatus, Prisma, Role, TenantStatus, UserTokenPurpose } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AuthService } from '../src/auth/auth.service';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { totpCode } from '../src/auth/mfa';
import { decryptSecret, sha256 } from '../src/common/crypto';
import { defaultPermissionsForTier } from '../src/common/permissions';
import { createInviteConsentSnapshot, INVITE_DISCLAIMER_REGISTRY } from '../src/invites/invite-consent';
import { MembershipsService } from '../src/memberships/memberships.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

/**
 * Auth and invitation flow (SPEC 4 / 13-4) - HTTP-level tests against real Postgres.
 */
describe('auth + invitation flow (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let authService: AuthService;
  let membershipService: MembershipsService;

  const PASSWORD = 'Very-Secret-Password-42!';
  const INVITE_DISCLAIMER_VERSION = '2026-07-16';
  const BROWSER_ORIGIN = 'http://localhost:3000';
  const REFRESH_COOKIE_NAME = 'refearn_refresh';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    authService = moduleRef.get(AuthService);
    membershipService = moduleRef.get(MembershipsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** Test fixture: tenant + plan + root member + one invite from the root member. */
  async function setupTenantWithInvite() {
    const tenant = await createTenant(prisma);
    const plan = await createPlan(prisma, tenant.id);
    const [root] = await createChain(prisma, tenant.id, 1);
    const invite = await prisma.invite.create({
      data: {
        tenantId: tenant.id,
        inviterMembershipId: root.id,
        code: `INV${Date.now()}${Math.floor(Math.random() * 1000)}`,
        expiresAt: new Date(Date.now() + authConfig.inviteTtlMs),
      },
    });
    return { tenant, plan, root, invite };
  }

  function registerBody(invite: { code: string }, email = 'new@member.test') {
    return {
      inviteCode: invite.code,
      email,
      password: PASSWORD,
      fullName: 'New Member',
      acceptDisclaimer: true,
      disclaimerVersion: INVITE_DISCLAIMER_VERSION,
      disclaimerLocale: 'en',
    };
  }

  function accessToken(payload: AccessTokenPayload): string {
    return jwt.sign({ ...payload, authGeneration: payload.authGeneration ?? 1 }, {
      secret: authConfig.accessSecret(),
      expiresIn: authConfig.accessTtlSeconds,
    });
  }

  function refreshCookieHeader(response: { headers: Record<string, string | string[] | undefined> }): string {
    const setCookie = response.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const refreshCookie = cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(refreshCookie).toEqual(expect.any(String));
    return refreshCookie!.split(';', 1)[0];
  }

  function expectBrowserRefreshCookie(
    response: { headers: Record<string, string | string[] | undefined> },
    secure = false,
  ): string {
    const setCookie = response.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const refreshCookie = cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(refreshCookie).toEqual(expect.any(String));
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('Path=/v1/auth');
    expect(refreshCookie).toContain('SameSite=Lax');
    expect(refreshCookie).toContain(`Max-Age=${authConfig.refreshTtlMs / 1000}`);
    if (secure) expect(refreshCookie).toContain('Secure');
    else expect(refreshCookie).not.toContain('Secure');
    return refreshCookie!.split(';', 1)[0];
  }

  it('public invite resolution exposes only the explicit valid contract', async () => {
    const { tenant, invite, plan } = await setupTenantWithInvite();
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        name: 'Americana Demo',
        branding: {
          logoText: 'AD',
          logoUrl: 'https://cdn.example.test/americana-demo.svg',
          tagline: 'Earn with verified product referrals.',
          primaryColor: '#123456',
          accentColor: '#abcdef',
        },
      },
    });
    await prisma.invite.update({ where: { id: invite.id }, data: { email: 'alice@example.com' } });

    const expectedConsent = createInviteConsentSnapshot({
      disclaimerVersion: INVITE_DISCLAIMER_VERSION,
      locale: 'en',
      tenantDisplayName: 'Americana Demo',
      plan,
      acceptedAt: new Date(),
    });

    const res = await request(app.getHttpServer()).get(`/v1/invites/${invite.code}`).expect(200);
    expect(res.body).toEqual({
      state: 'valid',
      tenant: {
        displayName: 'Americana Demo',
      },
      lockedEmailHint: 'a***@e***.com',
      programSummary: expectedConsent.programSummary,
      disclaimer: {
        version: INVITE_DISCLAIMER_VERSION,
        locale: 'en',
        body: INVITE_DISCLAIMER_REGISTRY[INVITE_DISCLAIMER_VERSION].en,
      },
      expiresAt: invite.expiresAt.toISOString(),
    });
    expect(JSON.stringify(res.body)).not.toContain(invite.code);
    expect(JSON.stringify(res.body)).not.toContain('alice@example.com');
    expect(res.body.tenant).toEqual({ displayName: 'Americana Demo' });
    expect(res.body.tenant).not.toHaveProperty('logoUrl');
    expect(res.body).not.toHaveProperty('inviter');
    expect(res.body).not.toHaveProperty('tenant.slug');
    expect(res.body).not.toHaveProperty('brand');
    expect(res.body).not.toHaveProperty('emailLocked');
  });

  it('public invite resolution uses the deterministic effective-plan tie-break', async () => {
    const { tenant, plan: firstPlan, invite } = await setupTenantWithInvite();
    const secondPlan = await createPlan(prisma, tenant.id);
    const winner = firstPlan.id > secondPlan.id ? firstPlan : secondPlan;
    const loser = firstPlan.id > secondPlan.id ? secondPlan : firstPlan;
    const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');
    const createdAt = new Date('2026-01-02T00:00:00.000Z');

    await prisma.$transaction([
      prisma.tenant.update({ where: { id: tenant.id }, data: { name: 'Public Tie Tenant' } }),
      prisma.commissionPlan.update({
        where: { id: winner.id },
        data: { name: 'Public UUID Winner', poolRateBps: 1750, depth: 4, effectiveFrom, createdAt },
      }),
      prisma.commissionPlan.update({
        where: { id: loser.id },
        data: { name: 'Public UUID Loser', poolRateBps: 1000, depth: 1, effectiveFrom, createdAt },
      }),
    ]);

    const res = await request(app.getHttpServer()).get(`/v1/invites/${invite.code}`).expect(200);
    const expected = createInviteConsentSnapshot({
      disclaimerVersion: INVITE_DISCLAIMER_VERSION,
      locale: 'en',
      tenantDisplayName: 'Public Tie Tenant',
      plan: { name: 'Public UUID Winner', poolRateBps: 1750, depth: 4, effectiveFrom },
      acceptedAt: new Date(),
    });
    expect(res.body).toMatchObject({ state: 'valid', programSummary: expected.programSummary });
    expect(res.body.programSummary).not.toContain('Public UUID Loser');
  });

  it('public invite resolution returns privacy-minimal explicit non-valid states', async () => {
    const expired = await setupTenantWithInvite();
    await prisma.invite.update({ where: { id: expired.invite.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });

    const explicitlyExpired = await setupTenantWithInvite();
    await prisma.invite.update({
      where: { id: explicitlyExpired.invite.id },
      data: { status: InviteStatus.expired },
    });

    const revoked = await setupTenantWithInvite();
    await prisma.invite.update({ where: { id: revoked.invite.id }, data: { status: InviteStatus.revoked } });

    const used = await setupTenantWithInvite();
    await prisma.invite.update({
      where: { id: used.invite.id },
      data: { status: InviteStatus.used, usedByMembershipId: used.root.id },
    });
    await prisma.tenant.update({ where: { id: used.tenant.id }, data: { status: TenantStatus.suspended } });

    const suspended = await setupTenantWithInvite();
    await prisma.tenant.update({ where: { id: suspended.tenant.id }, data: { status: TenantStatus.suspended } });

    const inactiveInviter = await setupTenantWithInvite();
    await prisma.membership.update({
      where: { id: inactiveInviter.root.id },
      data: { status: MembershipStatus.inactive },
    });

    const noPlan = await setupTenantWithInvite();
    await prisma.commissionPlan.update({
      where: { id: noPlan.plan.id },
      data: { effectiveFrom: new Date(Date.now() + 60_000) },
    });

    const cases = [
      { code: 'NO_SUCH_INVITE_CODE', state: 'invalid' },
      { code: expired.invite.code, state: 'expired' },
      { code: explicitlyExpired.invite.code, state: 'expired' },
      { code: revoked.invite.code, state: 'revoked' },
      { code: used.invite.code, state: 'used' },
      { code: suspended.invite.code, state: 'tenant-suspended' },
      { code: inactiveInviter.invite.code, state: 'invalid' },
      { code: noPlan.invite.code, state: 'invalid' },
    ] as const;

    for (const testCase of cases) {
      const res = await request(app.getHttpServer()).get(`/v1/invites/${testCase.code}`).expect(200);
      expect(res.body).toEqual({ state: testCase.state });
      expect(res.body).not.toHaveProperty('continuation');
      expect(JSON.stringify(res.body)).not.toContain(testCase.code);
    }
  });

  it('separates private same-user invite continuation from the public used state', async () => {
    const first = await setupTenantWithInvite();
    const registered = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(first.invite))
      .expect(201);

    const publicUsed = await request(app.getHttpServer()).get(`/v1/invites/${first.invite.code}`).expect(200);
    expect(publicUsed.body).toEqual({ state: 'used' });
    expect(publicUsed.body).not.toHaveProperty('continuation');

    await request(app.getHttpServer()).get(`/v1/invite-continuations/${first.invite.code}`).expect(401);

    const sameUser = await request(app.getHttpServer())
      .get(`/v1/invite-continuations/${first.invite.code}`)
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .expect(200);
    expect(sameUser.body).toEqual({
      state: 'available',
      continuation: {
        kind: 'continue-membership',
        membershipId: registered.body.activeMembershipId,
        route: '/app',
      },
    });

    const unused = await setupTenantWithInvite();
    for (const unavailableCode of ['NO_SUCH_CONTINUATION', unused.invite.code]) {
      const unavailable = await request(app.getHttpServer())
        .get(`/v1/invite-continuations/${unavailableCode}`)
        .set('Authorization', `Bearer ${registered.body.accessToken}`)
        .expect(200);
      expect(unavailable.body).toEqual({ state: 'not-available' });
    }

    const second = await setupTenantWithInvite();
    const otherUser = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(second.invite, 'other-continuation@member.test'))
      .expect(201);
    const denied = await request(app.getHttpServer())
      .get(`/v1/invite-continuations/${first.invite.code}`)
      .set('Authorization', `Bearer ${otherUser.body.accessToken}`)
      .expect(200);
    expect(denied.body).toEqual({ state: 'not-available' });
  });

  it('fails closed for stale continuation memberships and suspended tenants', async () => {
    const inactive = await setupTenantWithInvite();
    const inactiveRegistration = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(inactive.invite, 'inactive-continuation@member.test'))
      .expect(201);
    await prisma.membership.update({
      where: { id: inactiveRegistration.body.activeMembershipId },
      data: { status: MembershipStatus.inactive },
    });
    const inactiveResult = await request(app.getHttpServer())
      .get(`/v1/invite-continuations/${inactive.invite.code}`)
      .set('Authorization', `Bearer ${inactiveRegistration.body.accessToken}`)
      .expect(200);
    expect(inactiveResult.body).toEqual({ state: 'not-available' });

    await prisma.invite.update({
      where: { id: inactive.invite.id },
      data: { usedByMembershipId: '00000000-0000-4000-8000-000000000001' },
    });
    const staleResult = await request(app.getHttpServer())
      .get(`/v1/invite-continuations/${inactive.invite.code}`)
      .set('Authorization', `Bearer ${inactiveRegistration.body.accessToken}`)
      .expect(200);
    expect(staleResult.body).toEqual({ state: 'not-available' });

    const suspended = await setupTenantWithInvite();
    const suspendedRegistration = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(suspended.invite, 'suspended-continuation@member.test'))
      .expect(201);
    await prisma.tenant.update({ where: { id: suspended.tenant.id }, data: { status: TenantStatus.suspended } });
    const suspendedResult = await request(app.getHttpServer())
      .get(`/v1/invite-continuations/${suspended.invite.code}`)
      .set('Authorization', `Bearer ${suspendedRegistration.body.accessToken}`)
      .expect(200);
    expect(suspendedResult.body).toEqual({ state: 'not-available' });

  });

  it('ignores an unrelated stale selected membership for account-level invite continuation', async () => {
    const selected = await setupTenantWithInvite();
    const selectedRegistration = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(selected.invite))
      .expect(201);

    const target = await setupTenantWithInvite();
    const targetRegistration = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(target.invite))
      .expect(201);

    await prisma.membership.update({
      where: { id: selectedRegistration.body.activeMembershipId },
      data: { status: MembershipStatus.inactive },
    });

    const result = await request(app.getHttpServer())
      .get(`/v1/invite-continuations/${target.invite.code}`)
      .set('Authorization', `Bearer ${selectedRegistration.body.accessToken}`)
      .expect(200);
    expect(result.body).toEqual({
      state: 'available',
      continuation: {
        kind: 'continue-membership',
        membershipId: targetRegistration.body.activeMembershipId,
        route: '/app',
      },
    });
  });

  it('member app brand endpoint returns the active tenant brand', async () => {
    const { tenant, invite } = await setupTenantWithInvite();
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        name: 'Member Brand Co',
        branding: {
          logoText: 'MB',
          tagline: 'A cleaner member experience.',
          primaryColor: '#2255aa',
          accentColor: '#11aa88',
        },
      },
    });
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    const brand = await request(app.getHttpServer())
      .get('/v1/app/brand')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);

    expect(brand.body).toEqual({
      name: 'Member Brand Co',
      monogram: 'MB',
      tagline: 'A cleaner member experience.',
      primaryColor: '#2255aa',
      accentColor: '#11aa88',
    });
  });

  it.each([
    ['missing acceptance', { acceptDisclaimer: undefined }],
    ['false acceptance', { acceptDisclaimer: false }],
    ['wrong disclaimer version', { disclaimerVersion: '2026-07-15' }],
    ['unsupported disclaimer locale', { disclaimerLocale: 'de' }],
  ])('rejects %s before any invite-acceptance mutation', async (_case, invalidConsent) => {
    const { invite } = await setupTenantWithInvite();
    const inviteBefore = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    const countsBefore = await Promise.all([
      prisma.user.count(),
      prisma.membership.count(),
      prisma.pendingInviteAcceptance.count(),
      prisma.inviteAcceptanceConsent.count(),
      prisma.notification.count(),
      prisma.auditLog.count(),
    ]);

    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send({ ...registerBody(invite), ...invalidConsent })
      .expect(400);

    expect(await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).toEqual(inviteBefore);
    expect(
      await Promise.all([
        prisma.user.count(),
        prisma.membership.count(),
        prisma.pendingInviteAcceptance.count(),
        prisma.inviteAcceptanceConsent.count(),
        prisma.notification.count(),
        prisma.auditLog.count(),
      ]),
    ).toEqual(countsBefore);
  });

  it('fails before acceptance side effects when no commission plan is effective', async () => {
    const { invite, plan } = await setupTenantWithInvite();
    await prisma.commissionPlan.update({
      where: { id: plan.id },
      data: { effectiveFrom: new Date(Date.now() + 60_000) },
    });
    const countsBefore = await Promise.all([
      prisma.user.count(),
      prisma.membership.count(),
      prisma.pendingInviteAcceptance.count(),
      prisma.inviteAcceptanceConsent.count(),
    ]);

    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(400);

    expect(
      await Promise.all([
        prisma.user.count(),
        prisma.membership.count(),
        prisma.pendingInviteAcceptance.count(),
        prisma.inviteAcceptanceConsent.count(),
      ]),
    ).toEqual(countsBefore);
    expect(await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({
      status: InviteStatus.active,
      usedByMembershipId: null,
    });
  });

  it('register-by-invite places the member under the sponsor and consumes the invite once', async () => {
    const { root, invite } = await setupTenantWithInvite();

    const res = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.activeMembershipId).toBeDefined();
    expect(res.body.memberships).toHaveLength(1);

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: res.body.activeMembershipId },
    });
    expect(membership.sponsorMembershipId).toBe(root.id);
    expect(membership.depth).toBe(root.depth + 1);
    expect(membership.path.startsWith(`${root.path}.`)).toBe(true);
    expect(membership.status).toBe(MembershipStatus.active);

    const usedInvite = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(usedInvite.status).toBe(InviteStatus.used);
    expect(usedInvite.usedByMembershipId).toBe(membership.id);

    // The inviter receives an outbox notification.
    const joined = await prisma.notification.count({
      where: { template: 'team_member_joined', recipientMembershipId: root.id },
    });
    expect(joined).toBe(1);

    // The same invite cannot be used twice.
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite, 'another@member.test'))
      .expect(400);
  });

  it('atomically persists the authoritative direct invite snapshot and ignores spoofed snapshot fields', async () => {
    const { tenant, plan, root, invite } = await setupTenantWithInvite();
    await prisma.tenant.update({ where: { id: tenant.id }, data: { name: 'Authoritative Tenant' } });
    await prisma.commissionPlan.update({
      where: { id: plan.id },
      data: {
        name: 'Precision Plan',
        poolRateBps: 1234,
        depth: 7,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const expectedSummary =
      'Authoritative Tenant · Precision Plan: eligible, verified sales can reward up to 7 referral levels within a 12.34% commission pool.';
    const startedAt = new Date();

    const response = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send({
        ...registerBody(invite),
        disclaimerBody: 'Client-authored disclaimer',
        disclaimerContentHash: sha256('Client-authored disclaimer'),
        tenantDisplayName: 'Spoofed Tenant',
        programSummary: 'Spoofed program summary',
        programSummaryHash: sha256('Spoofed program summary'),
        acceptedAt: '2000-01-01T00:00:00.000Z',
        tenantId: '00000000-0000-0000-0000-000000000000',
        userId: '00000000-0000-0000-0000-000000000000',
        membershipId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(201);
    const finishedAt = new Date();

    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: response.body.activeMembershipId } });
    const consent = await prisma.inviteAcceptanceConsent.findFirstOrThrow({ where: { inviteId: invite.id } });
    expect(
      sha256(
        'Earnings are not guaranteed. Commissions are calculated only from eligible, verified sales under the current program rules.',
      ),
    ).toBe('7476bf5ed09ee419c4619c083133533d1c1f17538567417d0b0e9925363bd793');
    expect(consent).toMatchObject({
      inviteId: invite.id,
      tenantId: tenant.id,
      userId: response.body.user.id,
      membershipId: membership.id,
      disclaimerVersion: '2026-07-16',
      locale: 'en',
      disclaimerContentHash: '7476bf5ed09ee419c4619c083133533d1c1f17538567417d0b0e9925363bd793',
      tenantDisplayName: 'Authoritative Tenant',
      programSummary: expectedSummary,
      programSummaryHash: sha256(expectedSummary),
    });
    expect(consent.acceptedAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime());
    expect(consent.acceptedAt.getTime()).toBeLessThanOrEqual(finishedAt.getTime());
    expect(membership).toMatchObject({ tenantId: tenant.id, userId: response.body.user.id, sponsorMembershipId: root.id });
    expect(await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({
      status: InviteStatus.used,
      usedByMembershipId: membership.id,
    });
    expect(await prisma.inviteAcceptanceConsent.count({ where: { inviteId: invite.id } })).toBe(1);
  });

  it('selects the higher UUID when effective commission plans tie on effective and creation time', async () => {
    const { tenant, plan: firstPlan, invite } = await setupTenantWithInvite();
    const secondPlan = await createPlan(prisma, tenant.id);
    const higherIdPlan = firstPlan.id > secondPlan.id ? firstPlan : secondPlan;
    const lowerIdPlan = firstPlan.id > secondPlan.id ? secondPlan : firstPlan;
    const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');
    const createdAt = new Date('2026-01-02T00:00:00.000Z');

    await prisma.$transaction([
      prisma.tenant.update({ where: { id: tenant.id }, data: { name: 'Tie Break Tenant' } }),
      prisma.commissionPlan.update({
        where: { id: higherIdPlan.id },
        data: { name: 'UUID Winner', poolRateBps: 2500, depth: 3, effectiveFrom, createdAt },
      }),
      prisma.commissionPlan.update({
        where: { id: lowerIdPlan.id },
        data: { name: 'UUID Loser', poolRateBps: 1000, depth: 2, effectiveFrom, createdAt },
      }),
    ]);
    expect(higherIdPlan.id > lowerIdPlan.id).toBe(true);

    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    const expectedSummary =
      'Tie Break Tenant · UUID Winner: eligible, verified sales can reward up to 3 referral levels within a 25% commission pool.';
    expect(await prisma.inviteAcceptanceConsent.findFirstOrThrow({ where: { inviteId: invite.id } })).toMatchObject({
      tenantDisplayName: 'Tie Break Tenant',
      programSummary: expectedSummary,
      programSummaryHash: sha256(expectedSummary),
    });
  });

  it('rolls back direct membership and consent when later acceptance work fails', async () => {
    const { invite } = await setupTenantWithInvite();
    const countsBefore = await Promise.all([
      prisma.user.count(),
      prisma.membership.count(),
      prisma.inviteAcceptanceConsent.count(),
      prisma.notification.count(),
      prisma.auditLog.count(),
    ]);
    const originalCreateWithConsent = membershipService.createUnderWithInviteConsent.bind(membershipService);
    let insertedMembershipId: string | undefined;
    const createSpy = jest
      .spyOn(membershipService, 'createUnderWithInviteConsent')
      .mockImplementation(async (tx, params) => {
        const membership = await originalCreateWithConsent(tx, params);
        insertedMembershipId = membership.id;
        expect(await tx.membership.findUnique({ where: { id: membership.id } })).not.toBeNull();
        expect(await tx.inviteAcceptanceConsent.count({ where: { membershipId: membership.id } })).toBe(1);
        throw new ConflictException('forced post-consent rollback');
      });

    try {
      await request(app.getHttpServer())
        .post('/v1/auth/register-by-invite')
        .send(registerBody(invite, 'rollback@member.test'))
        .expect(409);

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(insertedMembershipId).toEqual(expect.any(String));
      expect(await prisma.user.findUnique({ where: { email: 'rollback@member.test' } })).toBeNull();
      expect(
        await Promise.all([
          prisma.user.count(),
          prisma.membership.count(),
          prisma.inviteAcceptanceConsent.count(),
          prisma.notification.count(),
          prisma.auditLog.count(),
        ]),
      ).toEqual(countsBefore);
      expect(await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({
        status: InviteStatus.active,
        usedByMembershipId: null,
      });
    } finally {
      createSpy.mockRestore();
    }
  });

  it('browser invite registration keeps the refresh token out of JSON and uses a production-secure cookie', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousSecret = process.env.JWT_ACCESS_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'test-browser-cookie-production-secret';
    try {
      const { invite } = await setupTenantWithInvite();
      const response = await request(app.getHttpServer())
        .post('/v1/auth/register-by-invite')
        .set('Origin', BROWSER_ORIGIN)
        .send(registerBody(invite))
        .expect(201);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toBeUndefined();
      expectBrowserRefreshCookie(response, true);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = previousSecret;
    }
  });

  it('browser login refreshes and logs out through a rotating HttpOnly cookie', async () => {
    const { invite } = await setupTenantWithInvite();
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('Origin', BROWSER_ORIGIN)
      .send({ email: 'new@member.test', password: PASSWORD })
      .expect(200);
    expect(login.body.refreshToken).toBeUndefined();
    const firstCookie = expectBrowserRefreshCookie(login);

    const refreshed = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Origin', BROWSER_ORIGIN)
      .set('Cookie', firstCookie)
      .expect(200);
    expect(refreshed.body.refreshToken).toBeUndefined();
    const rotatedCookie = expectBrowserRefreshCookie(refreshed);
    expect(rotatedCookie).not.toBe(firstCookie);

    const logout = await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Origin', BROWSER_ORIGIN)
      .set('Cookie', rotatedCookie)
      .expect(200);
    const clearedCookie = refreshCookieHeader(logout);
    expect(clearedCookie).toBe(`${REFRESH_COOKIE_NAME}=`);
    expect(logout.headers['set-cookie']).toContainEqual(expect.stringContaining('Path=/v1/auth'));

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Origin', BROWSER_ORIGIN)
      .set('Cookie', rotatedCookie)
      .expect(401);
  });

  it('browser MFA completion and Fetch Metadata auth responses redact refresh tokens', async () => {
    const { invite } = await setupTenantWithInvite();
    const registration = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${registration.body.accessToken}` };
    const setup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(auth).expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set(auth)
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);

    const challenge = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'new@member.test', password: PASSWORD })
      .expect(200);
    const completed = await request(app.getHttpServer())
      .post('/v1/auth/login/2fa')
      .set('Origin', BROWSER_ORIGIN)
      .send({ challengeToken: challenge.body.challengeToken, code: totpCode(setup.body.secret) })
      .expect(200);
    expect(completed.body.refreshToken).toBeUndefined();
    expectBrowserRefreshCookie(completed);

    const metadataInvite = await setupTenantWithInvite();
    const metadataRegistration = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Sec-Fetch-Mode', 'cors')
      .send(registerBody(metadataInvite.invite, 'metadata-browser@member.test'))
      .expect(201);
    expect(metadataRegistration.body.refreshToken).toBeUndefined();
    expectBrowserRefreshCookie(metadataRegistration);
  });

  it('does not issue a browser refresh cookie to an unconfigured same-site navigation', async () => {
    const { invite } = await setupTenantWithInvite();
    const response = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .set('Sec-Fetch-Site', 'same-site')
      .set('Sec-Fetch-Mode', 'navigate')
      .send(registerBody(invite, 'unconfigured-same-site@member.test'))
      .expect(201);

    expect(response.body.refreshToken).toEqual(expect.any(String));
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('mobile clients retain the body refresh-token contract and missing credentials are rejected', async () => {
    const { invite } = await setupTenantWithInvite();
    const registration = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    expect(registration.body.refreshToken).toEqual(expect.any(String));
    expect(registration.headers['set-cookie']).toBeUndefined();

    const refreshed = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: registration.body.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).toEqual(expect.any(String));
    expect(refreshed.headers['set-cookie']).toBeUndefined();

    await request(app.getHttpServer()).post('/v1/auth/refresh').expect(401);
    await request(app.getHttpServer()).post('/v1/auth/logout').expect(401);
  });

  it('rejects an expired invite and marks it expired', async () => {
    const { invite } = await setupTenantWithInvite();
    await prisma.invite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(400);

    const updated = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(updated.status).toBe(InviteStatus.expired);
  });

  it('prevents an email-locked invite from being used by another email', async () => {
    const { invite } = await setupTenantWithInvite();
    await prisma.invite.update({
      where: { id: invite.id },
      data: { email: 'locked@person.test' },
    });
    const inviteBefore = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    const countsBefore = await Promise.all([
      prisma.user.count(),
      prisma.membership.count(),
      prisma.pendingInviteAcceptance.count(),
      prisma.inviteAcceptanceConsent.count(),
      prisma.notification.count(),
      prisma.auditLog.count(),
    ]);

    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite, 'other@person.test'))
      .expect(400);

    expect(await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).toEqual(inviteBefore);
    expect(
      await Promise.all([
        prisma.user.count(),
        prisma.membership.count(),
        prisma.pendingInviteAcceptance.count(),
        prisma.inviteAcceptanceConsent.count(),
        prisma.notification.count(),
        prisma.auditLog.count(),
      ]),
    ).toEqual(countsBefore);
    expect(await prisma.user.findUnique({ where: { email: 'other@person.test' } })).toBeNull();

    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite, 'locked@person.test'))
      .expect(201);
  });

  it('uses an email-locked invite address when the client omits email', async () => {
    const { invite } = await setupTenantWithInvite();
    await prisma.invite.update({
      where: { id: invite.id },
      data: { email: 'locked-omitted@person.test' },
    });
    const { email: _email, ...bodyWithoutEmail } = registerBody(invite);

    const registration = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(bodyWithoutEmail)
      .expect(201);

    expect(registration.body.user.email).toBe('locked-omitted@person.test');
    expect(await prisma.user.findUnique({ where: { email: 'locked-omitted@person.test' } })).not.toBeNull();
    expect((await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).status).toBe(InviteStatus.used);
  });

  it('requires email for an open invite before any mutation', async () => {
    const { invite } = await setupTenantWithInvite();
    const inviteBefore = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    const countsBefore = await Promise.all([
      prisma.user.count(),
      prisma.membership.count(),
      prisma.pendingInviteAcceptance.count(),
      prisma.inviteAcceptanceConsent.count(),
      prisma.notification.count(),
      prisma.auditLog.count(),
    ]);
    const { email: _email, ...bodyWithoutEmail } = registerBody(invite);

    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(bodyWithoutEmail)
      .expect(400);

    expect(await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).toEqual(inviteBefore);
    expect(
      await Promise.all([
        prisma.user.count(),
        prisma.membership.count(),
        prisma.pendingInviteAcceptance.count(),
        prisma.inviteAcceptanceConsent.count(),
        prisma.notification.count(),
        prisma.auditLog.count(),
      ]),
    ).toEqual(countsBefore);
  });

  it('login returns claims for the correct password and rejects wrong credentials', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'new@member.test', password: PASSWORD })
      .expect(200);
    expect(login.body.activeMembershipId).toBe(reg.body.activeMembershipId);

    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe('new@member.test');
    expect(me.body.activeMembershipId).toBe(reg.body.activeMembershipId);

    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'new@member.test', password: 'wrong-password-123' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'missing@person.test', password: PASSWORD })
      .expect(401);
  });

  it('2FA setup and enablement require a login challenge and issue a TOTP session', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const setup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(auth).expect(200);
    expect(setup.body.secret).toBeDefined();
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');

    const code = totpCode(setup.body.secret);
    const enabled = await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set(auth)
      .send({ code })
      .expect(200);
    expect(enabled.body.recoveryCodes).toHaveLength(8);

    const challenge = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'new@member.test', password: PASSWORD })
      .expect(200);
    expect(challenge.body.mfaRequired).toBe(true);
    expect(challenge.body.challengeToken).toBeDefined();

    await request(app.getHttpServer())
      .post('/v1/auth/login/2fa')
      .send({ challengeToken: challenge.body.challengeToken, code: '000000' })
      .expect(401);

    const session = await request(app.getHttpServer())
      .post('/v1/auth/login/2fa')
      .send({ challengeToken: challenge.body.challengeToken, code: totpCode(setup.body.secret) })
      .expect(200);
    expect(session.body.accessToken).toBeDefined();
    expect(session.body.activeMembershipId).toBe(reg.body.activeMembershipId);

    const claims = jwt.verify(session.body.accessToken, { secret: authConfig.accessSecret() }) as AccessTokenPayload & {
      mfaAt?: number;
      mfaEpoch?: number;
    };
    expect(claims).toMatchObject({
      mfa: true,
      mfaAt: expect.any(Number),
      mfaEpoch: expect.any(Number),
    });
    expect(claims.mfaAt).toBeGreaterThanOrEqual(claims.mfaEpoch!);

    const refreshed = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.body.refreshToken })
      .expect(200);
    const refreshedClaims = jwt.verify(refreshed.body.accessToken, { secret: authConfig.accessSecret() }) as AccessTokenPayload & {
      mfaAt?: number;
      mfaEpoch?: number;
    };
    expect(refreshedClaims).toMatchObject({
      mfa: true,
      mfaAt: claims.mfaAt,
      mfaEpoch: claims.mfaEpoch,
    });
  });

  it('enabling 2FA revokes the pre-enrollment refresh session', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const setup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(auth).expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set(auth)
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.body.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(401);
  });

  it('rejects legacy access tokens without a session generation', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);

    const decoded = jwt.decode(reg.body.accessToken) as Record<string, unknown>;
    expect(decoded.authGeneration).toEqual(expect.any(Number));
    const { iat: _iat, exp: _exp, authGeneration: _authGeneration, ...legacyPayload } = decoded;
    const legacyToken = jwt.sign(legacyPayload, {
      secret: authConfig.accessSecret(),
      expiresIn: authConfig.accessTtlSeconds,
    });

    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${legacyToken}`)
      .expect(401);
  });

  it('fails closed when a legacy refresh row has no session generation', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    await prisma.$executeRaw`
      UPDATE "refresh_tokens" SET "auth_generation" = NULL WHERE "token_hash" = ${sha256(reg.body.refreshToken)}
    `;

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.body.refreshToken })
      .expect(401);
  });

  it('fails closed for a refresh successor minted from a pre-security-change generation', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
    const setup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(auth).expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set(auth)
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);

    const staleSuccessor = 'stale-successor-refresh-token';
    await prisma.refreshToken.create({
      data: {
        userId: reg.body.user.id,
        tokenHash: sha256(staleSuccessor),
        expiresAt: new Date(Date.now() + authConfig.refreshTtlMs),
        authGeneration: 1,
      },
    });

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: staleSuccessor })
      .expect(401);
  });

  it('invalidates stale access credentials after MFA enablement and disablement', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const oldAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const setup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(oldAuth).expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set(oldAuth)
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);

    await request(app.getHttpServer()).get('/v1/me').set(oldAuth).expect(401);

    const challenge = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'new@member.test', password: PASSWORD })
      .expect(200);
    const session = await request(app.getHttpServer())
      .post('/v1/auth/login/2fa')
      .send({ challengeToken: challenge.body.challengeToken, code: totpCode(setup.body.secret) })
      .expect(200);
    const sessionAuth = { Authorization: `Bearer ${session.body.accessToken}` };

    await request(app.getHttpServer())
      .post('/v1/auth/2fa/disable')
      .set(sessionAuth)
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);

    await request(app.getHttpServer()).get('/v1/me').set(sessionAuth).expect(401);
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.body.refreshToken })
      .expect(401);
  });

  it('privileged accounts without MFA can only access MFA setup before admin/platform APIs', async () => {
    const previous = process.env.MFA_REQUIRED_ROLES;
    process.env.MFA_REQUIRED_ROLES = 'tenant_owner,tenant_admin,platform_admin';
    try {
      const tenant = await createTenant(prisma);
      await createPlan(prisma, tenant.id);
      const [owner] = await createChain(prisma, tenant.id, 1);
      await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
      const ownerToken = accessToken({
        sub: owner.userId,
        mid: owner.id,
        tid: tenant.id,
        role: Role.tenant_owner,
        perms: defaultPermissionsForTier(Role.tenant_owner),
        mfa: true,
      });
      const ownerAuth = { Authorization: `Bearer ${ownerToken}` };

      await request(app.getHttpServer()).get('/v1/admin/sales').set(ownerAuth).expect(403);
      const ownerSetup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(ownerAuth).expect(200);
      await request(app.getHttpServer())
        .post('/v1/auth/2fa/enable')
        .set(ownerAuth)
        .send({ code: totpCode(ownerSetup.body.secret) })
        .expect(200);
      // A legacy claim that only says `mfa: true` is not proof that this session
      // completed MFA for the current enrollment epoch.
      await request(app.getHttpServer()).get('/v1/admin/sales').set(ownerAuth).expect(401);

      const platformUser = await prisma.user.create({
        data: {
          email: 'platform@test.refearn.local',
          passwordHash: 'test-only',
          fullName: 'Platform Admin',
          isPlatformAdmin: true,
        },
      });
      const platformToken = accessToken({
        sub: platformUser.id,
        mid: null,
        tid: null,
        role: null,
        plat: true,
        mfa: true,
      });
      const platformAuth = { Authorization: `Bearer ${platformToken}` };

      await request(app.getHttpServer()).get('/v1/platform/companies').set(platformAuth).expect(403);
      const platformSetup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(platformAuth).expect(200);
      await request(app.getHttpServer())
        .post('/v1/auth/2fa/enable')
        .set(platformAuth)
        .send({ code: totpCode(platformSetup.body.secret) })
        .expect(200);
      await request(app.getHttpServer()).get('/v1/platform/companies').set(platformAuth).expect(401);
    } finally {
      if (previous === undefined) delete process.env.MFA_REQUIRED_ROLES;
      else process.env.MFA_REQUIRED_ROLES = previous;
    }
  });

  it('protected routes reject missing tokens and authenticated invite creation/listing works', async () => {
    const { invite } = await setupTenantWithInvite();
    await request(app.getHttpServer()).get('/v1/app/invites').expect(401);
    await request(app.getHttpServer()).get('/v1/me').expect(401);

    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const created = await request(app.getHttpServer())
      .post('/v1/app/invites')
      .set(auth)
      .send({})
      .expect(201);
    expect(created.body.code).toHaveLength(10);

    const list = await request(app.getHttpServer()).get('/v1/app/invites').set(auth).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].code).toBe(created.body.code);
  });

  it('refresh rotation and reuse detection revoke all sessions after old-token reuse', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const oldRefresh = reg.body.refreshToken;

    // Rotation returns a new token pair.
    const r1 = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(200);
    expect(r1.body.refreshToken).toBeDefined();
    expect(r1.body.refreshToken).not.toBe(oldRefresh);
    // Reusing the old token returns 401 and revokes all active refresh tokens.
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({ refreshToken: reg.body.refreshToken })
      .expect(200);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.body.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(401);
  });

  it('revoking one or all sessions invalidates every outstanding access credential', async () => {
    const { invite } = await setupTenantWithInvite();
    const first = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'new@member.test', password: PASSWORD })
      .expect(200);
    const firstAuth = { Authorization: `Bearer ${first.body.accessToken}` };

    const sessions = await request(app.getHttpServer()).get('/v1/auth/sessions').set(firstAuth).expect(200);
    await request(app.getHttpServer())
      .delete(`/v1/auth/sessions/${sessions.body[0].id}`)
      .set(firstAuth)
      .expect(200);
    await request(app.getHttpServer()).get('/v1/me').set(firstAuth).expect(401);
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${second.body.accessToken}`)
      .expect(401);

    const relogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'new@member.test', password: PASSWORD })
      .expect(200);
    const reloginAuth = { Authorization: `Bearer ${relogin.body.accessToken}` };
    await request(app.getHttpServer()).post('/v1/auth/sessions/revoke-all').set(reloginAuth).expect(200);
    await request(app.getHttpServer()).get('/v1/me').set(reloginAuth).expect(401);
  });

  it('multi-tenant account joins a second tenant by invite and can switch tenants', async () => {
    const t1 = await setupTenantWithInvite();
    const reg1 = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(t1.invite))
      .expect(201);

    const t2 = await setupTenantWithInvite();

    // A wrong password does not create a membership for an existing account.
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send({ ...registerBody(t2.invite), password: 'wrong-password-42!' })
      .expect(409);

    const reg2 = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(t2.invite))
      .expect(201);

    expect(reg2.body.memberships).toHaveLength(2);
    // One global user account.
    expect(await prisma.user.count({ where: { email: 'new@member.test' } })).toBe(1);

    // The last selection is remembered: active membership is the most recently joined tenant.
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'new@member.test', password: PASSWORD })
      .expect(200);
    expect(login.body.activeMembershipId).toBe(reg2.body.activeMembershipId);

    // Switch back to the first tenant.
    const sw = await request(app.getHttpServer())
      .post('/v1/me/switch-tenant')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ membershipId: reg1.body.activeMembershipId })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${sw.body.accessToken}`)
      .expect(200);
    expect(me.body.activeMembershipId).toBe(reg1.body.activeMembershipId);
    expect(me.body.tenantId).toBe(t1.tenant.id);

    // A user cannot switch to somebody else's membership.
    const otherPerson = await prisma.membership.findFirstOrThrow({
      where: { id: { notIn: [reg1.body.activeMembershipId, reg2.body.activeMembershipId] } },
    });
    await request(app.getHttpServer())
      .post('/v1/me/switch-tenant')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ membershipId: otherPerson.id })
      .expect(404);
  });

  it('returns a guard-rehydrated active-tenant capability context after switching tenants', async () => {
    const first = await setupTenantWithInvite();
    const firstRegistration = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(first.invite))
      .expect(201);
    const second = await setupTenantWithInvite();
    const secondRegistration = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(second.invite))
      .expect(201);
    const role = await prisma.tenantRole.create({
      data: {
        tenantId: first.tenant.id,
        key: 'capability_context',
        name: 'Capability context',
        permissions: ['payouts.view', 'dashboard.view', 'payouts.view'],
      },
    });
    await prisma.membership.update({
      where: { id: firstRegistration.body.activeMembershipId },
      data: { role: Role.tenant_staff, roleId: role.id },
    });

    const switched = await request(app.getHttpServer())
      .post('/v1/me/switch-tenant')
      .set('Authorization', `Bearer ${secondRegistration.body.accessToken}`)
      .send({ membershipId: firstRegistration.body.activeMembershipId })
      .expect(200);
    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${switched.body.accessToken}`)
      .expect(200);

    expect(me.body.capabilities).toEqual({
      authority: 'active-tenant',
      activeTenant: {
        membershipId: firstRegistration.body.activeMembershipId,
        tenantId: first.tenant.id,
        role: Role.tenant_staff,
        permissions: ['dashboard.view', 'payouts.view'],
      },
    });
    expect(JSON.stringify(me.body.capabilities)).not.toContain(secondRegistration.body.activeMembershipId);
    expect(JSON.stringify(me.body.capabilities)).not.toContain(second.tenant.id);
  });

  it('returns unavailable capabilities without an active tenant context', async () => {
    const { invite } = await setupTenantWithInvite();
    const registered = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const unselected = accessToken({
      sub: registered.body.user.id,
      mid: null,
      tid: null,
      role: null,
    });

    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${unselected}`)
      .expect(200);

    expect(me.body).toMatchObject({ activeMembershipId: null, tenantId: null, role: null });
    expect(me.body.capabilities).toEqual({ authority: 'unavailable', activeTenant: null });
  });

  it('keeps an MFA invite acceptance pending until the challenge succeeds', async () => {
    const first = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(first.invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
    const setup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(auth).expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set(auth)
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);

    const second = await setupTenantWithInvite();
    await prisma.tenant.update({ where: { id: second.tenant.id }, data: { name: 'Accepted Tenant Name' } });
    await prisma.commissionPlan.update({
      where: { id: second.plan.id },
      data: {
        name: 'Accepted MFA Plan',
        poolRateBps: 1250,
        depth: 4,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const acceptedProgramSummary =
      'Accepted Tenant Name · Accepted MFA Plan: uygun ve doğrulanmış satışlar, %12.5 komisyon havuzu içinde en fazla 4 referans seviyesini ödüllendirebilir.';
    const joined = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send({ ...registerBody(second.invite), disclaimerLocale: 'tr' })
      .expect(201);

    expect(joined.body).toMatchObject({
      mfaRequired: true,
      challengeToken: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(joined.body.accessToken).toBeUndefined();
    expect(joined.body.refreshToken).toBeUndefined();

    const challenge = await prisma.userToken.findUniqueOrThrow({
      where: { tokenHash: sha256(joined.body.challengeToken) },
      include: { pendingInviteAcceptance: true },
    });
    const pending = challenge.pendingInviteAcceptance!;
    expect(pending).toMatchObject({
      userId: reg.body.user.id,
      inviteId: second.invite.id,
      challengeTokenId: challenge.id,
      tenantId: second.tenant.id,
      disclaimerVersion: '2026-07-16',
      disclaimerLocale: 'tr',
      disclaimerContentHash: sha256(
        'Kazanç garanti edilmez. Komisyonlar yalnızca güncel program kuralları kapsamındaki uygun ve doğrulanmış satışlar üzerinden hesaplanır.',
      ),
      tenantDisplayName: 'Accepted Tenant Name',
      programSummary: acceptedProgramSummary,
      programSummaryHash: sha256(acceptedProgramSummary),
      consentAcceptedAt: expect.any(Date),
      completedAt: null,
    });
    expect([
      pending.tenantId,
      pending.disclaimerVersion,
      pending.disclaimerLocale,
      pending.disclaimerContentHash,
      pending.tenantDisplayName,
      pending.programSummary,
      pending.programSummaryHash,
      pending.consentAcceptedAt,
    ]).not.toContain(null);

    const pendingUser = await prisma.user.findUniqueOrThrow({ where: { id: reg.body.user.id } });
    expect(pendingUser.lastMembershipId).toBe(reg.body.activeMembershipId);
    expect(await prisma.membership.count({ where: { userId: reg.body.user.id } })).toBe(1);
    expect(await prisma.invite.findUniqueOrThrow({ where: { id: second.invite.id } })).toMatchObject({
      status: InviteStatus.active,
      usedByMembershipId: null,
    });
    expect(
      await prisma.notification.count({
        where: { recipientMembershipId: second.root.id, template: 'team_member_joined' },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { tenantId: second.tenant.id, action: 'membership.register_by_invite' },
      }),
    ).toBe(0);

    await prisma.tenant.update({ where: { id: second.tenant.id }, data: { name: 'Changed Tenant Name' } });
    await prisma.commissionPlan.update({
      where: { id: second.plan.id },
      data: { name: 'Changed MFA Plan', poolRateBps: 2500, depth: 5 },
    });

    await request(app.getHttpServer())
      .post('/v1/auth/login/2fa')
      .send({ challengeToken: joined.body.challengeToken, code: '000000' })
      .expect(401);
    expect(await prisma.membership.count({ where: { userId: reg.body.user.id } })).toBe(1);
    expect((await prisma.invite.findUniqueOrThrow({ where: { id: second.invite.id } })).status).toBe(InviteStatus.active);
    expect(await prisma.inviteAcceptanceConsent.count({ where: { inviteId: second.invite.id } })).toBe(0);

    const completed = await request(app.getHttpServer())
      .post('/v1/auth/login/2fa')
      .send({ challengeToken: joined.body.challengeToken, code: totpCode(setup.body.secret) })
      .expect(200);

    const acceptedInvite = await prisma.invite.findUniqueOrThrow({ where: { id: second.invite.id } });
    expect(acceptedInvite.status).toBe(InviteStatus.used);
    expect(acceptedInvite.usedByMembershipId).toBeDefined();
    expect(await prisma.membership.count({ where: { userId: reg.body.user.id } })).toBe(2);
    const consent = await prisma.inviteAcceptanceConsent.findFirstOrThrow({ where: { inviteId: second.invite.id } });
    expect(consent).toMatchObject({
      inviteId: pending.inviteId,
      tenantId: pending.tenantId,
      userId: pending.userId,
      membershipId: acceptedInvite.usedByMembershipId,
      disclaimerVersion: pending.disclaimerVersion,
      locale: pending.disclaimerLocale,
      disclaimerContentHash: pending.disclaimerContentHash,
      tenantDisplayName: pending.tenantDisplayName,
      programSummary: pending.programSummary,
      programSummaryHash: pending.programSummaryHash,
      acceptedAt: pending.consentAcceptedAt,
    });
    expect(consent.tenantDisplayName).toBe('Accepted Tenant Name');
    expect(consent.programSummary).toBe(acceptedProgramSummary);
    expect(consent.acceptedAt).toEqual(pending.consentAcceptedAt);
    expect(await prisma.pendingInviteAcceptance.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({
      completedAt: expect.any(Date),
    });

    const switched = await request(app.getHttpServer())
      .post('/v1/me/switch-tenant')
      .set('Authorization', `Bearer ${completed.body.accessToken}`)
      .send({ membershipId: reg.body.activeMembershipId })
      .expect(200);
    const switchedClaims = jwt.verify(switched.body.accessToken, { secret: authConfig.accessSecret() }) as AccessTokenPayload & {
      mfaAt?: number;
      mfaEpoch?: number;
    };
    expect(switchedClaims).toMatchObject({
      mfa: true,
      mfaAt: expect.any(Number),
      mfaEpoch: expect.any(Number),
    });

    const memberships = await prisma.membership.findMany({ where: { userId: reg.body.user.id } });
    const current = memberships.find((membership) => membership.id !== reg.body.activeMembershipId)!;
    const completedClaims = jwt.verify(completed.body.accessToken, { secret: authConfig.accessSecret() }) as AccessTokenPayload;
    const staleAssurance = accessToken({
      sub: reg.body.user.id,
      mid: current.id,
      tid: current.tenantId,
      role: current.role,
      authGeneration: completedClaims.authGeneration,
      mfa: true,
      mfaAt: 0,
      mfaEpoch: 0,
    });
    const staleSwitch = await request(app.getHttpServer())
      .post('/v1/me/switch-tenant')
      .set('Authorization', `Bearer ${staleAssurance}`)
      .send({ membershipId: reg.body.activeMembershipId })
      .expect(200);
    const staleClaims = jwt.verify(staleSwitch.body.accessToken, { secret: authConfig.accessSecret() }) as AccessTokenPayload;
    expect(staleClaims.mfa).toBeUndefined();
    expect(staleClaims.mfaAt).toBeUndefined();
    expect(staleClaims.mfaEpoch).toBeUndefined();
  });

  it('fails closed for incomplete or tampered pending consent and requires a new invite attempt', async () => {
    const first = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(first.invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
    const setup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(auth).expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set(auth)
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);

    const second = await setupTenantWithInvite();
    const challenged = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(second.invite))
      .expect(201);
    const token = await prisma.userToken.findUniqueOrThrow({
      where: { tokenHash: sha256(challenged.body.challengeToken) },
      include: { pendingInviteAcceptance: true },
    });
    const pending = token.pendingInviteAcceptance!;
    const validSnapshot = {
      tenantId: pending.tenantId,
      disclaimerVersion: pending.disclaimerVersion,
      disclaimerLocale: pending.disclaimerLocale,
      disclaimerContentHash: pending.disclaimerContentHash,
      tenantDisplayName: pending.tenantDisplayName,
      programSummary: pending.programSummary,
      programSummaryHash: pending.programSummaryHash,
      consentAcceptedAt: pending.consentAcceptedAt,
    };
    const acceptanceCountsBefore = await Promise.all([
      prisma.membership.count({ where: { userId: reg.body.user.id } }),
      prisma.inviteAcceptanceConsent.count({ where: { inviteId: second.invite.id } }),
      prisma.notification.count({ where: { tenantId: second.tenant.id } }),
      prisma.auditLog.count({ where: { tenantId: second.tenant.id } }),
    ]);
    const invalidSnapshots: Array<[string, Prisma.PendingInviteAcceptanceUncheckedUpdateInput]> = [
      ['missing accepted time', { consentAcceptedAt: null }],
      ['blank tenant display name', { tenantDisplayName: '   ' }],
      ['different tenant binding', { tenantId: first.tenant.id }],
      ['unknown disclaimer version', { disclaimerVersion: 'legacy-unknown' }],
      ['unsupported disclaimer locale', { disclaimerLocale: 'de' }],
      ['tampered disclaimer hash', { disclaimerContentHash: sha256('tampered disclaimer') }],
      ['blank program summary', { programSummary: '' }],
      ['tampered program hash', { programSummaryHash: sha256('tampered summary') }],
    ];

    for (const [caseName, invalidSnapshot] of invalidSnapshots) {
      await prisma.pendingInviteAcceptance.update({
        where: { id: pending.id },
        data: { ...validSnapshot, ...invalidSnapshot },
      });
      const response = await request(app.getHttpServer())
        .post('/v1/auth/login/2fa')
        .send({ challengeToken: challenged.body.challengeToken, code: totpCode(setup.body.secret) });
      expect({ caseName, status: response.status }).toEqual({ caseName, status: 400 });
      expect(await prisma.userToken.findUniqueOrThrow({ where: { id: token.id } })).toMatchObject({ usedAt: null });
      expect(await prisma.pendingInviteAcceptance.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({
        completedAt: null,
      });
      expect(await prisma.invite.findUniqueOrThrow({ where: { id: second.invite.id } })).toMatchObject({
        status: InviteStatus.active,
        usedByMembershipId: null,
      });
      expect(
        await Promise.all([
          prisma.membership.count({ where: { userId: reg.body.user.id } }),
          prisma.inviteAcceptanceConsent.count({ where: { inviteId: second.invite.id } }),
          prisma.notification.count({ where: { tenantId: second.tenant.id } }),
          prisma.auditLog.count({ where: { tenantId: second.tenant.id } }),
        ]),
      ).toEqual(acceptanceCountsBefore);
    }

    const restarted = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(second.invite))
      .expect(201);
    expect(restarted.body.mfaRequired).toBe(true);
    const restartedToken = await prisma.userToken.findUniqueOrThrow({
      where: { tokenHash: sha256(restarted.body.challengeToken) },
      include: { pendingInviteAcceptance: true },
    });
    expect(restartedToken.pendingInviteAcceptance?.id).not.toBe(pending.id);
    expect(restartedToken.pendingInviteAcceptance).toMatchObject({
      tenantId: second.tenant.id,
      disclaimerVersion: '2026-07-16',
      disclaimerLocale: 'en',
      consentAcceptedAt: expect.any(Date),
    });
    expect(await prisma.userToken.findUniqueOrThrow({ where: { id: token.id } })).toMatchObject({
      usedAt: expect.any(Date),
    });

    await request(app.getHttpServer())
      .post('/v1/auth/login/2fa')
      .send({ challengeToken: restarted.body.challengeToken, code: totpCode(setup.body.secret) })
      .expect(200);
    expect(await prisma.membership.count({ where: { userId: reg.body.user.id } })).toBe(2);
    expect(await prisma.inviteAcceptanceConsent.count({ where: { inviteId: second.invite.id } })).toBe(1);
  });

  it('locks a pending MFA user row before its invite during completion', async () => {
    const first = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(first.invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
    const setup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(auth).expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set(auth)
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);

    const second = await setupTenantWithInvite();
    const joined = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(second.invite))
      .expect(201);

    const privateAuth = authService as unknown as {
      lockInviteForAcceptance: (tx: Prisma.TransactionClient, inviteId: string) => Promise<void>;
      lockUserForAuth: (tx: Prisma.TransactionClient, userId: string) => Promise<void>;
    };
    const originalInviteLock = privateAuth.lockInviteForAcceptance.bind(privateAuth);
    const originalUserLock = privateAuth.lockUserForAuth.bind(privateAuth);
    const order: string[] = [];
    const inviteLockSpy = jest.spyOn(privateAuth, 'lockInviteForAcceptance').mockImplementation(async (tx, inviteId) => {
      order.push('invite');
      await originalInviteLock(tx, inviteId);
    });
    const userLockSpy = jest.spyOn(privateAuth, 'lockUserForAuth').mockImplementation(async (tx, userId) => {
      order.push('user');
      await originalUserLock(tx, userId);
    });

    try {
      await request(app.getHttpServer())
        .post('/v1/auth/login/2fa')
        .send({ challengeToken: joined.body.challengeToken, code: totpCode(setup.body.secret) })
        .expect(200);
      expect(order.slice(0, 2)).toEqual(['user', 'invite']);
    } finally {
      userLockSpy.mockRestore();
      inviteLockSpy.mockRestore();
    }
  });

  it('locks an existing MFA invite registrant before its invite row', async () => {
    const first = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(first.invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
    const setup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(auth).expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set(auth)
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);

    const second = await setupTenantWithInvite();
    const privateAuth = authService as unknown as {
      lockInviteForAcceptance: (tx: Prisma.TransactionClient, inviteId: string) => Promise<void>;
      lockUserForAuth: (tx: Prisma.TransactionClient, userId: string) => Promise<void>;
    };
    const originalInviteLock = privateAuth.lockInviteForAcceptance.bind(privateAuth);
    const originalUserLock = privateAuth.lockUserForAuth.bind(privateAuth);
    const order: string[] = [];
    const inviteLockSpy = jest.spyOn(privateAuth, 'lockInviteForAcceptance').mockImplementation(async (tx, inviteId) => {
      order.push('invite');
      await originalInviteLock(tx, inviteId);
    });
    const userLockSpy = jest.spyOn(privateAuth, 'lockUserForAuth').mockImplementation(async (tx, userId) => {
      order.push('user');
      await originalUserLock(tx, userId);
    });

    try {
      const joined = await request(app.getHttpServer())
        .post('/v1/auth/register-by-invite')
        .send(registerBody(second.invite))
        .expect(201);
      expect(joined.body.mfaRequired).toBe(true);
      expect(order.slice(0, 2)).toEqual(['user', 'invite']);
    } finally {
      userLockSpy.mockRestore();
      inviteLockSpy.mockRestore();
    }
  });

  it('preserves a current MFA assurance while selecting a tenant from an unselected session', async () => {
    const first = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(first.invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
    const setup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(auth).expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set(auth)
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);

    const second = await setupTenantWithInvite();
    const joined = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(second.invite))
      .expect(201);
    await request(app.getHttpServer())
      .post('/v1/auth/login/2fa')
      .send({ challengeToken: joined.body.challengeToken, code: totpCode(setup.body.secret) })
      .expect(200);

    await prisma.user.update({ where: { id: reg.body.user.id }, data: { lastMembershipId: null } });
    const freshChallenge = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'new@member.test', password: PASSWORD })
      .expect(200);
    const unselected = await request(app.getHttpServer())
      .post('/v1/auth/login/2fa')
      .send({ challengeToken: freshChallenge.body.challengeToken, code: totpCode(setup.body.secret) })
      .expect(200);
    expect((jwt.decode(unselected.body.accessToken) as AccessTokenPayload).mid).toBeNull();

    const switched = await request(app.getHttpServer())
      .post('/v1/me/switch-tenant')
      .set('Authorization', `Bearer ${unselected.body.accessToken}`)
      .send({ membershipId: reg.body.activeMembershipId })
      .expect(200);
    const claims = jwt.verify(switched.body.accessToken, { secret: authConfig.accessSecret() }) as AccessTokenPayload;
    expect(claims).toMatchObject({
      mfa: true,
      mfaAt: expect.any(Number),
      mfaEpoch: expect.any(Number),
    });
  });

  it('leaves an invite untouched when its MFA challenge has expired', async () => {
    const first = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(first.invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
    const setup = await request(app.getHttpServer()).post('/v1/auth/2fa/setup').set(auth).expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/2fa/enable')
      .set(auth)
      .send({ code: totpCode(setup.body.secret) })
      .expect(200);

    const second = await setupTenantWithInvite();
    const joined = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(second.invite))
      .expect(201);
    const challenge = await prisma.userToken.findFirstOrThrow({
      where: { userId: reg.body.user.id, purpose: UserTokenPurpose.login_otp, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.userToken.update({ where: { id: challenge.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });

    await request(app.getHttpServer())
      .post('/v1/auth/login/2fa')
      .send({ challengeToken: joined.body.challengeToken, code: totpCode(setup.body.secret) })
      .expect(401);

    expect(await prisma.membership.count({ where: { userId: reg.body.user.id } })).toBe(1);
    const invite = await prisma.invite.findUniqueOrThrow({ where: { id: second.invite.id } });
    expect(invite.status).toBe(InviteStatus.active);
    expect(invite.usedByMembershipId).toBeNull();
    expect(await prisma.inviteAcceptanceConsent.count({ where: { inviteId: second.invite.id } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: reg.body.user.id } });
    expect(user.lastMembershipId).toBe(reg.body.activeMembershipId);
    expect(
      await prisma.notification.count({
        where: { recipientMembershipId: second.root.id, template: 'team_member_joined' },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { tenantId: second.tenant.id, action: 'membership.register_by_invite' },
      }),
    ).toBe(0);
  });

  it('does not let a pre-reset password consume an invite after the password reset wins the user lock', async () => {
    const first = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(first.invite))
      .expect(201);
    const second = await setupTenantWithInvite();

    await request(app.getHttpServer())
      .post('/v1/auth/password-reset/request')
      .send({ email: 'new@member.test' })
      .expect(200);
    const resetNotification = await prisma.notification.findFirstOrThrow({
      where: { template: 'password_reset' },
      orderBy: { createdAt: 'desc' },
    });
    const resetToken = decryptSecret(
      (resetNotification.payload as { tokenCiphertext: string }).tokenCiphertext,
      authConfig.accessSecret(),
    );

    const privateAuth = authService as unknown as {
      lockUserForAuth: (tx: Prisma.TransactionClient, userId: string) => Promise<void>;
    };
    const originalLock = privateAuth.lockUserForAuth.bind(privateAuth);
    let firstLockReached!: () => void;
    let releaseFirstLock!: () => void;
    const firstLock = new Promise<void>((resolve) => {
      firstLockReached = resolve;
    });
    const releaseLock = new Promise<void>((resolve) => {
      releaseFirstLock = resolve;
    });
    let holdFirstLock = true;
    const lockSpy = jest.spyOn(privateAuth, 'lockUserForAuth').mockImplementation(async (tx, userId) => {
      if (holdFirstLock) {
        holdFirstLock = false;
        firstLockReached();
        await releaseLock;
      }
      await originalLock(tx, userId);
    });

    try {
      const oldPasswordRegistration = request(app.getHttpServer())
        .post('/v1/auth/register-by-invite')
        .send(registerBody(second.invite))
        .then((response) => response);
      await firstLock;

      await request(app.getHttpServer())
        .post('/v1/auth/password-reset/confirm')
        .send({ token: resetToken, newPassword: 'New-Password-42!' })
        .expect(200);

      releaseFirstLock();
      const response = await oldPasswordRegistration;
      expect(response.status).toBe(409);
      expect(response.body.accessToken).toBeUndefined();
      expect(await prisma.membership.count({ where: { userId: reg.body.user.id } })).toBe(1);
      expect(await prisma.invite.findUniqueOrThrow({ where: { id: second.invite.id } })).toMatchObject({
        status: InviteStatus.active,
        usedByMembershipId: null,
      });
      expect(await prisma.refreshToken.count({ where: { userId: reg.body.user.id, revokedAt: null } })).toBe(0);
    } finally {
      releaseFirstLock();
      lockSpy.mockRestore();
    }
  });

  it('invalidates invite-registration credentials when a password reset is queued behind its locked transaction', async () => {
    const first = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(first.invite))
      .expect(201);
    const second = await setupTenantWithInvite();

    await request(app.getHttpServer())
      .post('/v1/auth/password-reset/request')
      .send({ email: 'new@member.test' })
      .expect(200);
    const resetNotification = await prisma.notification.findFirstOrThrow({
      where: { template: 'password_reset' },
      orderBy: { createdAt: 'desc' },
    });
    const resetToken = decryptSecret(
      (resetNotification.payload as { tokenCiphertext: string }).tokenCiphertext,
      authConfig.accessSecret(),
    );

    const privateAuth = authService as unknown as {
      lockUserForAuth: (tx: Prisma.TransactionClient, userId: string) => Promise<void>;
    };
    const originalLock = privateAuth.lockUserForAuth.bind(privateAuth);
    let resetLockAttempted!: () => void;
    const resetLock = new Promise<void>((resolve) => {
      resetLockAttempted = resolve;
    });
    let lockCalls = 0;
    const lockSpy = jest.spyOn(privateAuth, 'lockUserForAuth').mockImplementation(async (tx, userId) => {
      lockCalls += 1;
      if (lockCalls === 2) resetLockAttempted();
      await originalLock(tx, userId);
    });

    const originalCreateUnder = membershipService.createUnder.bind(membershipService);
    let membershipCreated!: () => void;
    let releaseMembershipCreation!: () => void;
    const membershipCreatedPause = new Promise<void>((resolve) => {
      membershipCreated = resolve;
    });
    const releaseMembershipPause = new Promise<void>((resolve) => {
      releaseMembershipCreation = resolve;
    });
    let pauseSecondInvite = true;
    const createSpy = jest.spyOn(membershipService, 'createUnder').mockImplementation(async (tx, params) => {
      const membership = await originalCreateUnder(tx, params);
      if (pauseSecondInvite) {
        pauseSecondInvite = false;
        membershipCreated();
        await releaseMembershipPause;
      }
      return membership;
    });

    try {
      const oldPasswordRegistration = request(app.getHttpServer())
        .post('/v1/auth/register-by-invite')
        .send(registerBody(second.invite))
        .then((response) => response);
      await membershipCreatedPause;

      const reset = request(app.getHttpServer())
        .post('/v1/auth/password-reset/confirm')
        .send({ token: resetToken, newPassword: 'New-Password-42!' })
        .then((response) => response);
      await resetLock;
      releaseMembershipCreation();

      const [registered, resetResponse] = await Promise.all([oldPasswordRegistration, reset]);
      expect(registered.status).toBe(201);
      expect(resetResponse.status).toBe(200);

      const [me, refreshed] = await Promise.all([
        request(app.getHttpServer()).get('/v1/me').set('Authorization', `Bearer ${registered.body.accessToken}`),
        request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: registered.body.refreshToken }),
      ]);
      expect(me.status).toBe(401);
      expect(refreshed.status).toBe(401);
      expect(await prisma.membership.count({ where: { userId: reg.body.user.id } })).toBe(2);
    } finally {
      releaseMembershipCreation();
      createSpy.mockRestore();
      lockSpy.mockRestore();
    }
  });

  it('serializes concurrent direct invite acceptance so only one membership can consume the invite', async () => {
    const { tenant, invite } = await setupTenantWithInvite();
    const privateAuth = authService as unknown as {
      lockInviteForAcceptance: (tx: Prisma.TransactionClient, inviteId: string) => Promise<void>;
    };
    const originalInviteLock = privateAuth.lockInviteForAcceptance.bind(privateAuth);
    let secondInviteLockAttempted!: () => void;
    const secondInviteLock = new Promise<void>((resolve) => {
      secondInviteLockAttempted = resolve;
    });
    let inviteLockCalls = 0;
    const inviteLockSpy = jest.spyOn(privateAuth, 'lockInviteForAcceptance').mockImplementation(async (tx, inviteId) => {
      inviteLockCalls += 1;
      if (inviteLockCalls === 2) secondInviteLockAttempted();
      await originalInviteLock(tx, inviteId);
    });

    const originalCreateUnder = membershipService.createUnder.bind(membershipService);
    let firstMembershipCreated!: () => void;
    let secondMembershipCreated!: () => void;
    let releaseFirstMembership!: () => void;
    const firstMembership = new Promise<void>((resolve) => {
      firstMembershipCreated = resolve;
    });
    const secondMembership = new Promise<void>((resolve) => {
      secondMembershipCreated = resolve;
    });
    const releaseFirstMembershipPause = new Promise<void>((resolve) => {
      releaseFirstMembership = resolve;
    });
    let createCalls = 0;
    const createSpy = jest.spyOn(membershipService, 'createUnder').mockImplementation(async (tx, params) => {
      const membership = await originalCreateUnder(tx, params);
      createCalls += 1;
      if (createCalls === 1) {
        firstMembershipCreated();
        await releaseFirstMembershipPause;
      } else if (createCalls === 2) {
        secondMembershipCreated();
      }
      return membership;
    });

    try {
      const first = request(app.getHttpServer())
        .post('/v1/auth/register-by-invite')
        .send(registerBody(invite, 'replay-first@member.test'))
        .then((response) => response);
      await firstMembership;

      const second = request(app.getHttpServer())
        .post('/v1/auth/register-by-invite')
        .send(registerBody(invite, 'replay-second@member.test'))
        .then((response) => response);
      const ordering = await Promise.race([
        secondInviteLock.then(() => 'invite_lock' as const),
        secondMembership.then(() => 'second_membership' as const),
      ]);
      releaseFirstMembership();

      const [firstResponse, secondResponse] = await Promise.all([first, second]);
      expect(ordering).toBe('invite_lock');
      expect(firstResponse.status).toBe(201);
      expect(secondResponse.status).toBe(400);

      const firstUser = await prisma.user.findUniqueOrThrow({ where: { email: 'replay-first@member.test' } });
      const acceptedMembership = await prisma.membership.findUniqueOrThrow({
        where: { tenantId_userId: { tenantId: tenant.id, userId: firstUser.id } },
      });
      expect(await prisma.user.findUnique({ where: { email: 'replay-second@member.test' } })).toBeNull();
      expect(await prisma.membership.count({ where: { tenantId: tenant.id } })).toBe(2);
      expect(await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({
        status: InviteStatus.used,
        usedByMembershipId: acceptedMembership.id,
      });
      expect(await prisma.inviteAcceptanceConsent.findMany({ where: { inviteId: invite.id } })).toEqual([
        expect.objectContaining({
          inviteId: invite.id,
          tenantId: tenant.id,
          userId: firstUser.id,
          membershipId: acceptedMembership.id,
        }),
      ]);
    } finally {
      releaseFirstMembership();
      createSpy.mockRestore();
      inviteLockSpy.mockRestore();
    }
  });

  it('does not create a second membership in the same tenant', async () => {
    const { tenant, root, invite } = await setupTenantWithInvite();
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    const invite2 = await prisma.invite.create({
      data: {
        tenantId: tenant.id,
        inviterMembershipId: root.id,
        code: `INV2-${Date.now()}`,
        expiresAt: new Date(Date.now() + authConfig.inviteTtlMs),
      },
    });
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite2))
      .expect(409);
  });

  it('email verification keeps the token encrypted in the outbox and verifies successfully', async () => {
    const { invite } = await setupTenantWithInvite();
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    const notif = await prisma.notification.findFirstOrThrow({
      where: { template: 'verify_email' },
    });
    const payload = notif.payload as { token?: string; tokenCiphertext: string };
    expect(payload.token).toBeUndefined();
    const token = decryptSecret(payload.tokenCiphertext, authConfig.accessSecret());

    await request(app.getHttpServer()).post('/v1/auth/verify-email').send({ token }).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'new@member.test' } });
    expect(user.emailVerifiedAt).not.toBeNull();

    // The token is single-use.
    await request(app.getHttpServer()).post('/v1/auth/verify-email').send({ token }).expect(400);
  });

  it('atomically consumes an email-verification token when two requests race', async () => {
    const { invite } = await setupTenantWithInvite();
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const notification = await prisma.notification.findFirstOrThrow({
      where: { template: 'verify_email' },
      orderBy: { createdAt: 'desc' },
    });
    const token = decryptSecret(
      (notification.payload as { tokenCiphertext: string }).tokenCiphertext,
      authConfig.accessSecret(),
    );

    const attempts = await Promise.all(
      [1, 2].map(() => request(app.getHttpServer()).post('/v1/auth/verify-email').send({ token })),
    );
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 400]);
    expect(await prisma.userToken.count({ where: { tokenHash: sha256(token), usedAt: { not: null } } })).toBe(1);
  });

  it('database rejects duplicate live user tokens and a pending MFA challenge owned by another user', async () => {
    const { tenant, root, invite } = await setupTenantWithInvite();
    const first = await prisma.user.create({
      data: { email: 'token-first@example.test', passwordHash: 'test-only', fullName: 'Token First' },
    });
    const second = await prisma.user.create({
      data: { email: 'token-second@example.test', passwordHash: 'test-only', fullName: 'Token Second' },
    });
    const expiresAt = new Date(Date.now() + 60_000);
    await prisma.userToken.create({
      data: { userId: first.id, purpose: UserTokenPurpose.email_verify, tokenHash: sha256('live-email-token-one'), expiresAt },
    });
    await expect(
      prisma.userToken.create({
        data: { userId: first.id, purpose: UserTokenPurpose.email_verify, tokenHash: sha256('live-email-token-two'), expiresAt },
      }),
    ).rejects.toThrow();

    const challenge = await prisma.userToken.create({
      data: { userId: first.id, purpose: UserTokenPurpose.login_otp, tokenHash: sha256('owner-bound-challenge'), expiresAt },
    });
    await expect(
      prisma.pendingInviteAcceptance.create({
        data: { userId: second.id, inviteId: invite.id, challengeTokenId: challenge.id },
      }),
    ).rejects.toThrow();
    void tenant;
    void root;
  });

  it('serializes concurrent password-reset issuance into one live reset token', async () => {
    const { invite } = await setupTenantWithInvite();
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    const requests = await Promise.all(
      [1, 2].map(() => request(app.getHttpServer()).post('/v1/auth/password-reset/request').send({ email: 'new@member.test' })),
    );
    expect(requests.map((request) => request.status)).toEqual([200, 200]);
    expect(
      await prisma.userToken.count({ where: { purpose: UserTokenPurpose.password_reset, usedAt: null } }),
    ).toBe(1);
  });

  it('password reset revokes old sessions and allows login with the new password', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    // Unknown and known emails return the same response to prevent enumeration.
    await request(app.getHttpServer())
      .post('/v1/auth/password-reset/request')
      .send({ email: 'missing@person.test' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/password-reset/request')
      .send({ email: 'new@member.test' })
      .expect(200);

    const notif = await prisma.notification.findFirstOrThrow({
      where: { template: 'password_reset' },
    });
    const payload = notif.payload as { token?: string; tokenCiphertext: string };
    expect(payload.token).toBeUndefined();
    const token = decryptSecret(payload.tokenCiphertext, authConfig.accessSecret());

    const newPassword = 'Brand-New-Password-2026!';
    await request(app.getHttpServer())
      .post('/v1/auth/password-reset/confirm')
      .send({ token, newPassword })
      .expect(200);

    // The old refresh token is no longer valid.
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.body.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(401);

    // The old password fails, the new password succeeds.
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'new@member.test', password: PASSWORD })
      .expect(401);
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'new@member.test', password: newPassword })
      .expect(200);
  });
});
