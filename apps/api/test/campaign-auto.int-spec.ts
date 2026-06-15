import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CampaignStatus, LedgerStatus, SaleStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { EngineService } from '../src/engine/engine.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 5.2 — penceresi biten kampanyalar scheduler ile otomatik finalize olur (endsAt kozmetik degil). */
describe('campaign auto-finalize (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let campaigns: CampaignsService;
  let engine: EngineService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    campaigns = moduleRef.get(CampaignsService);
    engine = moduleRef.get(EngineService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  it('endsAt gecmis + active kampanya otomatik finalize olur, bonus dagitilir', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id, { poolRateBps: 2000, rates: [1000] });
    const [, seller] = await createChain(prisma, tenant.id, 2);
    // satis kampanya penceresi ICINDE (startsAt < saleDate < endsAt)
    const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n, { status: SaleStatus.approved, saleDate: new Date(Date.now() - 5 * 3600_000) });
    await engine.approveSale(sale.id);

    const camp = await prisma.campaign.create({
      data: {
        tenantId: tenant.id, name: 'Bitmis yaris', metric: 'revenue', status: CampaignStatus.active,
        startsAt: new Date(Date.now() - 2 * 86_400_000), endsAt: new Date(Date.now() - 3600_000), // 1 saat once bitti
        prizes: [{ rank: 1, bonusCents: 250_000 }],
      },
    });

    const { finalized } = await campaigns.autoFinalizeEnded();
    expect(finalized).toBe(1);

    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: camp.id } });
    expect(after.status).toBe(CampaignStatus.ended);
    expect(after.finalizedAt).not.toBeNull();

    // rank #1 (tek satici) bonus adjustment satiri (payable) aldi
    const bonus = await prisma.ledgerEntry.findFirst({ where: { tenantId: tenant.id, beneficiaryMembershipId: seller.id, type: 'adjustment' } });
    expect(bonus).toBeTruthy();
    expect(BigInt(bonus!.amountCents)).toBe(250_000n);

    // auto-finalize audit'i actorUserId NULL ile yazildi
    const log = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: 'campaign.auto_finalize' } });
    expect(log).toBeTruthy();
    expect(log!.actorUserId).toBeNull();
  });

  it('penceresi DEVAM eden kampanya otomatik finalize OLMAZ', async () => {
    const tenant = await createTenant(prisma);
    await prisma.campaign.create({
      data: {
        tenantId: tenant.id, name: 'Suren yaris', metric: 'revenue', status: CampaignStatus.active,
        startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 86_400_000), prizes: [],
      },
    });
    const { finalized } = await campaigns.autoFinalizeEnded();
    expect(finalized).toBe(0);
  });
});
