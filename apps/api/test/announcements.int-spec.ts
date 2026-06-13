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

/** Dalga 3 — duyuru akisi: admin yayinlar, uye okur + okundu isaretler. */
describe('announcements (entegrasyon)', () => {
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

  it('admin yayinlar; uye unread gorur, okundu isaretler', async () => {
    const tenant = await createTenant(prisma);
    const [owner, member] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const ownerTok = jwt.sign({ sub: owner.userId, mid: owner.id, tid: tenant.id, role: Role.tenant_owner } as AccessTokenPayload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
    const memTok = jwt.sign({ sub: member.userId, mid: member.id, tid: tenant.id, role: Role.member } as AccessTokenPayload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });

    const created = await request(srv()).post('/v1/admin/announcements').set('Authorization', `Bearer ${ownerTok}`).send({ title: 'Welcome', body: 'Big news team!' }).expect(201);

    let mine = await request(srv()).get('/v1/app/announcements').set('Authorization', `Bearer ${memTok}`).expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].read).toBe(false);

    await request(srv()).post(`/v1/app/announcements/${created.body.id}/read`).set('Authorization', `Bearer ${memTok}`).expect(200);
    mine = await request(srv()).get('/v1/app/announcements').set('Authorization', `Bearer ${memTok}`).expect(200);
    expect(mine.body[0].read).toBe(true);

    const adminList = await request(srv()).get('/v1/admin/announcements').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    expect(adminList.body[0].reads).toBe(1);
  });
});
