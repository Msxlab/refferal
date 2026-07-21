import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, PayoutStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, seedReadyPayoutCompliance, truncateAll } from './helpers';

/** Deprecated maker-checker proposals must not bypass the reviewed settlement lifecycle. */
describe('payout batch lifecycle (integration)', () => {
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
    const p: AccessTokenPayload = {
      sub: o.userId,
      mid: o.membershipId,
      tid: o.tenantId,
      role: o.role,
      authGeneration: 1,
    };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }
  const srv = () => app.getHttpServer();

  it('uses preview -> processing -> settlement even when the retired approval flag is enabled', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { requirePayoutApproval: true } });
    const [owner, member] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.ledgerEntry.create({
      data: {
        tenantId: tenant.id,
        saleId: null,
        beneficiaryMembershipId: member.id,
        level: 0,
        rateBpsUsed: 0,
        amountCents: 2_000_000n,
        type: LedgerType.adjustment,
        status: LedgerStatus.payable,
        summaryMonth: '2026-06',
      },
    });
    await seedReadyPayoutCompliance(prisma, tenant.id, member.id, owner.userId);

    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const scope = { mode: 'selected', membershipIds: [member.id] };
    const preview = await request(srv())
      .post('/v1/admin/payouts/batches/preview')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope })
      .expect(200);
    expect(preview.body.eligibleCount).toBe(1);

    const started = await request(srv())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(200);
    expect(started.body.status).toBe('processing');
    expect(await prisma.payout.count({ where: { tenantId: tenant.id, status: PayoutStatus.paid } })).toBe(0);
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);

    await request(srv())
      .post(`/v1/admin/payouts/batches/${started.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ settlementReference: 'maker-checker-retired', settlementEvidence: 'bank-settlement-evidence' })
      .expect(200);
    expect(await prisma.payout.count({ where: { tenantId: tenant.id, status: PayoutStatus.paid } })).toBe(1);
  });
});
