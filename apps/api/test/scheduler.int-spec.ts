import { MaturationRule, LedgerStatus } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FraudService } from '../src/fraud/fraud.service';
import { ReportsService } from '../src/reports/reports.service';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { createChain, createPlan, createSale, createTenant, summaryTotals, truncateAll } from './helpers';

/**
 * Inceleme bulgusu (kritik domino): on_delivery'de markDelivered statuyu cevirmez;
 * pending→payable gecisi YALNIZCA zamanlanmis matureCommissions ile olur. Scheduler
 * olmadan payable hep bos kalir, tum payout dongusu donar. Bu test scheduler wrapper'ini
 * + tum on_delivery→payable zincirini dogrular.
 */
describe('scheduler — olgunlasma job zinciri (entegrasyon)', () => {
  let prisma: PrismaService;
  let engine: EngineService;
  let scheduler: SchedulerService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    engine = new EngineService(prisma, new RanksService(prisma));
    scheduler = new SchedulerService(engine, new ReportsService(prisma), new FraudService(prisma), new WebhooksService(prisma), new CampaignsService(prisma, engine));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('on_delivery: approve→pending, deliver, scheduler job→payable', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_delivery });
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    const seller = chain[5];

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);

    // approve sonrasi pending (scheduler henuz calismadi)
    let s = await summaryTotals(prisma, seller.id);
    expect(s.pending).toBe(500_000n);
    expect(s.payable).toBe(0n);

    // teslim oncesi job hicbir sey olgunlastirmaz
    await scheduler.matureCommissions();
    s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(0n);

    // teslim → job → payable
    await engine.markDelivered(sale.id);
    await scheduler.matureCommissions();

    s = await summaryTotals(prisma, seller.id);
    expect(s.pending).toBe(0n);
    expect(s.payable).toBe(500_000n);

    const entries = await prisma.ledgerEntry.findMany({ where: { saleId: sale.id } });
    expect(entries.every((e) => e.status === LedgerStatus.payable)).toBe(true);
  });

  it('job tekrar calistiginda idempotent (cift olgunlasma yok)', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_delivery });
    await createPlan(prisma, tenant.id);
    const [seller] = await createChain(prisma, tenant.id, 1);
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);
    await engine.markDelivered(sale.id);

    await scheduler.matureCommissions();
    await scheduler.matureCommissions(); // ikinci kosum

    const s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(500_000n); // cift sayilmadi
  });
});
