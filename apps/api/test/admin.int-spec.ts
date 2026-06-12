import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { MembershipStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { EngineService } from '../src/engine/engine.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Admin uye yonetimi + agac + dashboard (SPEC 9). */
describe('admin members/tree/dashboard (entegrasyon)', () => {
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
    const payload: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  async function setup() {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 4);
    await prisma.membership.update({ where: { id: chain[0].id }, data: { role: Role.tenant_owner } });
    return { tenant, chain, owner: chain[0] };
  }

  it('members list + tree: tenant uyeleri, sponsor/depth', async () => {
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

  it('admin davet olusturur (sponsor secili); davet kodu doner', async () => {
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

  it('pasiflestir/aktiflestir + rol degistir; owner rolu degistirilemez', async () => {
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
      .post(`/v1/admin/members/${target.id}/role`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ role: 'tenant_staff' })
      .expect(200);
    m = await prisma.membership.findUniqueOrThrow({ where: { id: target.id } });
    expect(m.role).toBe(Role.tenant_staff);

    // owner'in rolu bu uctan degistirilemez
    await request(app.getHttpServer())
      .post(`/v1/admin/members/${owner.id}/role`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ role: 'member' })
      .expect(400);

    // audit kaydi olustu
    const audits = await prisma.auditLog.count({ where: { tenantId: tenant.id, action: { startsWith: 'membership.' } } });
    expect(audits).toBeGreaterThanOrEqual(3);
  });

  it('dashboard: ciro/komisyon/uye/payable bu ay', async () => {
    const { tenant, chain, owner } = await setup();
    const tok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const engine = new EngineService(prisma);

    // satici chain[3], 3 ust var → tum havuz dagilmaz; ciro 100k, komisyon = L0..L3
    const sale = await createSale(prisma, tenant.id, chain[3].id, 10_000_000n);
    await engine.approveSale(sale.id);

    const dash = await request(app.getHttpServer())
      .get('/v1/admin/dashboard')
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);

    expect(dash.body.members.total).toBe(4);
    expect(dash.body.thisMonth.approvedSalesCount).toBe(1);
    expect(dash.body.thisMonth.revenueCents).toBe('10000000');
    // 4 seviye dolu: 500+200+150+100 bps = 950.000 cent
    expect(dash.body.thisMonth.commissionCents).toBe('950000');
    expect(dash.body.outstandingPayableCents).toBe('950000');
  });

  it('analytics: zaman serisi + totals + funnel + top performers + onceki donem', async () => {
    const { tenant, chain, owner } = await setup();
    const tok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const engine = new EngineService(prisma);

    const sale = await createSale(prisma, tenant.id, chain[3].id, 10_000_000n);
    await engine.approveSale(sale.id);

    const res = await request(app.getHttpServer())
      .get('/v1/admin/analytics?months=6')
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);

    expect(res.body.range.months).toBe(6);
    expect(res.body.series).toHaveLength(6);
    // bu ay (serinin sonu) ciro/komisyon dolu, onceki aylar bos
    const cur = res.body.series[5];
    expect(cur.revenueCents).toBe('10000000');
    expect(cur.commissionCents).toBe('950000');
    expect(cur.approvedSales).toBe(1);

    expect(res.body.totals.revenueCents).toBe('10000000');
    expect(res.body.totals.commissionCents).toBe('950000');
    expect(res.body.totals.effectiveRateBps).toBe(950);

    // onceki esit donem bos → yuzde delta null (yeni)
    expect(res.body.previous.revenueCents).toBe('0');
    expect(res.body.deltas.revenuePct).toBeNull();

    // huni: 1 onayli satis
    expect(res.body.funnel.approved.count).toBe(1);
    expect(res.body.funnel.draft.count).toBe(0);

    // top performers: satici chain[3]
    expect(res.body.topPerformers[0].membershipId).toBe(chain[3].id);
    expect(res.body.topPerformers[0].revenueCents).toBe('10000000');
    expect(res.body.topPerformers[0].salesCount).toBe(1);

    // member rolu goremez
    const member = token({ userId: chain[3].userId, membershipId: chain[3].id, tenantId: tenant.id, role: Role.member });
    await request(app.getHttpServer()).get('/v1/admin/analytics').set('Authorization', `Bearer ${member}`).expect(403);
  });

  it('tenant izolasyonu: baska tenant uyeligi pasiflestirilemez (404)', async () => {
    const t1 = await setup();
    const tok = token({ userId: t1.owner.userId, membershipId: t1.owner.id, tenantId: t1.tenant.id, role: Role.tenant_owner });

    const t2 = await setup();
    await request(app.getHttpServer())
      .post(`/v1/admin/members/${t2.chain[1].id}/deactivate`)
      .set('Authorization', `Bearer ${tok}`)
      .expect(404);
  });

  it('member rolu admin uctan list/dashboard goremez (403)', async () => {
    const { tenant, chain } = await setup();
    const member = chain[3];
    const tok = token({ userId: member.userId, membershipId: member.id, tenantId: tenant.id, role: Role.member });
    await request(app.getHttpServer()).get('/v1/admin/members').set('Authorization', `Bearer ${tok}`).expect(403);
    await request(app.getHttpServer()).get('/v1/admin/dashboard').set('Authorization', `Bearer ${tok}`).expect(403);
  });
});
