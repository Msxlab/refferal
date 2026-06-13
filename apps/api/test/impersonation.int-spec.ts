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

/** Dalga 2 #6 — guvenli impersonation: salt-okunur token, yetki yukseltme korumasi, audit. */
describe('impersonation (entegrasyon)', () => {
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

  function token(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const payload: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }
  const srv = () => app.getHttpServer();

  async function setup() {
    const tenant = await createTenant(prisma);
    const [owner, member, admin2] = await createChain(prisma, tenant.id, 3);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: admin2.id }, data: { role: Role.tenant_admin } });
    return {
      tenant, owner, member, admin2,
      ownerTok: token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner }),
    };
  }

  it('admin uyeyi impersonate eder: GET calisir, yazma 403; audit yazilir', async () => {
    const { tenant, owner, member, ownerTok } = await setup();

    const imp = await request(srv()).post(`/v1/admin/members/${member.id}/impersonate`).set('Authorization', `Bearer ${ownerTok}`).expect(200);
    expect(imp.body.accessToken).toBeTruthy();
    expect(imp.body.member.membershipId).toBe(member.id);
    const impTok = imp.body.accessToken as string;

    // imp tokeninda imp claim'i var ve admin'in userId'sini tasir
    const claims = JSON.parse(Buffer.from(impTok.split('.')[1], 'base64').toString()) as AccessTokenPayload;
    expect(claims.imp).toBe(owner.userId);
    expect(claims.mid).toBe(member.id);

    // GET (okuma) calisir
    await request(srv()).get('/v1/app/dashboard').set('Authorization', `Bearer ${impTok}`).expect(200);
    // yazma (POST) 403 — salt-okunur
    await request(srv()).post('/v1/app/sales').set('Authorization', `Bearer ${impTok}`).send({ amountCents: 1000 }).expect(403);
    await request(srv()).post('/v1/app/payout-requests').set('Authorization', `Bearer ${impTok}`).expect(403);

    // baslangic audit'i yazildi
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: 'security.impersonate_start' } });
    expect(audit).toBeTruthy();
    expect(audit!.entity).toBe('security');
  });

  it('owner/admin impersonate EDILEMEZ (yetki yukseltme korumasi)', async () => {
    const { owner, admin2, ownerTok } = await setup();
    await request(srv()).post(`/v1/admin/members/${owner.id}/impersonate`).set('Authorization', `Bearer ${ownerTok}`).expect(400);
    await request(srv()).post(`/v1/admin/members/${admin2.id}/impersonate`).set('Authorization', `Bearer ${ownerTok}`).expect(400);
  });

  it('impersonate end audit yazar', async () => {
    const { tenant, member, ownerTok } = await setup();
    await request(srv()).post(`/v1/admin/members/${member.id}/impersonate/end`).set('Authorization', `Bearer ${ownerTok}`).expect(200);
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: 'security.impersonate_end' } });
    expect(audit).toBeTruthy();
  });
});
