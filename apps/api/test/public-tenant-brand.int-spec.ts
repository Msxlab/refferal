import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TenantStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenant, truncateAll } from './helpers';

describe('public tenant-brand (entegrasyon, Alt-proje B)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  it('aktif tenant: kimliksiz 200 + isim/branding doner', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { branding: { logoText: 'AC', primaryColor: '#112233' } } });

    const res = await request(app.getHttpServer()).get(`/v1/auth/tenant-brand/${tenant.slug}`).expect(200);
    expect(res.body.name).toBe(tenant.name);
    expect(res.body.branding).toMatchObject({ logoText: 'AC', primaryColor: '#112233' });
  });

  it('bilinmeyen slug: 404', async () => {
    await request(app.getHttpServer()).get('/v1/auth/tenant-brand/no-such-company-xyz').expect(404);
  });

  it('askiya alinmis tenant: 404 (aktif ile ayni gorunur, durum sizdirilmaz)', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: TenantStatus.suspended } });
    await request(app.getHttpServer()).get(`/v1/auth/tenant-brand/${tenant.slug}`).expect(404);
  });

  it('buyuk/kucuk harf duyarsiz eslesir', async () => {
    const tenant = await createTenant(prisma);
    await request(app.getHttpServer()).get(`/v1/auth/tenant-brand/${tenant.slug.toUpperCase()}`).expect(200);
  });

  it('rezerve slug ile sirket olusturma reddedilir', async () => {
    const { createPlatformAdmin } = await import('./helpers');
    const platform = await createPlatformAdmin(prisma, 'Cok-Gizli-Sifre-42!');
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login').send({ email: platform.email, password: 'Cok-Gizli-Sifre-42!' }).expect(200);

    await request(app.getHttpServer())
      .post('/v1/platform/companies')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ name: 'Reserved Co', slug: 'hq', ownerEmail: 'owner@test.refearn.local', ownerName: 'Owner' })
      .expect(400);
  });
});
