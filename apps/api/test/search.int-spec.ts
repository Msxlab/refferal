import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 2 #19 — global arama (Cmd+K kaynagi): tenant-scoped uye + satis. */
describe('search (entegrasyon)', () => {
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

  it('uye kodu/adi ve satis customerRef ile bulur; <2 harf bos doner', async () => {
    const tenant = await createTenant(prisma);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const code = (await prisma.membership.findUniqueOrThrow({ where: { id: seller.id } })).referralCode;
    await prisma.sale.create({ data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 50000n, saleDate: new Date(), customerRef: 'ACME-Corp', status: SaleStatus.approved } });

    const p: AccessTokenPayload = { sub: owner.userId, mid: owner.id, tid: tenant.id, role: Role.tenant_owner };
    const tok = jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tok}`);

    const byCode = await auth(request(app.getHttpServer()).get(`/v1/admin/search?q=${code}`)).expect(200);
    expect(byCode.body.members.some((m: { code: string }) => m.code === code)).toBe(true);

    const bySale = await auth(request(app.getHttpServer()).get('/v1/admin/search?q=acme')).expect(200);
    expect(bySale.body.sales.length).toBeGreaterThanOrEqual(1);

    const tooShort = await auth(request(app.getHttpServer()).get('/v1/admin/search?q=a')).expect(200);
    expect(tooShort.body.members).toHaveLength(0);
    expect(tooShort.body.sales).toHaveLength(0);
  });
});
