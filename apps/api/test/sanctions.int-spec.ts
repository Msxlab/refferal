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

const ROUTING = '021000021';

/** Dalga 2 #10 — OFAC/AML: yaptirim listesi taramasi + payout hold. */
describe('sanctions / AML (entegrasyon)', () => {
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
  beforeEach(async () => { await truncateAll(prisma); await prisma.sanctionsEntry.deleteMany(); });

  function token(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const p: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }
  const srv = () => app.getHttpServer();

  it('yaptirim eslesmesi profili isaretler ve payout bloklar; temiz ad serbest', async () => {
    const tenant = await createTenant(prisma);
    const [owner, member] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const memTok = token({ userId: member.userId, membershipId: member.id, tenantId: tenant.id, role: Role.member });
    await prisma.ledgerEntry.create({ data: { tenantId: tenant.id, saleId: null, beneficiaryMembershipId: member.id, level: 0, rateBpsUsed: 0, amountCents: 2_000_000n, type: LedgerType.adjustment, status: LedgerStatus.payable, summaryMonth: '2026-06' } });

    // listeyi yukle
    const refresh = await request(srv()).post('/v1/admin/sanctions/refresh').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    expect(refresh.body.loaded).toBeGreaterThan(0);

    // yaptirimli ad → sanctionsHit + payout blok
    const hit = await request(srv()).put('/v1/app/payout-profile').set('Authorization', `Bearer ${memTok}`)
      .send({ legalName: 'Test Sanctioned Person', country: 'US', taxIdType: 'ssn', taxId: '123456789', routingNumber: ROUTING, accountType: 'checking', accountNumber: '000111222' }).expect(200);
    expect(hit.body.sanctionsHit).toBe(true);
    await request(srv()).post('/v1/app/payout-requests').set('Authorization', `Bearer ${memTok}`).expect(400);

    // temiz ad → serbest
    const clean = await request(srv()).put('/v1/app/payout-profile').set('Authorization', `Bearer ${memTok}`)
      .send({ legalName: 'Jane Honest', country: 'US', taxIdType: 'ssn', taxId: '123456789', routingNumber: ROUTING, accountType: 'checking', accountNumber: '000111222' }).expect(200);
    expect(clean.body.sanctionsHit).toBe(false);
    const ok = await request(srv()).post('/v1/app/payout-requests').set('Authorization', `Bearer ${memTok}`).expect(200);
    expect(ok.body.status).toBe('requested');
  });
});
