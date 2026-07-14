import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { LedgerStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { EngineService } from '../src/engine/engine.service';
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
    const engine = new EngineService(prisma);
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
      select: { amountCents: true, sale: { select: { currency: true } } },
    });
    const expectedPayable = new Map<string, bigint>();
    for (const entry of payableEntries) {
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
});
