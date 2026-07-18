import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { MembershipStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Admin member management, tree, and dashboard (SPEC 9). */
describe('admin members/tree/dashboard (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  function token(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const payload: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role, authGeneration: 1 };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  async function setup() {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 4);
    await prisma.membership.update({ where: { id: chain[0].id }, data: { role: Role.tenant_owner } });
    return { tenant, chain, owner: chain[0] };
  }

  it('members list + tree: tenant members, sponsor/depth', async () => {
    const { tenant, chain, owner } = await setup();
    const tok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const list = await request(app.getHttpServer())
      .get('/v1/admin/members')
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);
    expect(list.body.total).toBe(4);

    const tree = await request(app.getHttpServer())
      .get('/v1/admin/members/tree')
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);
    expect(tree.body).toHaveLength(4);
    const root = tree.body.find((n: { parentId: string | null }) => n.parentId === null);
    expect(root.id).toBe(owner.id);
    const child = tree.body.find((n: { id: string }) => n.id === chain[1].id);
    expect(child.parentId).toBe(owner.id);
  });

  it('creates an admin invite with selected sponsor and returns invite code', async () => {
    const { tenant, chain, owner } = await setup();
    const tok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const res = await request(app.getHttpServer())
      .post('/v1/admin/members/invite')
      .set('Authorization', `Bearer ${tok}`)
      .send({ sponsorReferralCode: chain[2].referralCode })
      .expect(200);
    expect(res.body.code).toHaveLength(10);
    expect(res.body.inviterMembershipId).toBe(chain[2].id);
  });

  it('admin invite retries are idempotent for a selected sponsor and reject a changed payload', async () => {
    const { tenant, chain, owner } = await setup();
    const ownerToken = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sponsor = chain[2];
    const idempotencyKey = 'admin-invite-idempotency-key-0123456789';
    const baseRequest = {
      sponsorMembershipId: sponsor.id,
      email: 'ADMIN-RETRY@EXAMPLE.TEST',
    };

    const first = await request(app.getHttpServer())
      .post('/v1/admin/members/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(baseRequest)
      .expect(200);
    const replay = await request(app.getHttpServer())
      .post('/v1/admin/members/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...baseRequest, email: 'admin-retry@example.test' })
      .expect(200);

    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.inviterMembershipId).toBe(sponsor.id);
    expect(await prisma.invite.count({ where: { inviterMembershipId: sponsor.id } })).toBe(1);

    await request(app.getHttpServer())
      .post('/v1/admin/members/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...baseRequest, email: 'different-admin-retry@example.test' })
      .expect(409);

    await request(app.getHttpServer())
      .post('/v1/admin/members/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', 'too-short')
      .send({ sponsorMembershipId: sponsor.id, email: 'invalid-key-admin-retry@example.test' })
      .expect(400);
  });

  it('admin invite route preserves authorization and enforces the daily invite cap', async () => {
    const { tenant, chain, owner } = await setup();
    const ownerToken = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    for (let i = 0; i < 20; i++) {
      await request(app.getHttpServer())
        .post('/v1/admin/members/invite')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: `admin-daily-cap-${i}@example.test` })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post('/v1/admin/members/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'admin-daily-cap-overflow@example.test' })
      .expect(400);
    expect(await prisma.invite.count({ where: { inviterMembershipId: owner.id } })).toBe(20);

    const member = chain[1];
    const memberToken = token({ userId: member.userId, membershipId: member.id, tenantId: tenant.id, role: Role.member });
    await request(app.getHttpServer())
      .post('/v1/admin/members/invite')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ email: 'member-not-authorized@example.test' })
      .expect(403);
  });

  it('admin invite route enforces the active invite cap outside the daily window', async () => {
    const { tenant, owner } = await setup();
    const ownerToken = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const now = Date.now();
    await prisma.invite.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        tenantId: tenant.id,
        inviterMembershipId: owner.id,
        code: `ADMIN-ACTIVE-${index}-${now}`,
        expiresAt: new Date(now + 60 * 60 * 1000),
        createdAt: new Date(now - 25 * 60 * 60 * 1000),
      })),
    });

    await request(app.getHttpServer())
      .post('/v1/admin/members/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'admin-active-cap-overflow@example.test' })
      .expect(400);
    expect(await prisma.invite.count({ where: { inviterMembershipId: owner.id } })).toBe(50);
  });

  it('redacts invitee email from stored and viewed admin invite audits', async () => {
    const { tenant, owner } = await setup();
    const ownerToken = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const inviteeEmail = 'private-admin-invitee@example.test';

    const created = await request(app.getHttpServer())
      .post('/v1/admin/members/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: inviteeEmail })
      .expect(200);
    const stored = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: tenant.id, action: 'invite.create', entityId: created.body.id },
    });
    expect(stored.after).not.toHaveProperty('email');
    expect((stored.after as Record<string, unknown>).emailFingerprint).toEqual(expect.any(String));

    const legacyEmail = 'legacy-admin-invitee@example.test';
    const legacy = await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: owner.userId,
        action: 'invite.create',
        entity: 'invite',
        entityId: created.body.id,
        after: { sponsorId: owner.id, email: legacyEmail },
      },
    });
    const audit = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const viewedLegacy = audit.body.items.find((item: { id: string }) => item.id === legacy.id);
    expect(viewedLegacy.after.email).toBeUndefined();
    expect(viewedLegacy.after.emailFingerprint).toEqual(expect.any(String));
    expect(JSON.stringify(viewedLegacy)).not.toContain(legacyEmail);
  });

  it('deactivates/reactivates and assigns canonical roles, while self-changes remain forbidden', async () => {
    const { tenant, chain, owner } = await setup();
    const tok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const target = chain[2];

    await request(app.getHttpServer())
      .post(`/v1/admin/members/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);
    let m = await prisma.membership.findUniqueOrThrow({ where: { id: target.id } });
    expect(m.status).toBe(MembershipStatus.inactive);

    await request(app.getHttpServer())
      .post(`/v1/admin/members/${target.id}/activate`)
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);
    m = await prisma.membership.findUniqueOrThrow({ where: { id: target.id } });
    expect(m.status).toBe(MembershipStatus.active);

    await request(app.getHttpServer())
      .patch(`/v1/admin/people/${target.id}/role`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ tier: 'tenant_staff' })
      .expect(200);
    m = await prisma.membership.findUniqueOrThrow({ where: { id: target.id } });
    expect(m.role).toBe(Role.tenant_staff);

    // Canonical role assignment prevents self-changes before considering the target's tier.
    await request(app.getHttpServer())
      .patch(`/v1/admin/people/${owner.id}/role`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ tier: 'member' })
      .expect(403);

    // Audit records were created.
    const audits = await prisma.auditLog.count({ where: { tenantId: tenant.id, action: { startsWith: 'membership.' } } });
    expect(audits).toBeGreaterThanOrEqual(3);
  });

  it('dashboard: revenue/commission/member/payable for this month', async () => {
    const { tenant, chain, owner } = await setup();
    const tok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const engine = new EngineService(prisma, undefined, new RanksService(prisma));

    // Seller is chain[3] with 3 uplines, so the full pool is not distributed; revenue is 100k, commission is L0..L3.
    const sale = await createSale(prisma, tenant.id, chain[3].id, 10_000_000n);
    await engine.approveSale(sale.id);

    const dash = await request(app.getHttpServer())
      .get('/v1/admin/dashboard')
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);

    expect(dash.body.members.total).toBe(4);
    expect(dash.body.thisMonth.approvedSalesCount).toBe(1);
    expect(dash.body.thisMonth.revenueCents).toBe('10000000');
    // Four levels are filled: 500+200+150+100 bps = 950,000 cents.
    expect(dash.body.thisMonth.commissionCents).toBe('950000');
    expect(dash.body.outstandingPayableCents).toBe('950000');
  });

  it('analytics: time series, totals, funnel, top performers, and previous period', async () => {
    const { tenant, chain, owner } = await setup();
    const tok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const engine = new EngineService(prisma, undefined, new RanksService(prisma));

    const sale = await createSale(prisma, tenant.id, chain[3].id, 10_000_000n);
    await engine.approveSale(sale.id);

    const res = await request(app.getHttpServer())
      .get('/v1/admin/analytics?months=6')
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);

    expect(res.body.range.months).toBe(6);
    expect(res.body.series).toHaveLength(6);
    // This month, the end of the series, has revenue/commission; previous months are empty.
    const cur = res.body.series[5];
    expect(cur.revenueCents).toBe('10000000');
    expect(cur.commissionCents).toBe('950000');
    expect(cur.approvedSales).toBe(1);

    expect(res.body.totals.revenueCents).toBe('10000000');
    expect(res.body.totals.commissionCents).toBe('950000');
    expect(res.body.totals.effectiveRateBps).toBe(950);

    // Previous same-length period is empty, so percentage delta is null for a new series.
    expect(res.body.previous.revenueCents).toBe('0');
    expect(res.body.deltas.revenuePct).toBeNull();

    // Funnel: 1 approved sale.
    expect(res.body.funnel.approved.count).toBe(1);
    expect(res.body.funnel.draft.count).toBe(0);

    // Top performer: seller chain[3].
    expect(res.body.topPerformers[0].membershipId).toBe(chain[3].id);
    expect(res.body.topPerformers[0].revenueCents).toBe('10000000');
    expect(res.body.topPerformers[0].salesCount).toBe(1);

    // Member role cannot view this endpoint.
    const member = token({ userId: chain[3].userId, membershipId: chain[3].id, tenantId: tenant.id, role: Role.member });
    await request(app.getHttpServer()).get('/v1/admin/analytics').set('Authorization', `Bearer ${member}`).expect(403);
  });

  it('tenant isolation: cannot deactivate another tenant membership (404)', async () => {
    const t1 = await setup();
    const tok = token({ userId: t1.owner.userId, membershipId: t1.owner.id, tenantId: t1.tenant.id, role: Role.tenant_owner });

    const t2 = await setup();
    await request(app.getHttpServer())
      .post(`/v1/admin/members/${t2.chain[1].id}/deactivate`)
      .set('Authorization', `Bearer ${tok}`)
      .expect(404);
  });

  it('member role cannot view admin list/dashboard endpoints (403)', async () => {
    const { tenant, chain } = await setup();
    const member = chain[3];
    const tok = token({ userId: member.userId, membershipId: member.id, tenantId: tenant.id, role: Role.member });
    await request(app.getHttpServer()).get('/v1/admin/members').set('Authorization', `Bearer ${tok}`).expect(403);
    await request(app.getHttpServer()).get('/v1/admin/dashboard').set('Authorization', `Bearer ${tok}`).expect(403);
  });
});
