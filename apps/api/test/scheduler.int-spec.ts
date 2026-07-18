import { BadRequestException } from '@nestjs/common';
import { LedgerStatus, LedgerType, MaturationRule, SaleStatus } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { BackgroundJobStatusService } from '../src/health/background-job-status.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { createChain, createPlan, createSale, createTenant, summaryTotals, truncateAll } from './helpers';

/**
 * Review finding (critical path): with on_delivery, markDelivered does not change status;
 * the pending->payable transition happens only through scheduled matureCommissions. Without
 * the scheduler, payable stays empty and the payout cycle stalls. This test verifies the
 * scheduler wrapper plus the full on_delivery->payable chain.
 */
describe('scheduler - maturation job chain (integration)', () => {
  let prisma: PrismaService;
  let engine: EngineService;
  let scheduler: SchedulerService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    engine = new EngineService(prisma);
    scheduler = new SchedulerService(engine, new BackgroundJobStatusService());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('on_delivery: approve->pending, deliver, scheduler job->payable', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_delivery });
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    const seller = chain[5];

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);

    // Pending after approval because the scheduler has not run yet.
    let s = await summaryTotals(prisma, seller.id);
    expect(s.pending).toBe(500_000n);
    expect(s.payable).toBe(0n);

    // Before delivery, the job does not mature anything.
    await scheduler.matureCommissions();
    s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(0n);

    // Delivery -> job -> payable.
    await engine.markDelivered(sale.id);
    await scheduler.matureCommissions();

    s = await summaryTotals(prisma, seller.id);
    expect(s.pending).toBe(0n);
    expect(s.payable).toBe(500_000n);

    const entries = await prisma.ledgerEntry.findMany({ where: { saleId: sale.id } });
    expect(entries.every((e) => e.status === LedgerStatus.payable)).toBe(true);
  });

  it('job is idempotent when run again, with no double maturation', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_delivery });
    await createPlan(prisma, tenant.id);
    const [seller] = await createChain(prisma, tenant.id, 1);
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);
    await engine.markDelivered(sale.id);

    await scheduler.matureCommissions();
    await scheduler.matureCommissions(); // Second run.

    const s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(500_000n); // Not counted twice.
  });

  it('matures one bounded batch and reports when more due rows remain', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_delivery });
    const [seller] = await createChain(prisma, tenant.id, 1);
    const now = new Date('2026-07-17T12:00:00.000Z');
    const month = '2026-07';

    await prisma.monthlySummary.create({
      data: {
        tenantId: tenant.id,
        membershipId: seller.id,
        month,
        level: 0,
        pendingCents: 101n,
      },
    });
    await prisma.$transaction(
      Array.from({ length: 101 }, (_, index) => {
        const createdAt = new Date(now.getTime() - 101_000 + index);
        return prisma.sale.create({
          data: {
            tenantId: tenant.id,
            sellerMembershipId: seller.id,
            amountCents: 1n,
            saleDate: now,
            summaryMonth: month,
            status: SaleStatus.approved,
            createdAt,
            ledger: {
              create: {
                tenantId: tenant.id,
                beneficiaryMembershipId: seller.id,
                level: 0,
                rateBpsUsed: 100,
                amountCents: 1n,
                type: LedgerType.commission,
                status: LedgerStatus.pending,
                maturesAt: new Date(now.getTime() - 1),
                createdAt,
              },
            },
          },
        });
      }),
    );

    await expect(engine.matureCommissions(now, 100)).resolves.toEqual({ matured: 100, hasMore: true });
    await expect(
      prisma.ledgerEntry.count({ where: { type: LedgerType.commission, status: LedgerStatus.payable } }),
    ).resolves.toBe(100);
    await expect(
      prisma.ledgerEntry.count({ where: { type: LedgerType.commission, status: LedgerStatus.pending } }),
    ).resolves.toBe(1);

    await expect(engine.matureCommissions(now, 100)).resolves.toEqual({ matured: 1, hasMore: false });
    await expect(
      prisma.ledgerEntry.count({ where: { type: LedgerType.commission, status: LedgerStatus.payable } }),
    ).resolves.toBe(101);
    expect(await summaryTotals(prisma, seller.id)).toEqual({
      pending: 0n,
      payable: 101n,
      processing: 0n,
      paid: 0n,
    });
  });

  it.each([0, -1, 1.5])('rejects invalid maturation batch limit %p', async (limit) => {
    await expect(engine.matureCommissions(new Date(), limit)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('scheduler - bounded tick status (integration)', () => {
  it('stops after the backlog is drained and records a successful run', async () => {
    const matureCommissions = jest
      .fn()
      .mockResolvedValueOnce({ matured: 100, hasMore: true })
      .mockResolvedValueOnce({ matured: 0, hasMore: false });
    const status = new BackgroundJobStatusService();
    const scheduler = new SchedulerService({ matureCommissions } as unknown as EngineService, status);

    await scheduler.matureCommissions();

    expect(matureCommissions).toHaveBeenCalledTimes(2);
    for (const [now, limit] of matureCommissions.mock.calls) {
      expect(now).toBeInstanceOf(Date);
      expect(limit).toBe(100);
    }
    expect(status.snapshot()).toEqual({
      maturationLastSuccessAt: expect.any(Date),
      maturationLastDurationSeconds: expect.any(Number),
      maturationFailureCount: 0,
    });
    expect(status.snapshot().maturationLastDurationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('never runs more than ten batches in one tick', async () => {
    const matureCommissions = jest.fn().mockResolvedValue({ matured: 100, hasMore: true });
    const status = new BackgroundJobStatusService();
    const scheduler = new SchedulerService({ matureCommissions } as unknown as EngineService, status);

    await scheduler.matureCommissions();

    expect(matureCommissions).toHaveBeenCalledTimes(10);
    expect(status.snapshot().maturationLastSuccessAt).toBeInstanceOf(Date);
  });

  it('records failures and clears the running guard so a later tick can run', async () => {
    const matureCommissions = jest
      .fn()
      .mockRejectedValueOnce(new Error('test maturation failure'))
      .mockResolvedValueOnce({ matured: 0, hasMore: false });
    const status = new BackgroundJobStatusService();
    const scheduler = new SchedulerService({ matureCommissions } as unknown as EngineService, status);

    await scheduler.matureCommissions();
    expect(status.snapshot()).toEqual({
      maturationLastSuccessAt: null,
      maturationLastDurationSeconds: 0,
      maturationFailureCount: 1,
    });

    await scheduler.matureCommissions();
    expect(matureCommissions).toHaveBeenCalledTimes(2);
    expect(status.snapshot()).toEqual({
      maturationLastSuccessAt: expect.any(Date),
      maturationLastDurationSeconds: expect.any(Number),
      maturationFailureCount: 1,
    });
  });
});
