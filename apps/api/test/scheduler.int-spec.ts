import { MaturationRule, LedgerStatus, PayoutStatus } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FraudService } from '../src/fraud/fraud.service';
import { ReportsService } from '../src/reports/reports.service';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { EventsService } from '../src/events/events.service';
import { SanctionsService } from '../src/sanctions/sanctions.service';
import { AlertsService } from '../src/observability/alerts.service';
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
  let payouts: PayoutsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    engine = new EngineService(prisma, new RanksService(prisma));
    payouts = new PayoutsService(prisma, engine, new WebhooksService(prisma), new EventsService(), new SanctionsService(prisma));
    scheduler = new SchedulerService(engine, new ReportsService(prisma), new FraudService(prisma), new WebhooksService(prisma), new CampaignsService(prisma, engine), prisma, payouts, new AlertsService());
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

  // ---- Faz A3: otomatik cek talebi ----

  /** Esigi gecmis payable'i olan uye uretir (createChain adres+email dolu verir). */
  async function sellerWithPayable(autoFlag = true) {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_delivery });
    if (!autoFlag) await prisma.tenant.update({ where: { id: tenant.id }, data: { autoRequestPayouts: false } });
    await createPlan(prisma, tenant.id);
    const [seller] = await createChain(prisma, tenant.id, 1);
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);
    await engine.markDelivered(sale.id);
    await scheduler.matureCommissions(); // seller payable 500_000n >= payoutMin (100_000n)
    return { tenant, seller };
  }

  it('A3 auto-request: esigi gecen uyeye requested cek + email/in_app bildirim; idempotent', async () => {
    const { tenant, seller } = await sellerWithPayable();

    const r1 = await payouts.autoRequestPayouts();
    expect(r1.created).toBeGreaterThanOrEqual(1);

    const p = await prisma.payout.findFirst({ where: { tenantId: tenant.id, membershipId: seller.id } });
    expect(p?.status).toBe(PayoutStatus.requested); // PARA CIKMADI — onay bekler
    expect(p?.method).toBe('check');
    expect(p?.totalCents).toBe(500_000n);

    const notifs = await prisma.notification.findMany({ where: { recipientMembershipId: seller.id, template: 'payout_auto_requested' } });
    expect(notifs.map((n) => n.channel).sort()).toEqual(['email', 'in_app']);

    // idempotent: ikinci kosum yeni talep ACMAZ (acik talep var)
    const r2 = await payouts.autoRequestPayouts();
    expect(r2.created).toBe(0);
    expect(await prisma.payout.count({ where: { tenantId: tenant.id, membershipId: seller.id } })).toBe(1);
  });

  it('A3 auto-request: tenant flag kapali → tenant hic islenmez', async () => {
    const { seller } = await sellerWithPayable(false);
    const r = await payouts.autoRequestPayouts();
    expect(r.tenants).toBe(0);
    expect(await prisma.payout.count({ where: { membershipId: seller.id } })).toBe(0);
  });

  it('A3 auto-request: posta adresi eksik uye atlanir (cek adres ister)', async () => {
    const { seller } = await sellerWithPayable();
    await prisma.membership.update({ where: { id: seller.id }, data: { mailingLine1: null } }); // adresi boz
    const r = await payouts.autoRequestPayouts();
    expect(r.created).toBe(0);
    expect(await prisma.payout.count({ where: { membershipId: seller.id } })).toBe(0);
  });
});
