import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Platform yuzeyi: kiracci-ustu sirket dizini + drill-in. Yalniz isPlatformAdmin erisir. */
describe('platform companies (entegrasyon)', () => {
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

  afterAll(async () => await app.close());
  beforeEach(async () => await truncateAll(prisma));

  function token(p: Partial<AccessTokenPayload> & { sub: string }): string {
    const payload: AccessTokenPayload = { mid: null, tid: null, role: null, ...p };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  it('platform admin sirketleri + KPI + agi gorur; tenant_owner goremez (403)', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 4);
    await prisma.membership.update({ where: { id: chain[0].id }, data: { role: Role.tenant_owner } });
    const engine = new EngineService(prisma, new RanksService(prisma));
    const sale = await createSale(prisma, tenant.id, chain[3].id, 10_000_000n);
    await engine.approveSale(sale.id);

    const platformUser = await prisma.user.create({
      data: { email: 'plat@test.refearn.local', passwordHash: 'x', fullName: 'Platform', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });

    // sirketler dizini
    const companies = (await request(app.getHttpServer()).get('/v1/platform/companies').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(companies).toHaveLength(1);
    expect(companies[0].id).toBe(tenant.id);
    expect(companies[0].members).toBe(4);
    expect(companies[0].revenueThisMonthCents).toBe('10000000');

    // sirket ozeti
    const detail = (await request(app.getHttpServer()).get(`/v1/platform/companies/${tenant.id}`).set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(detail.kpis.members).toBe(4);
    expect(detail.plan).not.toBeNull();

    // ag (flat nodes)
    const net = (await request(app.getHttpServer()).get(`/v1/platform/companies/${tenant.id}/network`).set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(net).toHaveLength(4);
    expect(net[0]).toHaveProperty('referralCode');

    // tenant_owner platform yuzeyine eremez
    const ownerTok = token({ sub: chain[0].userId, mid: chain[0].id, tid: tenant.id, role: Role.tenant_owner });
    await request(app.getHttpServer()).get('/v1/platform/companies').set('Authorization', `Bearer ${ownerTok}`).expect(403);
  });

  it('C2 billing (manuel): config → fatura → mark-paid → AR; duplicate 409; owner eremez', async () => {
    const tenant = await createTenant(prisma);
    const platformUser = await prisma.user.create({ data: { email: 'plat2@test.refearn.local', passwordHash: 'x', fullName: 'Platform', isPlatformAdmin: true } });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    // config ($99/ay)
    const cfg = (await request(srv).put(`/v1/platform/companies/${tenant.id}/billing`).set('Authorization', `Bearer ${platTok}`).send({ monthlyFeeCents: 9900, active: true }).expect(200)).body;
    expect(cfg.config.monthlyFeeCents).toBe('9900');

    // fatura kes (open)
    const inv = (await request(srv).post(`/v1/platform/companies/${tenant.id}/invoices`).set('Authorization', `Bearer ${platTok}`).send({ period: '2026-06' }).expect(200)).body;
    expect(inv.status).toBe('open');
    expect(inv.amountCents).toBe('9900');

    // ayni donem tekrar → 409
    await request(srv).post(`/v1/platform/companies/${tenant.id}/invoices`).set('Authorization', `Bearer ${platTok}`).send({ period: '2026-06' }).expect(409);

    // AR: acik 9900
    const ar1 = (await request(srv).get('/v1/platform/billing').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(ar1.totals.openCents).toBe('9900');
    expect(ar1.totals.paidCents).toBe('0');

    // odendi (cek referansiyla)
    const paid = (await request(srv).post(`/v1/platform/invoices/${inv.id}/paid`).set('Authorization', `Bearer ${platTok}`).send({ note: 'check #555' }).expect(200)).body;
    expect(paid.status).toBe('paid');
    expect(paid.paidNote).toBe('check #555');

    // AR: artik acik 0, odenen 9900
    const ar2 = (await request(srv).get('/v1/platform/billing').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(ar2.totals.openCents).toBe('0');
    expect(ar2.totals.paidCents).toBe('9900');

    // owner billing'e eremez
    const owner = await prisma.user.create({ data: { email: 'o@test.refearn.local', passwordHash: 'x', fullName: 'O' } });
    const m = await prisma.membership.create({ data: { tenantId: tenant.id, userId: owner.id, role: Role.tenant_owner, referralCode: 'O1', path: 'x', depth: 0 } });
    const ownerTok = token({ sub: owner.id, mid: m.id, tid: tenant.id, role: Role.tenant_owner });
    await request(srv).get('/v1/platform/billing').set('Authorization', `Bearer ${ownerTok}`).expect(403);
  });

  it('C1: platform admin sirketi askiya alir / aktive eder (audit)', async () => {
    const tenant = await createTenant(prisma);
    const platformUser = await prisma.user.create({ data: { email: 'plat3@test.refearn.local', passwordHash: 'x', fullName: 'Platform', isPlatformAdmin: true } });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    await request(srv).patch(`/v1/platform/companies/${tenant.id}/status`).set('Authorization', `Bearer ${platTok}`).send({ status: 'suspended' }).expect(200);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('suspended');

    await request(srv).patch(`/v1/platform/companies/${tenant.id}/status`).set('Authorization', `Bearer ${platTok}`).send({ status: 'active' }).expect(200);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('active');

    const audit = await prisma.auditLog.count({ where: { tenantId: tenant.id, action: { startsWith: 'platform.tenant_' } } });
    expect(audit).toBe(2);
  });
});
