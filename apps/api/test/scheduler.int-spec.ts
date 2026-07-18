import { BadRequestException } from '@nestjs/common';
import { LedgerStatus, LedgerType, MaturationRule, PayoutStatus, SaleStatus } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { BackgroundJobStatusService } from '../src/health/background-job-status.service';
import { RanksService } from '../src/ranks/ranks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/prisma/tenant-context.service';
import { FraudService } from '../src/fraud/fraud.service';
import { ReportsService } from '../src/reports/reports.service';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { PayoutComplianceService } from '../src/payouts/payout-compliance.service';
import { EventsService } from '../src/events/events.service';
import { SanctionsService } from '../src/sanctions/sanctions.service';
import { AlertsService } from '../src/observability/alerts.service';
import { EnvAesGcmSecretCryptoProvider, VersionedSecretCipher } from '../src/common/secret-cipher';
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
  let payouts: PayoutsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const tenantContext = new TenantContextService();
    const compliance = new PayoutComplianceService(prisma, tenantContext);
    const ranks = new RanksService(prisma);
    engine = new EngineService(prisma, compliance, ranks);
    const secretCipher = new VersionedSecretCipher([new EnvAesGcmSecretCryptoProvider()]);
    payouts = new PayoutsService(
      prisma,
      engine,
      tenantContext,
      compliance,
      new WebhooksService(prisma),
      new EventsService(),
      new SanctionsService(prisma),
      secretCipher,
    );
    scheduler = new SchedulerService(
      engine,
      new BackgroundJobStatusService(),
      new ReportsService(prisma),
      new FraudService(prisma),
      new WebhooksService(prisma),
      new CampaignsService(prisma, engine),
      prisma,
      payouts,
      new AlertsService(),
      ranks,
    );
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

  it('D5 rutbe-atlama: baseline ilk-run bildirmez; atlayinca email+in_app; idempotent', async () => {
    const ranks = new RanksService(prisma);
    const tenant = await createTenant(prisma);
    // 4'lu zincir: root'un alt-agaci 3 (team=3 → Silver esigi: team>=3 + $1000)
    const chain = await createChain(prisma, tenant.id, 4);
    const root = chain[0];
    await prisma.ledgerEntry.create({ data: { tenantId: tenant.id, saleId: null, beneficiaryMembershipId: root.id, level: 0, rateBpsUsed: 0, amountCents: 150_000n, type: 'adjustment', status: 'payable', summaryMonth: '2026-06' } });

    // 1) baseline — bildirmez, sortOrder kaydeder
    const r1 = await ranks.notifyRankUps();
    expect(r1.notified).toBe(0);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: root.id } })).lastRankSortOrder).toBe(1); // Silver

    // 2) Bronze'dan Silver'a atlamis gibi: lastRankSortOrder=0 → bildirir
    await prisma.membership.update({ where: { id: root.id }, data: { lastRankSortOrder: 0 } });
    const r2 = await ranks.notifyRankUps();
    expect(r2.notified).toBe(1);
    const notifs = await prisma.notification.findMany({ where: { recipientMembershipId: root.id, template: 'rank_up' } });
    expect(notifs.map((n) => n.channel).sort()).toEqual(['email', 'in_app']);

    // 3) artik Silver=Silver → tekrar bildirmez (idempotent)
    await prisma.notification.deleteMany({ where: { template: 'rank_up' } });
    const r3 = await ranks.notifyRankUps();
    expect(r3.notified).toBe(0);
  });

  it('A3 auto-request: posta adresi eksik uye atlanir (cek adres ister)', async () => {
    const { seller } = await sellerWithPayable();
    await prisma.membership.update({ where: { id: seller.id }, data: { mailingLine1: null } }); // adresi boz
    const r = await payouts.autoRequestPayouts();
    expect(r.created).toBe(0);
    expect(await prisma.payout.count({ where: { membershipId: seller.id } })).toBe(0);
  });
});

describe('scheduler - bounded tick status (integration)', () => {
  function schedulerForMaturation(engine: EngineService, status: BackgroundJobStatusService): SchedulerService {
    return new SchedulerService(
      engine,
      status,
      {} as ReportsService,
      {} as FraudService,
      {} as WebhooksService,
      {} as CampaignsService,
      {} as PrismaService,
      {} as PayoutsService,
      { critical: async () => undefined } as unknown as AlertsService,
      {} as RanksService,
    );
  }

  it('stops after the backlog is drained and records a successful run', async () => {
    const matureCommissions = jest
      .fn()
      .mockResolvedValueOnce({ matured: 100, hasMore: true })
      .mockResolvedValueOnce({ matured: 0, hasMore: false });
    const status = new BackgroundJobStatusService();
    const scheduler = schedulerForMaturation({ matureCommissions } as unknown as EngineService, status);

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
    const scheduler = schedulerForMaturation({ matureCommissions } as unknown as EngineService, status);

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
    const scheduler = schedulerForMaturation({ matureCommissions } as unknown as EngineService, status);

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
