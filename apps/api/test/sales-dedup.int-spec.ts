import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

/** Feature-gap #1 — duplicate sale detection (externalRef): create 409 + import dedup/skip. */
describe('sales dedup (entegrasyon)', () => {
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
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  function tokenFor(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const p: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  async function setup() {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 3);
    const owner = chain[0];
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    return {
      tenant, chain, owner,
      tok: tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner }),
    };
  }

  it('(b) create with an existing externalRef → 409, no extra sale', async () => {
    const { tenant, chain, tok } = await setup();
    const seller = chain[1];
    const body = { sellerReferralCode: seller.referralCode, amountCents: 100_000, externalRef: 'ORD-1' };

    await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send(body).expect(201);
    const dup = await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send(body).expect(409);
    expect(String(dup.body.message)).toMatch(/external reference/i);

    expect(await prisma.sale.count({ where: { tenantId: tenant.id, externalRef: 'ORD-1' } })).toBe(1);
  });

  it('(a) importing the same file twice → 2nd import creates 0 sales, all rows duplicate', async () => {
    const { tenant, chain, tok } = await setup();
    const csv = [
      'referral_code,amount_cents,external_ref',
      `${chain[1].referralCode},5000000,ORD-A`,
      `${chain[2].referralCode},7500000,ORD-B`,
    ].join('\n');

    const first = (await request(app.getHttpServer()).post('/v1/admin/sales/import').set('Authorization', `Bearer ${tok}`).send({ csv }).expect(200)).body;
    expect(first.created).toBe(2);

    // preview the same file again → both rows flagged duplicate, none ok
    const prev = (await request(app.getHttpServer()).post('/v1/admin/sales/import').set('Authorization', `Bearer ${tok}`).send({ csv, preview: true }).expect(200)).body;
    expect(prev.okCount).toBe(0);
    expect(prev.duplicateCount).toBe(2);
    expect(prev.rows.every((r: { status: string }) => r.status === 'duplicate')).toBe(true);

    // real re-import → zero new sales
    const second = (await request(app.getHttpServer()).post('/v1/admin/sales/import').set('Authorization', `Bearer ${tok}`).send({ csv }).expect(200)).body;
    expect(second.created).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(await prisma.sale.count({ where: { tenantId: tenant.id } })).toBe(2);
  });

  it('(a2) a duplicate externalRef repeated WITHIN the same file is flagged on the 2nd occurrence', async () => {
    const { chain, tok } = await setup();
    const csv = [
      'referral_code,amount_cents,external_ref',
      `${chain[1].referralCode},5000000,ORD-X`,
      `${chain[2].referralCode},7500000,ORD-X`,
    ].join('\n');
    const prev = (await request(app.getHttpServer()).post('/v1/admin/sales/import').set('Authorization', `Bearer ${tok}`).send({ csv, preview: true }).expect(200)).body;
    expect(prev.okCount).toBe(1);
    expect(prev.duplicateCount).toBe(1);
  });

  it('(c) two sales, distinct refs, same amount/date → both allowed (no false positive)', async () => {
    const { tenant, chain, tok } = await setup();
    const base = { amountCents: 250_000, saleDate: '2026-06-01' };
    await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send({ ...base, sellerReferralCode: chain[1].referralCode, externalRef: 'ORD-100' }).expect(201);
    await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send({ ...base, sellerReferralCode: chain[1].referralCode, externalRef: 'ORD-101' }).expect(201);
    expect(await prisma.sale.count({ where: { tenantId: tenant.id } })).toBe(2);
  });

  it('null/blank externalRef never collides', async () => {
    const { tenant, chain, tok } = await setup();
    const body = { sellerReferralCode: chain[1].referralCode, amountCents: 100_000 };
    await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send(body).expect(201);
    await request(app.getHttpServer()).post('/v1/admin/sales').set('Authorization', `Bearer ${tok}`).send(body).expect(201);
    expect(await prisma.sale.count({ where: { tenantId: tenant.id } })).toBe(2);
  });
});
