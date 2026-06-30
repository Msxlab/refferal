import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { monthKey } from '../src/engine/month';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlatformAdmin, createPlan, createTenant, truncateAll } from './helpers';

describe('platform HQ (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const PASSWORD = 'Cok-Gizli-Sifre-42!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  async function loginPlatform() {
    await createPlatformAdmin(prisma, PASSWORD, 'plat@test.refearn.local');
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login').send({ email: 'plat@test.refearn.local', password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  it('act-as: platform admin bir sirket icin tenant-scoped god token alir', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const token = await loginPlatform();
    const res = await request(app.getHttpServer())
      .post(`/v1/platform/companies/${tenant.id}/act-as`)
      .set('Authorization', `Bearer ${token}`).expect(201);
    expect(res.body.accessToken).toBeDefined();
    const claims = JSON.parse(Buffer.from(res.body.accessToken.split('.')[1], 'base64').toString());
    expect(claims.tid).toBe(tenant.id);
    expect(claims.role).toBe('tenant_owner');
    expect(claims.plat).toBe(true);
    const audit = await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'platform.act_as' } });
    expect(audit).toBe(1);
  });

  it('act-as: token yoksa 401', async () => {
    const tenant = await createTenant(prisma);
    await request(app.getHttpServer()).post(`/v1/platform/companies/${tenant.id}/act-as`).expect(401);
  });

  it('act-as token /admin rotalarini gecer; duz platform token gecemez', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const platToken = await loginPlatform();

    // duz platform token (tid yok) → /admin reddedilir (uyelik gerekli)
    await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${platToken}`)
      .expect(403);

    // act-as token (tid var) → /admin gecer
    const actAs = await request(app.getHttpServer())
      .post(`/v1/platform/companies/${tenant.id}/act-as`)
      .set('Authorization', `Bearer ${platToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${actAs.body.accessToken}`)
      .expect(200);
  });

  it('overview: portfoy brut/net/odenecek + leaderboard', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [seller] = await createChain(prisma, tenant.id, 1);
    const platToken = await loginPlatform();

    const m = monthKey(new Date(), tenant.timezone);
    const sale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date(), summaryMonth: m, status: SaleStatus.approved },
    });
    await prisma.ledgerEntry.create({
      data: { tenantId: tenant.id, saleId: sale.id, beneficiaryMembershipId: seller.id, level: 0, rateBpsUsed: 500, amountCents: 5_000n, type: LedgerType.commission, status: LedgerStatus.payable },
    });

    const res = await request(app.getHttpServer())
      .get('/v1/platform/overview').set('Authorization', `Bearer ${platToken}`).expect(200);

    expect(res.body.totals.grossRevenueCents).toBe('100000');
    expect(res.body.totals.netCents).toBe('95000');
    expect(res.body.totals.payableCents).toBe('5000');
    expect(res.body.totals.companies).toBe(1);
    expect(res.body.leaderboard[0]).toMatchObject({ id: tenant.id, revenueThisMonthCents: '100000' });
    expect(res.body.attention).toBeDefined();
  });

  it('overview: token yoksa 401', async () => {
    await request(app.getHttpServer()).get('/v1/platform/overview').expect(401);
  });
});
