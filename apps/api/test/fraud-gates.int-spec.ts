import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AuthService } from '../src/auth/auth.service';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { defaultPermissionsForTier } from '../src/common/permissions';
import { EngineService } from '../src/engine/engine.service';
import { INVITE_DISCLAIMER_VERSION } from '../src/invites/invite-consent';
import { InvitesService } from '../src/invites/invites.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, seedReadyPayoutCompliance, truncateAll } from './helpers';

/** Fraud gates: maker-checker SoD, email verification, invite cap, and security event logging. */
describe('fraud gates (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let engine: EngineService;
  let auth: AuthService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    engine = moduleRef.get(EngineService);
    auth = moduleRef.get(AuthService);
  });

  afterAll(async () => await app.close());
  beforeEach(async () => await truncateAll(prisma));

  function token(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const p: AccessTokenPayload = {
      sub: o.userId,
      mid: o.membershipId,
      tid: o.tenantId,
      role: o.role,
      perms: defaultPermissionsForTier(o.role),
      authGeneration: 1,
    };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  it('SoD: when requireSeparateApprover=true, the sale creator cannot approve; another admin can', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { requireSeparateApprover: true } });
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 3);
    const owner = chain[0];
    const admin2 = chain[1];
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: admin2.id }, data: { role: Role.tenant_admin } });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const admin2Tok = token({ userId: admin2.userId, membershipId: admin2.id, tenantId: tenant.id, role: Role.tenant_admin });

    // Owner creates the sale (createdBy=owner).
    const created = await request(app.getHttpServer())
      .post('/v1/admin/sales')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ sellerReferralCode: chain[2].referralCode, amountCents: 10_000_000 })
      .expect(201);
    const saleId = created.body.id;

    // Owner cannot approve their own sale.
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${saleId}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(403);

    // Another admin can approve.
    const ok = await request(app.getHttpServer())
      .post(`/v1/admin/sales/${saleId}/approve`)
      .set('Authorization', `Bearer ${admin2Tok}`)
      .expect(200);
    expect(ok.body.applied).toBe(true);
  });

  it('SoD off by default: self-approval works but writes security.self_approved_sale to audit', async () => {
    const tenant = await createTenant(prisma); // requireSeparateApprover=false by default
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 2);
    const owner = chain[0];
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const created = await request(app.getHttpServer())
      .post('/v1/admin/sales')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ sellerReferralCode: chain[1].referralCode, amountCents: 1_000_000 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);

    const flag = await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'security.self_approved_sale' } });
    expect(flag).toBe(1);
  });

  it('payout request: unverified email gets 400; verified email passes', async () => {
    const tenant = await createTenant(prisma); // on_approval -> payable
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    const seller = chain[5];
    // Make seller unverified.
    await prisma.user.update({ where: { id: seller.userId }, data: { emailVerifiedAt: null } });

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, chain[0].userId);

    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(400);

    // Verify, then request passes.
    await prisma.user.update({ where: { id: seller.userId }, data: { emailVerifiedAt: new Date() } });
    await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
  });

  it('B2: reviewed payout confirmation rechecks a live fraud flag after the member request', async () => {
    const tenant = await createTenant(prisma); // on_approval → payable
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    const seller = chain[5];
    const owner = chain[0];
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);

    // seller TEMIZ iken payout talebi acar → requested
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const reqRes = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    const payoutId = reqRes.body.id;

    // talepten SONRA fraud flag (skor >= esik) — onaya kadar durum degisti
    await prisma.fraudFlag.create({ data: { tenantId: tenant.id, membershipId: seller.id, score: 80, status: 'open' } });

    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    // The signed batch review rechecks the live fraud gate and cannot reserve funds.
    const scope = { mode: 'selected', membershipIds: [seller.id] };
    const blockedPreview = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches/preview')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope })
      .expect(200);
    expect(blockedPreview.body).toMatchObject({ eligibleCount: 0, excludedCount: 1, totals: [] });
    const blockedConfirmation = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope: blockedPreview.body.normalizedScope, previewToken: blockedPreview.body.previewToken })
      .expect(200);
    expect(blockedConfirmation.body).toMatchObject({
      id: null,
      status: null,
      processingCount: 0,
      skippedCount: 1,
      skipped: [{ membershipId: seller.id, reason: 'payout_not_ready', netCents: '500000' }],
    });

    // odeme hala requested (para cikmadi)
    const stillReq = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(stillReq.status).toBe('requested');

    // A new signed review after the flag is cleared can reserve the requested payout.
    await prisma.fraudFlag.update({ where: { membershipId: seller.id }, data: { status: 'cleared' } });
    const clearedPreview = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches/preview')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope })
      .expect(200);
    const approved = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope: clearedPreview.body.normalizedScope, previewToken: clearedPreview.body.previewToken })
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'processing', processingCount: 1 });
    expect(approved.body.processing).toEqual(expect.arrayContaining([
      expect.objectContaining({ membershipId: seller.id, payoutId }),
    ]));
  });

  it('B2: settlement rechecks a fraud flag raised after a reviewed batch starts', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 2);
    const [owner, seller] = chain;
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);
    await seedReadyPayoutCompliance(prisma, tenant.id, seller.id, owner.userId);

    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const scope = { mode: 'selected', membershipIds: [seller.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches/preview')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope })
      .expect(200);
    const started = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(200);

    await prisma.fraudFlag.create({
      data: { tenantId: tenant.id, membershipId: seller.id, score: 80, status: 'open' },
    });
    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ settlementReference: 'fraud-recheck', settlementEvidence: 'bank-confirmation' })
      .expect(409);

    const payout = await prisma.payout.findFirstOrThrow({ where: { batchId: started.body.id } });
    expect(payout.status).toBe('processing');
    expect(payout.paidAt).toBeNull();
  });

  it('davet cap: gunluk limit asilinca reddedilir', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    const invites = new InvitesService(prisma);

    // 20 invites (daily limit) succeed; the 21st is rejected.
    for (let i = 0; i < 20; i++) {
      await invites.create(member.id);
    }
    await expect(invites.create(member.id)).rejects.toThrow();
  });

  it('invite cap: rejects the 51st unexpired invite outside the daily window', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    const now = Date.now();
    await prisma.invite.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        tenantId: tenant.id,
        inviterMembershipId: member.id,
        code: `ACTIVE-${index}-${now}`,
        expiresAt: new Date(now + 60 * 60 * 1000),
        createdAt: new Date(now - 25 * 60 * 60 * 1000),
      })),
    });

    await expect(new InvitesService(prisma).create(member.id)).rejects.toThrow('at most 50 active invites');
  });

  it('invite quota is serialized: 25 concurrent creates yield exactly 20 active invites', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    const invites = new InvitesService(prisma);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 25 }, (_, index) => invites.create(member.id, { email: `parallel-${index}@example.test` })),
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(20);
    expect(await prisma.invite.count({ where: { inviterMembershipId: member.id } })).toBe(20);
  });

  it('invite idempotency returns the original invite for the same normalized email and conflicts on a different payload', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    const auth = { Authorization: `Bearer ${token({ userId: member.userId, membershipId: member.id, tenantId: tenant.id, role: Role.member })}` };
    const key = 'invite-idempotency-key-0123456789';

    const first = await request(app.getHttpServer())
      .post('/v1/app/invites')
      .set(auth)
      .set('Idempotency-Key', key)
      .send({ email: 'PERSON@EXAMPLE.TEST' })
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post('/v1/app/invites')
      .set(auth)
      .set('Idempotency-Key', key)
      .send({ email: 'person@example.test' })
      .expect(201);
    expect(replay.body.code).toBe(first.body.code);
    expect(await prisma.invite.count({ where: { inviterMembershipId: member.id } })).toBe(1);
    const stored = await prisma.invite.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(stored.idempotencyKeyHash).toEqual(expect.any(String));
    expect(stored.idempotencyKeyHash).not.toBe(key);

    await request(app.getHttpServer())
      .post('/v1/app/invites')
      .set(auth)
      .set('Idempotency-Key', key)
      .send({ email: 'different@example.test' })
      .expect(409);

    await request(app.getHttpServer())
      .post('/v1/app/invites')
      .set(auth)
      .set('Idempotency-Key', 'too-short')
      .send({ email: 'invalid-key@example.test' })
      .expect(400);
  });

  it('expired active invites are cleaned before quota checks', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    const now = Date.now();
    await prisma.invite.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        tenantId: tenant.id,
        inviterMembershipId: member.id,
        code: `EXPIRED-${index}-${now}`,
        expiresAt: new Date(now - 60_000),
        createdAt: new Date(now - 25 * 60 * 60 * 1000),
      })),
    });

    const invite = await new InvitesService(prisma).create(member.id);
    expect(invite.status).toBe('active');
    expect(await prisma.invite.count({ where: { inviterMembershipId: member.id, status: 'expired' } })).toBe(50);
  });

  it('security event: failed login writes keyed PII fingerprints instead of raw email or IP', async () => {
    const tenant = await createTenant(prisma);
    const [m] = await createChain(prisma, tenant.id, 1);
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: m.userId } })).email;
    const ip = '203.0.113.42';

    await expect(auth.login({ email, password: 'definitely-wrong-password' }, { ip })).rejects.toThrow();

    const ev = await prisma.auditLog.findFirst({ where: { action: 'security.login_failed' } });
    expect(ev).not.toBeNull();
    const after = ev!.after as Record<string, string>;
    expect(after.emailFingerprint).toEqual(expect.any(String));
    expect(after.ipFingerprint).toEqual(expect.any(String));
    expect(after.email).toBeUndefined();
    expect(after.ip).toBeUndefined();
    expect(ev!.ip).toBeNull();
  });

  it('invite-registration audit leaves raw IP empty', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [root] = await createChain(prisma, tenant.id, 1);
    const invite = await prisma.invite.create({
      data: {
        tenantId: tenant.id,
        inviterMembershipId: root.id,
        code: 'REDACTED-IP-INVITE',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await auth.registerByInvite(
      {
        inviteCode: invite.code,
        email: 'audit-redaction@example.test',
        password: 'Very-Secret-Password-42!',
        fullName: 'Audit Redaction',
        locale: 'en',
        acceptDisclaimer: true,
        disclaimerVersion: INVITE_DISCLAIMER_VERSION,
        disclaimerLocale: 'en',
      },
      { ip: '198.51.100.17' },
    );
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'membership.register_by_invite' } });
    expect(audit.ip).toBeNull();
    expect(audit.after).not.toHaveProperty('ip');
    expect((audit.after as Record<string, string>).ipFingerprint).toEqual(expect.any(String));
  });
});
