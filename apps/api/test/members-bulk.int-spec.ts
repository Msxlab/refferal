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

/** Dalga 2 #7 — toplu duzenleme: dry-run onizleme + bulk set_role. */
describe('members bulk (entegrasyon)', () => {
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
    const p: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }
  const srv = () => app.getHttpServer();

  it('dry-run owner korumasini ve etki ozetini hesaplar; apply rolleri degistirir', async () => {
    const tenant = await createTenant(prisma);
    const [owner, m1, m2] = await createChain(prisma, tenant.id, 3);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const ids = [owner.id, m1.id, m2.id];

    // deactivate dry-run: owner atlanir, 2 uye degisir
    const pv = await request(srv()).post('/v1/admin/members/bulk').set('Authorization', `Bearer ${ownerTok}`)
      .send({ action: 'deactivate', ids, preview: true }).expect(200);
    expect(pv.body.preview).toBe(true);
    expect(pv.body.willChange).toBe(2);
    expect(pv.body.skipped.some((s: { reason: string }) => s.reason.includes('owner'))).toBe(true);

    // set_role dry-run + apply
    const pvRole = await request(srv()).post('/v1/admin/members/bulk').set('Authorization', `Bearer ${ownerTok}`)
      .send({ action: 'set_role', role: 'tenant_staff', ids: [m1.id, m2.id], preview: true }).expect(200);
    expect(pvRole.body.willChange).toBe(2);

    const applied = await request(srv()).post('/v1/admin/members/bulk').set('Authorization', `Bearer ${ownerTok}`)
      .send({ action: 'set_role', role: 'tenant_staff', ids: [m1.id, m2.id] }).expect(200);
    expect(applied.body.succeeded).toBe(2);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m1.id } })).role).toBe(Role.tenant_staff);
  });
});
