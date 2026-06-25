import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, PayoutStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

/** Dalga 3 — maker-checker (4-goz) payout onayi. */
describe('payout maker-checker (entegrasyon)', () => {
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

  it('acikken run ONERI olusturur; oneren onaylayamaz; ikinci admin yurutur', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { requirePayoutApproval: true } });
    const [owner, admin2, member] = await createChain(prisma, tenant.id, 3);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: admin2.id }, data: { role: Role.tenant_admin } });
    await prisma.ledgerEntry.create({ data: { tenantId: tenant.id, saleId: null, beneficiaryMembershipId: member.id, level: 0, rateBpsUsed: 0, amountCents: 2_000_000n, type: LedgerType.adjustment, status: LedgerStatus.payable, summaryMonth: '2026-06' } });

    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const admin2Tok = token({ userId: admin2.userId, membershipId: admin2.id, tenantId: tenant.id, role: Role.tenant_admin });

    // owner run → oneri (yurutmez)
    const proposed = await request(srv()).post('/v1/admin/payouts/run').set('Authorization', `Bearer ${ownerTok}`).send({ method: 'csv', membershipIds: [member.id] }).expect(200);
    expect(proposed.body.proposed).toBe(true);
    const batchId = proposed.body.batchId;
    expect((await prisma.payout.count({ where: { tenantId: tenant.id } }))).toBe(0); // henuz odeme yok

    // oneren (owner) onaylayamaz
    await request(srv()).post(`/v1/admin/payouts/batches/${batchId}/approve`).set('Authorization', `Bearer ${ownerTok}`).expect(400);

    // ikinci admin onaylar → yurutulur
    const approved = await request(srv()).post(`/v1/admin/payouts/batches/${batchId}/approve`).set('Authorization', `Bearer ${admin2Tok}`).expect(200);
    expect(approved.body.paidCount).toBe(1);
    expect((await prisma.payout.count({ where: { tenantId: tenant.id, status: PayoutStatus.paid } }))).toBe(1);

    // batch kuyrugu bosaldi
    const batches = await request(srv()).get('/v1/admin/payouts/batches').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    expect(batches.body).toHaveLength(0);
  });
});
