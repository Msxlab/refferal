import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
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
});
