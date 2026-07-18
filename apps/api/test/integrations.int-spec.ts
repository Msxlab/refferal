import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

/** Dalga 3 — entegrasyon platformu: API anahtarlari (guard) + giden webhook'lar. */
describe('integrations: api keys + webhooks (entegrasyon)', () => {
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
  const srv = () => app.getHttpServer();

  it('API anahtari admin ucuna erisir; revoke sonrasi reddedilir', async () => {
    const tenant = await createTenant(prisma);
    const [owner] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const tok = jwt.sign({ sub: owner.userId, mid: owner.id, tid: tenant.id, role: Role.tenant_owner } as AccessTokenPayload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });

    const created = await request(srv()).post('/v1/admin/api-keys').set('Authorization', `Bearer ${tok}`).send({ name: 'CRM' }).expect(201);
    const raw = created.body.key as string;
    expect(raw.startsWith('rfk_')).toBe(true);

    // X-Api-Key ile admin ucu (JWT yok)
    await request(srv()).get('/v1/admin/members').set('X-Api-Key', raw).expect(200);
    // gecersiz anahtar
    await request(srv()).get('/v1/admin/members').set('X-Api-Key', 'rfk_bogus').expect(401);

    // revoke → artik calismaz
    await request(srv()).delete(`/v1/admin/api-keys/${created.body.id}`).set('Authorization', `Bearer ${tok}`).expect(200);
    await request(srv()).get('/v1/admin/members').set('X-Api-Key', raw).expect(401);
  });

  it('webhook olusturma + test event teslimat kaydi olusturur', async () => {
    const tenant = await createTenant(prisma);
    const [owner] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const tok = jwt.sign({ sub: owner.userId, mid: owner.id, tid: tenant.id, role: Role.tenant_owner } as AccessTokenPayload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tok}`);

    const hook = await auth(request(srv()).post('/v1/admin/webhooks').send({ url: 'https://example.com/wh', events: [] })).expect(201);
    expect(hook.body.secret.startsWith('whsec_')).toBe(true);

    const test = await auth(request(srv()).post('/v1/admin/webhooks/test')).expect(200);
    expect(test.body.queued).toBe(1);

    const dels = await auth(request(srv()).get('/v1/admin/webhooks/deliveries')).expect(200);
    expect(dels.body.length).toBe(1);
    expect(dels.body[0].event).toBe('test');
    expect(dels.body[0].status).toBe('pending');
  });
});
