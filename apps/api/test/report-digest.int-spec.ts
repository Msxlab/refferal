import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReportsService } from '../src/reports/reports.service';
import { createPlan, createTenant, truncateAll } from './helpers';

/** Dalga 2 #18 — zamanlanmis e-posta raporu: abonelik + digest + due mantigi. */
describe('report digest (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let reports: ReportsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    reports = moduleRef.get(ReportsService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  it('abonelik kaydedilir; test gonderim + due mantigi calisir', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const owner = await prisma.user.create({ data: { email: 'o@t.local', passwordHash: 'x', fullName: 'Owner', emailVerifiedAt: new Date() } });
    const m = await prisma.membership.create({ data: { tenantId: tenant.id, userId: owner.id, referralCode: 'OWN1', depth: 0, path: owner.id.replace(/-/g, '_'), role: Role.tenant_owner } });
    const tok = jwt.sign({ sub: owner.id, mid: m.id, tid: tenant.id, role: Role.tenant_owner } as AccessTokenPayload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tok}`);

    await auth(request(app.getHttpServer()).put('/v1/admin/report-subscription').send({ frequency: 'weekly', recipients: ['a@b.com', 'c@d.com'] })).expect(200);
    const got = await auth(request(app.getHttpServer()).get('/v1/admin/report-subscription')).expect(200);
    expect(got.body.recipients).toEqual(['a@b.com', 'c@d.com']);

    const test = await auth(request(app.getHttpServer()).post('/v1/admin/report-subscription/test')).expect(200);
    expect(test.body.sent).toBe(2);

    // due: lastSentAt null → gonderir; sonra ayni anda due degil
    const run1 = await reports.runDueDigests();
    expect(run1.sent).toBe(1);
    const run2 = await reports.runDueDigests();
    expect(run2.sent).toBe(0);
  });
});
