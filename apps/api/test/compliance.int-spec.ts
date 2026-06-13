import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { EngineService } from '../src/engine/engine.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 3 — uyum: 1099-NEC vergi raporu + GDPR DSAR export. */
describe('compliance: 1099 + DSAR (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let engine: EngineService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    engine = moduleRef.get(EngineService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  it('1099: yil ici odenen >= $600 raporlanabilir; DSAR uye verisini dondurur', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: chain[0].id }, data: { role: Role.tenant_owner } });
    const owner = chain[0]; const seller = chain[1];

    // satici kendi $100k satisini yapar → level0 komisyon $5,000 payable → payout (paid)
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);
    await engine.payoutMember({ tenantId: tenant.id, membershipId: seller.id, period: '2026-06' });

    const tok = jwt.sign({ sub: owner.userId, mid: owner.id, tid: tenant.id, role: Role.tenant_owner } as AccessTokenPayload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tok}`);
    const year = new Date().getFullYear();

    const tax = await auth(request(app.getHttpServer()).get(`/v1/admin/tax/1099?year=${year}`)).expect(200);
    const row = tax.body.members.find((m: { membershipId: string }) => m.membershipId === seller.id);
    expect(row).toBeTruthy();
    expect(Number(row.paidCents)).toBeGreaterThanOrEqual(60_000);
    expect(row.reportable).toBe(true);

    const dsar = await auth(request(app.getHttpServer()).get(`/v1/admin/members/${seller.id}/export`)).expect(200);
    expect(dsar.body.profile.membershipId).toBe(seller.id);
    expect(Array.isArray(dsar.body.ledger)).toBe(true);
    expect(dsar.body.ledger.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(dsar.body.payouts)).toBe(true);
  });
});
