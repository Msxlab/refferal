import { LedgerStatus, LedgerType } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { PlansService } from '../src/plans/plans.service';
import { RanksService } from '../src/ranks/ranks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { createChain, createPlan, createSale, createTenant, netLedger, truncateAll } from './helpers';

/** Dalga 3 — MLM bonus katmanlari (unilevel+): fast-start + sponsor matching. */
describe('plan bonus layers (entegrasyon)', () => {
  let prisma: PrismaService;
  let engine: EngineService;
  let settings: SettingsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    engine = new EngineService(prisma, new RanksService(prisma));
    settings = new SettingsService(prisma, new PlansService(prisma));
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await truncateAll(prisma); });

  it('fast-start + matching direkt sponsora yazilir; void hepsini geri alir', async () => {
    const tenant = await createTenant(prisma); // on_approval → payable
    await createPlan(prisma, tenant.id, { fastStartBps: 1000, fastStartDays: 30, matchingBps: 1000 });
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

  it('settings bonus degisikligi eski snapshoti koruyup yeni plan versiyonu olusturur', async () => {
    const tenant = await createTenant(prisma);
    const original = await createPlan(prisma, tenant.id, { name: 'Immutable base' });
    const actor = { tenantId: tenant.id, userId: '00000000-0000-0000-0000-000000000001' };

    const result = await settings.updatePlanBonus(actor, {
      fastStartBps: 800,
      fastStartDays: 45,
      matchingBps: 300,
    });

    expect(result.version).toBe(2);
    const persistedOriginal = await prisma.commissionPlan.findUniqueOrThrow({ where: { id: original.id } });
    expect(persistedOriginal.fastStartBps).toBe(0);
    expect(persistedOriginal.fastStartDays).toBe(0);
    expect(persistedOriginal.matchingBps).toBe(0);
    const versions = await prisma.commissionPlan.findMany({
      where: { tenantId: tenant.id },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((plan) => plan.version)).toEqual([1, 2]);
    expect(versions[1]).toMatchObject({ fastStartBps: 800, fastStartDays: 45, matchingBps: 300 });
  });

  it('settings bonus versiyonu gelecekteki plani atlamaz ve hemen aktif olur', async () => {
    const tenant = await createTenant(prisma);
    const current = await createPlan(prisma, tenant.id, {
      name: 'Current plan',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });
    const future = await createPlan(prisma, tenant.id, {
      name: 'Future plan',
      effectiveFrom: new Date('2035-01-01T00:00:00.000Z'),
      rates: [700],
    });

    const result = await settings.updatePlanBonus(
      { tenantId: tenant.id, userId: '00000000-0000-0000-0000-000000000001' },
      { fastStartBps: 500, fastStartDays: 20, matchingBps: 200 },
    );

    expect(result).toMatchObject({ version: 3, planName: current.name, fastStartBps: 500 });
    const created = await prisma.commissionPlan.findUniqueOrThrow({ where: { id: result.planId } });
    expect(created.effectiveFrom.getTime()).toBeLessThan(future.effectiveFrom.getTime());
    await expect(settings.getPlanBonus(tenant.id)).resolves.toMatchObject({ planId: result.planId, version: 3 });
  });
});
