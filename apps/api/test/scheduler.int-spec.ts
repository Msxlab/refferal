import { MaturationRule, LedgerStatus } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
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
    scheduler = new SchedulerService(engine);
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
});
