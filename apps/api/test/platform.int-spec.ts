import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { LedgerStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Platform surface: cross-tenant company directory plus drill-in. Only isPlatformAdmin can access it. */
describe('platform companies (integration)', () => {
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
    const payload: AccessTokenPayload = { mid: null, tid: null, role: null, authGeneration: 1, ...p };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  it('platform admin sees companies, KPIs, and networks; tenant_owner gets 403', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 4);
    await prisma.membership.update({ where: { id: chain[0].id }, data: { role: Role.tenant_owner } });
    const engine = new EngineService(prisma, undefined, new RanksService(prisma));
    const sale = await createSale(prisma, tenant.id, chain[3].id, 10_000_000n);
    await engine.approveSale(sale.id);

    const platformUser = await prisma.user.create({
      data: { email: 'plat@test.refearn.local', passwordHash: 'x', fullName: 'Platform', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });

    // Company directory.
    const directory = (await request(app.getHttpServer()).get('/v1/platform/companies').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(directory.companies).toHaveLength(1);
    expect(directory.companies[0].id).toBe(tenant.id);
    expect(directory.companies[0].members).toBe(4);
    expect(directory.companies[0].revenueThisMonthByCurrency).toEqual([
      { currency: 'USD', revenueThisMonthCents: '10000000', salesThisMonth: 1 },
    ]);
    expect(directory.totals.revenueThisMonthByCurrency).toEqual([
      { currency: 'USD', revenueThisMonthCents: '10000000', salesThisMonth: 1 },
    ]);

    // Company summary.
    const detail = (await request(app.getHttpServer()).get(`/v1/platform/companies/${tenant.id}`).set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(detail.kpis.members).toBe(4);
    expect(detail.kpis.revenueThisMonthByCurrency).toEqual([
      { currency: 'USD', revenueThisMonthCents: '10000000', salesThisMonth: 1 },
    ]);
    expect(detail.plan).not.toBeNull();

    // Network as flat nodes.
    const net = (await request(app.getHttpServer()).get(`/v1/platform/companies/${tenant.id}/network`).set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(net).toHaveLength(4);
    expect(net[0]).toHaveProperty('referralCode');

    // tenant_owner cannot access the platform surface.
    const ownerTok = token({ sub: chain[0].userId, mid: chain[0].id, tid: tenant.id, role: Role.tenant_owner });
    await request(app.getHttpServer()).get('/v1/platform/companies').set('Authorization', `Bearer ${ownerTok}`).expect(403);
  });

  it('groups same-tenant revenue by sale currency without producing a mixed-currency total', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { currency: 'EUR' } });
    await createPlan(prisma, tenant.id);
    const [member] = await createChain(prisma, tenant.id, 1);
    const engine = new EngineService(prisma);
    const usdSale = await createSale(prisma, tenant.id, member.id, 12_500n);
    const eurSale = await createSale(prisma, tenant.id, member.id, 7_000n);
    await prisma.sale.update({ where: { id: eurSale.id }, data: { currency: 'EUR' } });
    await engine.approveSale(usdSale.id);
    await engine.approveSale(eurSale.id);

    const platformUser = await prisma.user.create({
      data: { email: 'currency-platform@test.refearn.local', passwordHash: 'x', fullName: 'Currency Platform', isPlatformAdmin: true },
    });
    const platformToken = token({ sub: platformUser.id, plat: true });

    const response = await request(app.getHttpServer())
      .get('/v1/platform/companies')
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    expect(response.body.companies).toHaveLength(1);
    expect(response.body.totals).toEqual(
      expect.objectContaining({ companies: 1, members: 1 }),
    );
    expect(response.body.totals).not.toHaveProperty('revenueThisMonthCents');
    expect(response.body.companies[0].revenueThisMonthByCurrency).toEqual(
      expect.arrayContaining([
        { currency: 'EUR', revenueThisMonthCents: '7000', salesThisMonth: 1 },
        { currency: 'USD', revenueThisMonthCents: '12500', salesThisMonth: 1 },
      ]),
    );
    expect(response.body.totals.revenueThisMonthByCurrency).toEqual(
      expect.arrayContaining([
        { currency: 'EUR', revenueThisMonthCents: '7000', salesThisMonth: 1 },
        { currency: 'USD', revenueThisMonthCents: '12500', salesThisMonth: 1 },
      ]),
    );
    expect(response.body.totals.revenueThisMonthByCurrency).not.toContainEqual(
      expect.objectContaining({ currency: 'USD', revenueThisMonthCents: '19500' }),
    );

    const detail = await request(app.getHttpServer())
      .get(`/v1/platform/companies/${tenant.id}`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    expect(detail.body.kpis.revenueThisMonthByCurrency).toEqual(
      expect.arrayContaining([
        { currency: 'EUR', revenueThisMonthCents: '7000', salesThisMonth: 1 },
        { currency: 'USD', revenueThisMonthCents: '12500', salesThisMonth: 1 },
      ]),
    );
    expect(detail.body.kpis).not.toHaveProperty('outstandingPayableCents');
    const payableEntries = await prisma.ledgerEntry.findMany({
      where: { tenantId: tenant.id, status: LedgerStatus.payable },
      select: { id: true, amountCents: true, sale: { select: { currency: true } } },
    });
    const expectedPayable = new Map<string, bigint>();
    for (const entry of payableEntries) {
      if (!entry.sale) throw new Error(`payable ledger entry ${entry.id} is missing its sale`);
      expectedPayable.set(entry.sale.currency, (expectedPayable.get(entry.sale.currency) ?? 0n) + entry.amountCents);
    }
    expect([...expectedPayable.keys()].sort()).toEqual(['EUR', 'USD']);
    expect(detail.body.kpis.outstandingPayableByCurrency).toEqual(
      [...expectedPayable.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amountCents]) => ({ currency, outstandingPayableCents: amountCents.toString() })),
    );
  });

  it('suspending a tenant invalidates each affected member access credential', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    const platformUser = await prisma.user.create({
      data: { email: 'suspender@test.refearn.local', passwordHash: 'x', fullName: 'Suspender', isPlatformAdmin: true },
    });
    const platformToken = token({ sub: platformUser.id, plat: true });
    const memberToken = token({ sub: member.userId, mid: member.id, tid: tenant.id, role: Role.member });

    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/platform/companies/${tenant.id}/suspend`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ reason: 'Security review' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(401);
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

    const audit = await prisma.auditLog.count({ where: { tenantId: tenant.id, action: { in: ['tenant.suspend', 'tenant.reactivate'] } } });
    expect(audit).toBe(2);
  });
});
