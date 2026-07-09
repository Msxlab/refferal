import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role, Tenant } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { monthKey } from '../src/engine/month';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

const monthKeyFor = (tz: string) => monthKey(new Date(), tz);

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

    // sirketler dizini (sayfali: { total, rows })
    const companies = (await request(app.getHttpServer()).get('/v1/platform/companies').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(companies.total).toBe(1);
    expect(companies.rows).toHaveLength(1);
    expect(companies.rows[0].id).toBe(tenant.id);
    expect(companies.rows[0].members).toBe(4);
    expect(companies.rows[0].revenueThisMonthCents).toBe('10000000');

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
    await createPlan(prisma, tenant.id); // item 2 (Task 3) activate-gate: aktivasyon icin plan gerekli
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

  it('item 11: paginates, filters by status, and computes revenue in one grouped pass', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-pg@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    // 25 tenants; one gets a current-month approved sale, one is suspended
    const tenants: Tenant[] = [];
    for (let i = 0; i < 25; i++) tenants.push(await createTenant(prisma));
    await prisma.tenant.update({ where: { id: tenants[0].id }, data: { status: 'suspended' } });
    const chain = await createChain(prisma, tenants[1].id, 1);
    const sale = await createSale(prisma, tenants[1].id, chain[0].id, 5_000_000n, { status: 'approved' });
    await prisma.sale.update({
      where: { id: sale.id },
      data: { summaryMonth: monthKeyFor(tenants[1].timezone) },
    });

    // page 1, size 10 → 10 rows, total 25
    const p1 = (await request(srv).get('/v1/platform/companies?page=1&pageSize=10')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(p1.total).toBe(25);
    expect(p1.rows).toHaveLength(10);

    // page 3 → 5 rows
    const p3 = (await request(srv).get('/v1/platform/companies?page=3&pageSize=10')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(p3.rows).toHaveLength(5);

    // status filter
    const suspended = (await request(srv).get('/v1/platform/companies?status=suspended&pageSize=100')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(suspended.total).toBe(1);
    expect(suspended.rows[0].id).toBe(tenants[0].id);

    // revenue attributed to the right tenant (single grouped query)
    const all = (await request(srv).get('/v1/platform/companies?pageSize=100')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    const withRev = all.rows.find((r: { id: string }) => r.id === tenants[1].id);
    expect(withRev.revenueThisMonthCents).toBe('5000000');
  });

  it('item 2: setup_needed enum round-trips and status schema accepts it', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-sn@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const tenant = await prisma.tenant.create({
      data: { slug: 'setup-co', name: 'Setup Co', status: 'setup_needed' },
    });
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('setup_needed');

    // plan gerekli: item 2 (Task 3) activate-gate plansiz aktivasyonu 400'ler; enum round-trip niyeti korunur
    await createPlan(prisma, tenant.id);

    // PATCH status accepts setup_needed → active
    await request(app.getHttpServer())
      .patch(`/v1/platform/companies/${tenant.id}/status`)
      .set('Authorization', `Bearer ${platTok}`)
      .send({ status: 'active' })
      .expect(200);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('active');
  });

  it('item 2: createCompany lands in setup_needed; branding validates; activate blocked without plan', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-wiz@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const created = (await request(srv).post('/v1/platform/companies')
      .set('Authorization', `Bearer ${platTok}`)
      .send({ name: 'Wizard Co', slug: 'wizard-co', currency: 'USD', timezone: 'America/New_York', ownerEmail: 'own@wiz.co', ownerName: 'Owner' })
      .expect(201)).body;
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: created.id } });
    expect(t.status).toBe('setup_needed');

    // company() exposes setup block (has default plan → hasPlan true)
    const detail = (await request(srv).get(`/v1/platform/companies/${created.id}`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(detail.setup).toMatchObject({ hasPlan: true, hasBranding: false });

    // bad hex rejected
    await request(srv).put(`/v1/platform/companies/${created.id}/branding`)
      .set('Authorization', `Bearer ${platTok}`)
      .send({ primaryHex: 'red' }).expect(400);

    // good branding persists
    await request(srv).put(`/v1/platform/companies/${created.id}/branding`)
      .set('Authorization', `Bearer ${platTok}`)
      .send({ primaryHex: '#112233', logoUrl: 'https://cdn.example.com/l.png' }).expect(200);
    const d2 = (await request(srv).get(`/v1/platform/companies/${created.id}`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(d2.setup.hasBranding).toBe(true);

    // activate with plan → allowed
    await request(srv).patch(`/v1/platform/companies/${created.id}/status`)
      .set('Authorization', `Bearer ${platTok}`).send({ status: 'active' }).expect(200);

    // a plan-less tenant cannot be activated
    const bare = await prisma.tenant.create({ data: { slug: 'bare-co', name: 'Bare', status: 'setup_needed' } });
    await request(srv).patch(`/v1/platform/companies/${bare.id}/status`)
      .set('Authorization', `Bearer ${platTok}`).send({ status: 'active' }).expect(400);
  });
});
