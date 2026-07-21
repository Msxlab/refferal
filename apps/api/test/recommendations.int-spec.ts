import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  InviteStatus,
  LedgerStatus,
  LedgerType,
  Membership,
  PayoutMethod,
  PayoutSettlementBatchStatus,
  PayoutStatus,
  Role,
  SaleStatus,
  TenantStatus,
} from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { monthKey } from '../src/engine/month';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, seedReadyPayoutCompliance, truncateAll } from './helpers';

describe('next best action recommendations (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let roleSequence = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => app.close());
  beforeEach(async () => truncateAll(prisma));

  function membershipToken(membership: Membership, role: Role): string {
    const payload: AccessTokenPayload = {
      sub: membership.userId,
      mid: membership.id,
      tid: membership.tenantId,
      role,
      authGeneration: 1,
    };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  function platformToken(userId: string): string {
    const payload: AccessTokenPayload = {
      sub: userId,
      mid: null,
      tid: null,
      role: null,
      plat: true,
      authGeneration: 1,
    };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  async function assignStaffPermissions(membership: Membership, permissions: string[]) {
    const role = await prisma.tenantRole.create({
      data: {
        tenantId: membership.tenantId,
        key: `recommendations_staff_${++roleSequence}`,
        name: `Recommendations Staff ${roleSequence}`,
        permissions,
      },
    });
    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: Role.tenant_staff, roleId: role.id },
    });
    return role;
  }

  async function createPayableLedger(params: { tenantId: string; membershipId: string; amountCents: bigint }) {
    const sale = await prisma.sale.create({
      data: {
        tenantId: params.tenantId,
        sellerMembershipId: params.membershipId,
        amountCents: params.amountCents,
        customerRef: 'private-customer-reference',
        externalRef: 'private-external-reference',
        saleDate: new Date(),
        status: SaleStatus.approved,
      },
    });
    return prisma.ledgerEntry.create({
      data: {
        tenantId: params.tenantId,
        saleId: sale.id,
        beneficiaryMembershipId: params.membershipId,
        level: 0,
        rateBpsUsed: 1,
        amountCents: params.amountCents,
        type: LedgerType.commission,
        status: LedgerStatus.payable,
      },
    });
  }

  function itemKeys(body: { items: Array<{ key: string }> }): string[] {
    return body.items.map((item) => item.key);
  }

  function findItem(body: { items: Array<{ key: string }> }, key: string) {
    return body.items.find((item) => item.key === key);
  }

  function assertPrivateShape(body: {
    scope: string;
    policyVersion: string;
    generatedAt: string;
    items: Array<Record<string, unknown>>;
  }) {
    expect(Object.keys(body).sort()).toEqual(['generatedAt', 'items', 'policyVersion', 'scope']);
    expect(body.policyVersion).toBe('v1');
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(['action', 'body', 'key', 'label', 'title']);
      for (const messageKey of ['title', 'body']) {
        const message = item[messageKey] as Record<string, unknown>;
        expect(Object.keys(message).sort()).toEqual(['key', 'params']);
        expect(typeof message.key).toBe('string');
        expect(Object.keys(message.params as Record<string, unknown>).every((key) => key === 'count' || key === 'oldestAgeHours')).toBe(true);
      }
      if (item.label !== null) {
        const label = item.label as Record<string, unknown>;
        expect(Object.keys(label).sort()).toEqual(['key', 'params']);
      }
      if (item.action !== null) {
        const action = item.action as Record<string, unknown>;
        expect(Object.keys(action).sort()).toEqual(['path', 'type']);
        expect(action.type).toBe('navigate');
        expect(['/app/wallet', '/app/invite', '/mfa-setup', '/admin/sales', '/admin/payouts', '/platform']).toContain(action.path);
      }
    }
  }

  it('enforces scoped access and serves the platform aggregate only to platform administrators', async () => {
    await request(app.getHttpServer()).get('/v1/app/recommendations').expect(401);
    await request(app.getHttpServer()).get('/v1/admin/recommendations').expect(401);
    await request(app.getHttpServer()).get('/v1/platform/recommendations').expect(401);

    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    const memberToken = membershipToken(member, Role.member);

    const appResponse = await request(app.getHttpServer())
      .get('/v1/app/recommendations')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    expect(appResponse.headers['cache-control']).toBe('private, no-store');
    expect(appResponse.body.scope).toBe('member');
    await request(app.getHttpServer())
      .get('/v1/admin/recommendations')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/v1/platform/recommendations')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);

    const platformUser = await prisma.user.create({
      data: { email: 'platform-recommendations@test.refearn.local', passwordHash: 'test-only', fullName: 'Platform', isPlatformAdmin: true },
    });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: TenantStatus.suspended } });
    const platformResponse = await request(app.getHttpServer())
      .get('/v1/platform/recommendations')
      .set('Authorization', `Bearer ${platformToken(platformUser.id)}`)
      .expect(200);
    expect(platformResponse.body.scope).toBe('platform');
    expect(itemKeys(platformResponse.body)).toEqual(['platform.tenants.suspended']);
    expect(findItem(platformResponse.body, 'platform.tenants.suspended')).toMatchObject({
      action: { type: 'navigate', path: '/platform' },
      body: { params: { count: 1 } },
    });
  });

  it('uses live permissions, tenant-scoped aggregates, static order, and a three-item maximum for tenant recommendations', async () => {
    const tenant = await createTenant(prisma);
    const [owner, staff] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const staffRole = await assignStaffPermissions(staff, ['sales.view', 'payouts.view']);

    const otherTenant = await createTenant(prisma);
    const [otherMember] = await createChain(prisma, otherTenant.id, 1);
    const now = new Date();
    await prisma.sale.createMany({
      data: [
        { tenantId: tenant.id, sellerMembershipId: staff.id, amountCents: 1n, saleDate: new Date(now.getTime() - 30 * 3_600_000), status: SaleStatus.draft },
        { tenantId: tenant.id, sellerMembershipId: staff.id, amountCents: 1n, saleDate: new Date(now.getTime() - 29 * 3_600_000), status: SaleStatus.approved, approvedAt: now },
        { tenantId: otherTenant.id, sellerMembershipId: otherMember.id, amountCents: 1n, saleDate: now, status: SaleStatus.draft },
        { tenantId: otherTenant.id, sellerMembershipId: otherMember.id, amountCents: 1n, saleDate: now, status: SaleStatus.draft },
      ],
    });
    const period = monthKey(now, tenant.timezone);
    await prisma.payoutSettlementBatch.create({
      data: {
        tenantId: tenant.id,
        period,
        method: PayoutMethod.manual,
        status: PayoutSettlementBatchStatus.processing,
        processingStartedAt: new Date(now.getTime() - 25 * 3_600_000),
      },
    });
    await prisma.payout.create({
      data: { tenantId: tenant.id, membershipId: owner.id, totalCents: 1n, period, method: PayoutMethod.manual, status: PayoutStatus.requested },
    });

    const staffToken = membershipToken(staff, Role.tenant_staff);
    const staffResponse = await request(app.getHttpServer())
      .get('/v1/admin/recommendations')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(itemKeys(staffResponse.body)).toEqual(['tenant.sales.draft', 'tenant.sales.delivery_pending']);
    expect(findItem(staffResponse.body, 'tenant.sales.draft')).toMatchObject({
      action: { type: 'navigate', path: '/admin/sales' },
      body: { params: { count: 1 } },
    });
    expect(itemKeys(staffResponse.body)).not.toContain('tenant.payouts.processing_stale');
    expect(itemKeys(staffResponse.body)).not.toContain('tenant.payouts.requested');

    await prisma.tenantRole.update({ where: { id: staffRole.id }, data: { permissions: [] } });
    const removedPermissionResponse = await request(app.getHttpServer())
      .get('/v1/admin/recommendations')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(removedPermissionResponse.body.items).toEqual([]);

    const ownerResponse = await request(app.getHttpServer())
      .get('/v1/admin/recommendations')
      .set('Authorization', `Bearer ${membershipToken(owner, Role.tenant_owner)}`)
      .expect(200);
    expect(ownerResponse.body.items).toHaveLength(3);
    expect(itemKeys(ownerResponse.body)).toEqual([
      'tenant.payouts.processing_stale',
      'tenant.payouts.requested',
      'tenant.sales.draft',
    ]);
    expect(findItem(ownerResponse.body, 'tenant.sales.draft')).toMatchObject({ body: { params: { count: 1 } } });
  });

  it('uses WalletService payout eligibility, suppresses lower-priority payout prompts, and returns no sensitive or monetary data', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { payoutMinCents: 1n } });
    const [member] = await createChain(prisma, tenant.id, 1);
    const enormousAmount = 9_007_199_254_740_993n;
    await createPayableLedger({ tenantId: tenant.id, membershipId: member.id, amountCents: enormousAmount });
    await seedReadyPayoutCompliance(prisma, tenant.id, member.id, member.userId);
    const now = new Date();
    const period = monthKey(now, tenant.timezone);
    const processing = await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        membershipId: member.id,
        totalCents: 1n,
        period,
        method: PayoutMethod.manual,
        status: PayoutStatus.processing,
        recipientEmail: 'private-recipient@example.test',
        settlementEvidence: 'private-settlement-evidence',
      },
    });
    await prisma.invite.create({
      data: {
        tenantId: tenant.id,
        inviterMembershipId: member.id,
        code: 'PRIVATE-REFERRAL-CODE',
        email: 'private-invite@example.test',
        expiresAt: new Date(now.getTime() + 3_600_000),
        status: InviteStatus.active,
      },
    });

    const token = membershipToken(member, Role.member);
    const processingResponse = await request(app.getHttpServer())
      .get('/v1/app/recommendations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(itemKeys(processingResponse.body)).toEqual([
      'member.payout.processing',
      'member.invites.expiring',
      'member.mfa.setup',
    ]);
    expect(itemKeys(processingResponse.body)).not.toContain('member.payout.requested');
    expect(itemKeys(processingResponse.body)).not.toContain('member.payout.requestable');
    expect(findItem(processingResponse.body, 'member.payout.processing')).toMatchObject({ action: { type: 'navigate', path: '/app/wallet' } });

    await prisma.payout.update({ where: { id: processing.id }, data: { status: PayoutStatus.paid } });
    const requested = await prisma.payout.create({
      data: { tenantId: tenant.id, membershipId: member.id, totalCents: 1n, period, method: PayoutMethod.manual, status: PayoutStatus.requested },
    });
    const requestedResponse = await request(app.getHttpServer())
      .get('/v1/app/recommendations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(itemKeys(requestedResponse.body)).toContain('member.payout.requested');
    expect(itemKeys(requestedResponse.body)).not.toContain('member.payout.requestable');

    await prisma.payout.update({ where: { id: requested.id }, data: { status: PayoutStatus.paid } });
    const before = await Promise.all([
      prisma.auditLog.count(),
      prisma.notification.count(),
      prisma.ledgerEntry.count(),
      prisma.payout.count(),
      prisma.invite.count(),
    ]);
    const requestableResponse = await request(app.getHttpServer())
      .get('/v1/app/recommendations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(itemKeys(requestableResponse.body)).toContain('member.payout.requestable');
    assertPrivateShape(requestableResponse.body);
    const serialized = JSON.stringify(requestableResponse.body);
    for (const forbidden of [
      member.id,
      member.userId,
      'PRIVATE-REFERRAL-CODE',
      'private-invite@example.test',
      'private-recipient@example.test',
      'private-customer-reference',
      'private-external-reference',
      'private-settlement-evidence',
      enormousAmount.toString(),
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/(?:amount|balance|cents|currency|evidence|email|referral|customer|external|ip)/i);
    const after = await Promise.all([
      prisma.auditLog.count(),
      prisma.notification.count(),
      prisma.ledgerEntry.count(),
      prisma.payout.count(),
      prisma.invite.count(),
    ]);
    expect(after).toEqual(before);
  });
});
