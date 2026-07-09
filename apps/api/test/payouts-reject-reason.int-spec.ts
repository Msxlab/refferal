import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, PayoutStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

/** Feature-gap #2 — mandatory reject reason (per-request + batch). */
describe('payout reject reason (entegrasyon)', () => {
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

  function tokenFor(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const p: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }
  const srv = () => app.getHttpServer();

  /**
   * A processing payout with a `paid`-status ledger line bound to it + a matching
   * paid-bucket summary — the real state `decide()`'s reject branch releases back to
   * `payable` (payoutId=null) with a symmetric summary reversal (paidToPayable). A
   * `payable`-status line pre-bound to a payout is an impossible state in this model
   * (binding happens only at approve, alongside status=paid), so we mirror the real
   * shape here.
   */
  async function requestedPayout(tenantId: string, membershipId: string) {
    const payout = await prisma.payout.create({
      data: { tenantId, membershipId, totalCents: 200_000n, method: 'check', status: PayoutStatus.processing, period: '2026-06' },
    });
    await prisma.ledgerEntry.create({
      data: { tenantId, saleId: null, beneficiaryMembershipId: membershipId, level: 0, rateBpsUsed: 0, amountCents: 200_000n, type: LedgerType.adjustment, status: LedgerStatus.paid, summaryMonth: '2026-06', payoutId: payout.id },
    });
    // paid-bucket summary matching the bound line — so shiftSummaries(paidToPayable) reverses cleanly.
    await prisma.monthlySummary.create({
      data: { tenantId, membershipId, month: '2026-06', level: 0, payableCents: 0n, paidCents: 200_000n },
    });
    return payout;
  }

  it('(a) per-request reject WITHOUT ref → 400; WITH reason → balance returned + reason in audit', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, member] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const payout = await requestedPayout(tenant.id, member.id);

    await request(srv()).post(`/v1/admin/payouts/${payout.id}/decide`).set('Authorization', `Bearer ${tok}`).send({ action: 'reject' }).expect(400);

    await request(srv()).post(`/v1/admin/payouts/${payout.id}/decide`).set('Authorization', `Bearer ${tok}`).send({ action: 'reject', ref: 'invalid bank details' }).expect(200);
    const line = await prisma.ledgerEntry.findFirstOrThrow({ where: { beneficiaryMembershipId: member.id } });
    expect(line.status).toBe(LedgerStatus.payable);
    expect(line.payoutId).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: 'payout.reject' }, orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(audit?.after)).toMatch(/invalid bank details/);
  });

  it('approve still allows an empty ref', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, member] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const payout = await requestedPayout(tenant.id, member.id);
    await request(srv()).post(`/v1/admin/payouts/${payout.id}/decide`).set('Authorization', `Bearer ${tok}`).send({ action: 'approve' }).expect(200);
  });

  it('(b) batch reject WITHOUT reason → 400; WITH reason → each member notified + reason in audit', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, m1, m2] = await createChain(prisma, tenant.id, 3);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const batch = await prisma.payoutBatch.create({
      data: { tenantId: tenant.id, period: '2026-06', method: 'manual', membershipIds: [m1.id, m2.id], estimateCents: 0n, proposedByUserId: m1.userId, status: 'proposed' },
    });
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    await request(srv()).post(`/v1/admin/payouts/batches/${batch.id}/reject`).set('Authorization', `Bearer ${tok}`).send({}).expect(400);

    await request(srv()).post(`/v1/admin/payouts/batches/${batch.id}/reject`).set('Authorization', `Bearer ${tok}`).send({ reason: 'suspected duplicate run' }).expect(200);
    const updated = await prisma.payoutBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updated.status).toBe('rejected');
    const notes = await prisma.notification.findMany({ where: { tenantId: tenant.id, template: 'payout_rejected' } });
    expect(notes.map((n) => n.recipientMembershipId).sort()).toEqual([m1.id, m2.id].sort());
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: 'payout.batch_reject' } });
    expect(JSON.stringify(audit?.after)).toMatch(/suspected duplicate run/);
  });
});
