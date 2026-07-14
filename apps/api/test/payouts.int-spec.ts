import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, PayoutStatus, Role, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { defaultPermissionsForTier } from '../src/common/permissions';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, summaryTotals, truncateAll } from './helpers';

/**
 * Payout flow (SPEC 8/9) plus the MVP money loop:
 * sale -> approval -> balance -> CSV payout -> void -> offset.
 */
describe('payouts (integration)', () => {
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

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  function token(opts: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const payload: AccessTokenPayload = {
      sub: opts.userId,
      mid: opts.membershipId,
      tid: opts.tenantId,
      role: opts.role,
      perms: defaultPermissionsForTier(opts.role),
      authGeneration: 1,
    };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  /** Tenant (on_approval, min $1000) + plan + owner role + 5-upline chain; seller is at the bottom. */
  async function scenario() {
    const tenant = await createTenant(prisma); // on_approval -> payable, payoutMin 100000.
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    await prisma.membership.update({ where: { id: chain[0].id }, data: { role: Role.tenant_owner } });
    return { tenant, chain, seller: chain[5], owner: chain[0] };
  }

  it('reserves a bounded payout batch into processing and settles it only with evidence', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const started = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id], method: 'csv' })
      .expect(200);
    expect(started.body).toMatchObject({ status: 'processing', processingCount: 1 });
    expect(started.body.id).toEqual(expect.any(String));

    const processingRows = await prisma.$queryRaw<
      Array<{ status: string; payoutId: string | null; batchId: string | null }>
    >`
      SELECT status::text AS "status", payout_id AS "payoutId", payout_batch_id AS "batchId"
      FROM ledger_entries
      WHERE beneficiary_membership_id = ${seller.id}::uuid`;
    expect(processingRows).toEqual([
      expect.objectContaining({ status: 'processing', payoutId: expect.any(String), batchId: started.body.id }),
    ]);

    const processingSummary = await prisma.$queryRaw<
      Array<{ payable: bigint; processing: bigint; paid: bigint }>
    >`
      SELECT payable_cents AS "payable", processing_cents AS "processing", paid_cents AS "paid"
      FROM monthly_summaries
      WHERE membership_id = ${seller.id}::uuid`;
    expect(processingSummary).toEqual([{ payable: 0n, processing: 500_000n, paid: 0n }]);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({})
      .expect(400);
    expect(
      await prisma.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS "status" FROM ledger_entries WHERE beneficiary_membership_id = ${seller.id}::uuid`,
    ).toEqual([{ status: 'processing' }]);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ settlementReference: 'bank-transfer-42', settlementEvidence: 'provider-confirmation-42' })
      .expect(200);

    const settledSummary = await prisma.$queryRaw<
      Array<{ payable: bigint; processing: bigint; paid: bigint }>
    >`
      SELECT payable_cents AS "payable", processing_cents AS "processing", paid_cents AS "paid"
      FROM monthly_summaries
      WHERE membership_id = ${seller.id}::uuid`;
    expect(settledSummary).toEqual([{ payable: 0n, processing: 0n, paid: 500_000n }]);
    expect(
      await prisma.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS "status" FROM ledger_entries WHERE beneficiary_membership_id = ${seller.id}::uuid`,
    ).toEqual([{ status: 'paid' }]);
    expect(await prisma.notification.count({ where: { recipientMembershipId: seller.id, template: 'payout_sent' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'payout_batch.settled', entityId: started.body.id } })).toBe(1);
  });

  it('fails a processing batch only with a reason, restores its exact rows, and permits a fresh retry', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const started = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id], method: 'csv' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/fail`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ reason: '  ' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/fail`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ reason: 'bank file rejected' })
      .expect(200);

    const released = await prisma.ledgerEntry.findMany({ where: { beneficiaryMembershipId: seller.id } });
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ status: LedgerStatus.payable, payoutId: null, payoutBatchId: null });
    const restored = await summaryTotals(prisma, seller.id);
    expect(restored).toMatchObject({ payable: 500_000n, processing: 0n, paid: 0n });
    expect(await prisma.payout.findFirstOrThrow({ where: { id: started.body.processing[0].payoutId } })).toMatchObject({
      status: PayoutStatus.failed,
      failureReason: 'bank file rejected',
    });

    await request(app.getHttpServer())
      .get(`/v1/admin/payouts/batches/${started.body.id}/export.csv`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(409);

    const retried = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id], method: 'manual' })
      .expect(200);
    expect(retried.body.id).not.toBe(started.body.id);
    expect(retried.body.processing[0].payoutId).not.toBe(started.body.processing[0].payoutId);
  });

  it('makes repeated processing and concurrent settlement idempotent', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const first = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id], method: 'manual' })
      .expect(200);
    const second = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id], method: 'manual' })
      .expect(200);
    expect(second.body).toMatchObject({ id: null, processingCount: 0, skippedCount: 1 });
    expect(second.body.skipped[0].reason).toBe('already_processing');

    const settles = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`/v1/admin/payouts/batches/${first.body.id}/settle`)
          .set('Authorization', `Bearer ${ownerTok}`)
          .send({ settlementReference: 'provider-77', settlementEvidence: 'provider-77-confirmed' }),
      ),
    );
    expect(settles.map((response) => response.status)).toEqual([200, 200]);
    expect(settles.filter((response) => response.body.settled === true)).toHaveLength(1);
    expect(settles.filter((response) => response.body.alreadySettled === true)).toHaveLength(1);
    expect(await prisma.notification.count({ where: { recipientMembershipId: seller.id, template: 'payout_sent' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'payout_batch.settled', entityId: first.body.id } })).toBe(1);
    expect(await prisma.payout.count({ where: { batchId: first.body.id, status: PayoutStatus.paid } })).toBe(1);
    expect(await summaryTotals(prisma, seller.id)).toMatchObject({ payable: 0n, processing: 0n, paid: 500_000n });
  });

  it('blocks sale void while a linked ledger row is processing', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const started = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id], method: 'manual' })
      .expect(200);
    expect(started.body.processingCount).toBe(1);

    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${sale.id}/void`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(409);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('approved');
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id, status: LedgerStatus.processing } })).toBe(1);
    expect(await prisma.payoutBatchItem.count({ where: { batchId: started.body.id } })).toBe(1);
  });

  it('MVP loop: approval -> payable -> processing batch -> settle -> CSV; void -> offset', async () => {
    const { tenant, chain, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    // Two sales: one will be paid, one will be voided.
    const s1 = await createSale(prisma, tenant.id, seller.id, 10_000_000n); // L0 = 500.000
    const s2 = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    const engine = new EngineService(prisma);
    await engine.approveSale(s1.id);
    await engine.approveSale(s2.id);

    // Seller payable = 1,000,000 from L0 on two sales.
    let s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(1_000_000n);

    // Payable list: seller appears above the threshold.
    const payable = await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    const sellerRow = payable.body.members.find((m: { membershipId: string }) => m.membershipId === seller.id);
    expect(sellerRow.netCents).toBe('1000000');

    await prisma.user.update({
      where: { id: seller.userId },
      data: { fullName: '\t=cmd', email: '+payee@example.test' },
    });

    // Legacy run is compatibility-only: it starts processing and cannot mark paid.
    const run = await request(app.getHttpServer())
      .post('/v1/admin/payouts/run')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ method: 'csv' })
      .expect(200);
    expect(run.body.processingCount).toBeGreaterThanOrEqual(1);
    expect(run.body.id).toEqual(expect.any(String));
    const sellerProcessing = run.body.processing.find((p: { membershipId: string }) => p.membershipId === seller.id);
    expect(sellerProcessing.totalCents).toBe('1000000');

    // Seller summary: payable->processing; paid remains untouched until settlement evidence arrives.
    s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(0n);
    expect(s.processing).toBe(1_000_000n);
    expect(s.paid).toBe(0n);

    // Ledger rows are reserved, not paid, and remain linked to the processing payout.
    const processingEntries = await prisma.ledgerEntry.findMany({
      where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.processing },
    });
    expect(processingEntries).toHaveLength(2);
    expect(processingEntries.every((e) => e.payoutId === sellerProcessing.payoutId)).toBe(true);

    // Batch CSV is scoped to its immutable processing set and neutralizes spreadsheet formula injection.
    const csv = await request(app.getHttpServer())
      .get(`/v1/admin/payouts/batches/${run.body.id}/export.csv`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(seller.referralCode);
    expect(csv.text).toContain('1000000');
    expect(csv.text).toContain(",'\t=cmd,'+payee@example.test,");

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${run.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ settlementReference: 'bank-run-1', settlementEvidence: 'bank-confirmation-1' })
      .expect(200);

    s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(0n);
    expect(s.processing).toBe(0n);
    expect(s.paid).toBe(1_000_000n);
    const paidEntries = await prisma.ledgerEntry.findMany({
      where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.paid },
    });
    expect(paidEntries).toHaveLength(2);
    expect(paidEntries.every((e) => e.payoutId === sellerProcessing.payoutId)).toBe(true);

    // Historical paid export requires a bounded period.
    const paidCsv = await request(app.getHttpServer())
      .get(`/v1/admin/payouts/export.csv?period=${run.body.period}`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(paidCsv.text).toContain('bank-run-1');

    // VOID: paid sale s2 is voided -> negative payable reversal for offset.
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${s2.id}/void`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);

    s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(-500_000n); // Offset against future earnings.
    expect(s.paid).toBe(1_000_000n); // Actual paid amount does not change.

    // Seller wallet shows negative payable.
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(wallet.body.balance.payableCents).toBe('-500000');
    expect(wallet.body.balance.processingCents).toBe('0');
    expect(wallet.body.balance.paidCents).toBe('1000000');

    // A payout linked to a paid ledger row cannot be deleted (B3) - side verification.
    const someEntry = paidEntries[0];
    await expect(
      prisma.payout.delete({ where: { id: someEntry.payoutId as string } }),
    ).rejects.toThrow();

    void chain;
  });

  it('below-threshold balance is not paid (skipped: below_min)', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    // Small sale: L0 = $5, below the $1000 threshold.
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    // Payable list is empty below the threshold.
    const payable = await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(payable.body.members).toHaveLength(0);

    // Omitted selection only considers threshold-eligible members, so dust
    // balances cannot consume the 100-member batch cap.
    const allEligible = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({})
      .expect(200);
    expect(allEligible.body).toMatchObject({ processingCount: 0, skippedCount: 0 });

    // Even when a specific member is requested, it is skipped.
    const run = await request(app.getHttpServer())
      .post('/v1/admin/payouts/run')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id] })
      .expect(200);
    expect(run.body.processingCount).toBe(0);
    expect(run.body.skipped[0].reason).toBe('below_min');
  });

  it('never creates a fake failed payout for below-minimum or negative payable balances', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const started = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id] })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/batches/${started.body.id}/settle`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ settlementReference: 'paid-before-void', settlementEvidence: 'confirmed-before-void' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${sale.id}/void`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);

    expect(await summaryTotals(prisma, seller.id)).toMatchObject({ payable: -500_000n, processing: 0n, paid: 500_000n });
    await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(400);
    const skipped = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id] })
      .expect(200);
    expect(skipped.body).toMatchObject({ processingCount: 0, skippedCount: 1 });
    expect(skipped.body.skipped[0]).toMatchObject({ reason: 'below_min', netCents: '-500000' });
    expect(await prisma.payout.count({ where: { membershipId: seller.id, status: PayoutStatus.failed } })).toBe(0);
  });

  it('keeps duplicate member requests idempotent and batch CSV cents exact beyond Number precision', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 200_000_000_000_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const requests = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post('/v1/app/payout-requests')
          .set('Authorization', `Bearer ${sellerTok}`)
          .send({}),
      ),
    );
    expect(requests.map((response) => response.status)).toEqual([200, 200]);
    expect(requests[0].body.id).toBe(requests[1].body.id);
    expect(requests[0].body.requestedCents).toBe('10000000000000000');
    expect(await prisma.payout.count({ where: { membershipId: seller.id, status: PayoutStatus.requested } })).toBe(1);

    await prisma.user.update({
      where: { id: seller.userId },
      data: { fullName: '=huge', email: '+huge@example.test' },
    });

    const started = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id], method: 'csv' })
      .expect(200);
    expect(started.body.processing[0].totalCents).toBe('10000000000000000');

    const csv = await request(app.getHttpServer())
      .get(`/v1/admin/payouts/batches/${started.body.id}/export.csv`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    await prisma.user.update({
      where: { id: seller.userId },
      data: { fullName: 'changed-after-processing', email: 'changed-after-processing@example.test' },
    });
    const repeatedCsv = await request(app.getHttpServer())
      .get(`/v1/admin/payouts/batches/${started.body.id}/export.csv`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(csv.text).toBe(repeatedCsv.text);
    expect(csv.text).toContain('10000000000000000');
    expect(csv.text).toContain(",'=huge,'+huge@example.test,");
    expect((await prisma.payoutBatch.findUniqueOrThrow({ where: { id: started.body.id } })).csvChecksum).toEqual(expect.any(String));
  });

  it('bounds one processing batch to at most 100 memberships', async () => {
    const { tenant, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const membershipIds = Array.from(
      { length: 101 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );

    await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds })
      .expect(400);
  });

  it('refuses a batch CSV when recipient values lack a reservation-time snapshot marker', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    const started = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id], method: 'csv' })
      .expect(200);

    await prisma.payoutBatchItem.updateMany({
      where: { batchId: started.body.id },
      data: { recipientSnapshotAt: null },
    });
    await request(app.getHttpServer())
      .get(`/v1/admin/payouts/batches/${started.body.id}/export.csv`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(409);
  });

  it('rejects an omitted all-payable batch when more than 100 members are eligible', async () => {
    const { tenant, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const members: Array<typeof owner> = [];
    for (let index = 0; index < 101; index++) {
      const [member] = await createChain(prisma, tenant.id, 1);
      members.push(member);
    }
    await prisma.$transaction(async (tx) => {
      for (const member of members) {
        const sale = await tx.sale.create({
          data: {
            tenantId: tenant.id,
            sellerMembershipId: member.id,
            amountCents: 100_000n,
            status: SaleStatus.approved,
            saleDate: new Date(),
          },
        });
        await tx.ledgerEntry.create({
          data: {
            tenantId: tenant.id,
            saleId: sale.id,
            beneficiaryMembershipId: member.id,
            level: 0,
            rateBpsUsed: 10_000,
            amountCents: 100_000n,
            type: LedgerType.commission,
            status: LedgerStatus.payable,
          },
        });
      }
    });

    await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({})
      .expect(400);
    expect(await prisma.payoutBatch.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { tenantId: tenant.id, status: LedgerStatus.processing } })).toBe(0);
  });

  it('does not let zero-net payable members consume the omitted batch cap when the minimum is zero', async () => {
    const { tenant, owner } = await scenario();
    await prisma.tenant.update({ where: { id: tenant.id }, data: { payoutMinCents: 0n } });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const members: Array<typeof owner> = [];
    for (let index = 0; index < 101; index++) {
      const [member] = await createChain(prisma, tenant.id, 1);
      members.push(member);
    }
    await prisma.$transaction(async (tx) => {
      for (const member of members) {
        const sale = await tx.sale.create({
          data: {
            tenantId: tenant.id,
            sellerMembershipId: member.id,
            amountCents: 1n,
            status: SaleStatus.approved,
            saleDate: new Date(),
          },
        });
        await tx.ledgerEntry.create({
          data: {
            tenantId: tenant.id,
            saleId: sale.id,
            beneficiaryMembershipId: member.id,
            level: 0,
            rateBpsUsed: 0,
            amountCents: 0n,
            type: LedgerType.commission,
            status: LedgerStatus.payable,
          },
        });
      }
    });

    const result = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({})
      .expect(200);
    expect(result.body).toMatchObject({ processingCount: 0, skippedCount: 0 });
  });

  it('member payout request: below threshold returns 400, above threshold becomes requested', async () => {
    const { tenant, seller, owner } = await scenario();
    await prisma.tenant.update({ where: { id: tenant.id }, data: { currency: 'EUR' } });
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    void owner;

    // Request without balance returns 400.
    const below = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(400);
    expect(below.body.message).toContain('€0.00');

    // Create payable balance ($5000).
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const req1 = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(req1.body.status).toBe(PayoutStatus.requested);
    expect(req1.body.requestedCents).toBe('500000');
    expect(req1.body.currency).toBe('EUR');

    // A second request in the same period does not create a new row (idempotent intent).
    const req2 = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(req2.body.id).toBe(req1.body.id);
    expect(req2.body.currency).toBe('EUR');

    const mine = await request(app.getHttpServer())
      .get('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].currency).toBe('EUR');
  });

  it('admin approval only moves a requested payout into processing', async () => {
    const { tenant, seller, owner } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const req1 = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    const approved = await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${req1.body.id}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ method: 'csv' })
      .expect(200);

    expect(approved.body).toMatchObject({ processing: true, payoutId: req1.body.id, totalCents: '500000' });
    expect(approved.body.batchId).toEqual(expect.any(String));
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: req1.body.id } });
    expect(payout.status).toBe(PayoutStatus.processing);
    expect(payout.method).toBe('csv');
    expect(payout.paidAt).toBeNull();
    expect(await prisma.ledgerEntry.count({ where: { payoutId: req1.body.id, status: LedgerStatus.processing } })).toBe(1);

    // Idempotent member retry returns the active processing payout even though
    // there is no longer a payable ledger balance to recalculate.
    const retry = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(retry.body).toMatchObject({ id: req1.body.id, status: PayoutStatus.processing, requestedCents: '500000' });
  });

  it('wallet reports no-payable eligibility with the tenant payout minimum', async () => {
    const { tenant, seller } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });

    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    expect(wallet.body).toMatchObject({
      payoutMinCents: '100000',
      payoutEligibility: {
        requestable: false,
        reason: 'no_payable',
        message: 'No payable balance is available.',
        activePayout: null,
      },
    });
  });

  it('wallet reports below-threshold eligibility without creating a payout', async () => {
    const { tenant, seller } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    expect(wallet.body).toMatchObject({
      payoutMinCents: '100000',
      balance: { payableCents: '500' },
      payoutEligibility: {
        requestable: false,
        reason: 'below_threshold',
        message: 'Payable balance is below the payout minimum.',
        activePayout: null,
      },
    });
  });

  it('wallet reports an eligible payable balance before a payout request exists', async () => {
    const { tenant, seller } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    expect(wallet.body).toMatchObject({
      payoutMinCents: '100000',
      payoutEligibility: {
        requestable: true,
        reason: 'eligible',
        message: 'Payable balance is eligible for a payout request.',
        activePayout: null,
      },
    });
  });

  it('wallet reports unverified members as non-requestable even with an eligible balance', async () => {
    const { tenant, seller } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);
    await prisma.user.update({ where: { id: seller.userId }, data: { emailVerifiedAt: null } });

    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    expect(wallet.body.payoutEligibility).toEqual({
      requestable: false,
      reason: 'email_unverified',
      message: 'Verify your email address before requesting a payout.',
      activePayout: null,
    });
  });

  it('wallet reports requested and processing payouts as non-requestable active states', async () => {
    const { tenant, seller, owner } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const payoutRequest = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    const requestedWallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(requestedWallet.body.payoutEligibility).toEqual({
      requestable: false,
      reason: 'requested',
      message: 'A payout request is already open.',
      activePayout: { id: payoutRequest.body.id, status: 'requested' },
    });

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${payoutRequest.body.id}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ method: 'csv' })
      .expect(200);

    const processingWallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(processingWallet.body).toMatchObject({
      balance: { payableCents: '0', processingCents: '500000' },
      payoutEligibility: {
        requestable: false,
        reason: 'processing',
        message: 'A payout is already processing.',
        activePayout: { id: payoutRequest.body.id, status: 'processing' },
      },
    });
  });

  it('serializes a member request racing an admin processing start into one active payout', async () => {
    const { tenant, seller, owner } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const [memberRequest, batchStart] = await Promise.all([
      request(app.getHttpServer()).post('/v1/app/payout-requests').set('Authorization', `Bearer ${sellerTok}`),
      request(app.getHttpServer())
        .post('/v1/admin/payouts/batches')
        .set('Authorization', `Bearer ${ownerTok}`)
        .send({ membershipIds: [seller.id] }),
    ]);
    expect([memberRequest.status, batchStart.status]).toEqual([200, 200]);
    expect(batchStart.body).toMatchObject({ processingCount: 1 });
    const active = await prisma.payout.findMany({
      where: { tenantId: tenant.id, membershipId: seller.id, status: { in: [PayoutStatus.requested, PayoutStatus.processing] } },
    });
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe(PayoutStatus.processing);
    expect(await prisma.ledgerEntry.count({ where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.processing } })).toBe(1);
  });

  it('admin can reject requested payout', async () => {
    const { tenant, seller, owner } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma).approveSale(sale.id);

    const req1 = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${req1.body.id}/reject`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ reason: '   ' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${req1.body.id}/reject`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ reason: 'missing bank details' })
      .expect(200);

    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: req1.body.id } });
    expect(payout.status).toBe(PayoutStatus.rejected);
    expect(payout.rejectionReason).toContain('missing bank details');
    expect(await prisma.ledgerEntry.count({ where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.payable } })).toBe(1);
  });

  it('staff cannot view or run payouts (403)', async () => {
    const { tenant, chain } = await scenario();
    const staff = chain[2];
    await prisma.membership.update({ where: { id: staff.id }, data: { role: Role.tenant_staff } });
    const staffTok = token({ userId: staff.userId, membershipId: staff.id, tenantId: tenant.id, role: Role.tenant_staff });

    await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${staffTok}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/v1/admin/payouts/run')
      .set('Authorization', `Bearer ${staffTok}`)
      .send({})
      .expect(403);
  });
});
