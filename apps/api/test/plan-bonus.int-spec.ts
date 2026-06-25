import { LedgerStatus, LedgerType } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, netLedger, truncateAll } from './helpers';

/** Dalga 3 — MLM bonus katmanlari (unilevel+): fast-start + sponsor matching. */
describe('plan bonus layers (entegrasyon)', () => {
  let prisma: PrismaService;
  let engine: EngineService;

  beforeAll(async () => { prisma = new PrismaService(); await prisma.$connect(); engine = new EngineService(prisma, new RanksService(prisma)); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await truncateAll(prisma); });

  it('fast-start + matching direkt sponsora yazilir; void hepsini geri alir', async () => {
    const tenant = await createTenant(prisma); // on_approval → payable
    const plan = await createPlan(prisma, tenant.id);
    await prisma.commissionPlan.update({ where: { id: plan.id }, data: { fastStartBps: 1000, fastStartDays: 30, matchingBps: 1000 } });
    const [owner, seller] = await createChain(prisma, tenant.id, 2); // seller'in sponsoru = owner, ikisi de yeni katildi

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n); // $100k
    const res = await engine.approveSale(sale.id);

    // base: seller L0 (500bps=500k), owner L1 (200bps=200k) + bonus: fast-start L1000, matching L1001
    const owned = await prisma.ledgerEntry.findMany({ where: { saleId: sale.id, beneficiaryMembershipId: owner.id, type: LedgerType.commission }, orderBy: { level: 'asc' } });
    const byLevel = new Map(owned.map((e) => [e.level, e.amountCents]));
    expect(byLevel.get(1)).toBe(200_000n);                 // unilevel L1
    expect(byLevel.get(1000)).toBe(1_000_000n);            // fast-start: 10M * 10%
    expect(byLevel.get(1001)).toBe(50_000n);               // matching: seller L0 (500k) * 10%
    expect(res.entryCount).toBe(4);                        // 2 base + 2 bonus
    expect(owned.every((e) => e.status === LedgerStatus.payable)).toBe(true);

    // void → tum komisyon (bonus dahil) ters kayitla kapanir → net 0
    await engine.voidSale(sale.id);
    expect(await netLedger(prisma, owner.id)).toBe(0n);
    expect(await netLedger(prisma, seller.id)).toBe(0n);
  });

  it('bonus bps=0 (varsayilan) iken ekstra satir olusmaz', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id); // bonus alanlari varsayilan 0
    const [, seller] = await createChain(prisma, tenant.id, 2);
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const res = await engine.approveSale(sale.id);
    expect(res.entryCount).toBe(2); // yalniz 2 base unilevel satir (sentetik bonus yok)
    const synthetic = await prisma.ledgerEntry.count({ where: { saleId: sale.id, level: { gte: 1000 } } });
    expect(synthetic).toBe(0);
  });
});
