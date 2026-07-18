import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

/** Dalga 2 #20 — kariyer rutbeleri + rozetler (varsayilan merdiven). */
describe('ranks (entegrasyon)', () => {
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

  it('varsayilan merdiven: ekip + kazanca gore rutbe + ilerleme + rozetler', async () => {
    const tenant = await createTenant(prisma);
    // owner + 4 alt zincir (owner'in ekibi = 4)
    const chain = await createChain(prisma, tenant.id, 5);
    const owner = chain[0];
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    // owner'a $2,000 kazanc (payable) → Silver esigi ($1,000 + 3 ekip) gecilir
    await prisma.ledgerEntry.create({ data: { tenantId: tenant.id, saleId: null, beneficiaryMembershipId: owner.id, level: 0, rateBpsUsed: 0, amountCents: 200_000n, type: LedgerType.adjustment, status: LedgerStatus.payable, summaryMonth: '2026-06' } });

    const p: AccessTokenPayload = { sub: owner.userId, mid: owner.id, tid: tenant.id, role: Role.tenant_owner };
    const tok = jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
    const r = await request(app.getHttpServer()).get('/v1/app/rank').set('Authorization', `Bearer ${tok}`).expect(200);

    expect(r.body.teamSize).toBe(4);
    expect(r.body.current).toBe('Silver'); // 4>=3 ekip + 200000>=100000
    expect(r.body.next).toBe('Gold');
    expect(r.body.overallPct).toBeGreaterThan(0);
    expect(r.body.badges.find((b: { key: string }) => b.key === 'first_recruit').earned).toBe(true);
    expect(r.body.badges.find((b: { key: string }) => b.key === 'earned_10k').earned).toBe(false);
  });
});
