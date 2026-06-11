import { LedgerStatus, LedgerType, MaturationRule, SaleStatus } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createChain,
  createPlan,
  createSale,
  createTenant,
  netLedger,
  summaryTotals,
  truncateAll,
} from './helpers';

/**
 * Ultracode inceleme bulgularinin regresyon testleri (docs/DECISIONS.md "Inceleme bulgulari").
 * Her test, duzeltme oncesi BASARISIZ olacak; duzeltme sonrasi yesil.
 */
describe('motor — inceleme bulgu regresyonlari', () => {
  let prisma: PrismaService;
  let engine: EngineService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    engine = new EngineService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('B1 (tz-bucket): apply sonrasi tenant.timezone degisse de void ayni bucket`a yazar', async () => {
    // sale_date NY ve LA icin farkli aya duser: 2026-07-01T05:30Z → NY 07, LA 06
    const tenant = await createTenant(prisma, { timezone: 'America/New_York' });
    await createPlan(prisma, tenant.id);
    const [seller] = await createChain(prisma, tenant.id, 1);
    const saleDate = new Date('2026-07-01T05:30:00Z');

    const sale = await createSale(prisma, tenant.id, seller.id, 100_000n, { saleDate });
    await engine.approveSale(sale.id);

    // summary_month satista donduruldu
    const persisted = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(persisted.summaryMonth).toBe('2026-07');

    // tenant timezone degisir (settings API'si gelince tek UPDATE)
    await prisma.tenant.update({ where: { id: tenant.id }, data: { timezone: 'America/Los_Angeles' } });

    await engine.voidSale(sale.id);

    // tum hareketler tek bucket'ta (2026-07); 2026-06'da hayalet satir YOK
    const rows = await prisma.monthlySummary.findMany({ where: { membershipId: seller.id } });
    expect(rows.every((r) => r.month === '2026-07')).toBe(true);
    const s = await summaryTotals(prisma, seller.id);
    expect(s).toEqual({ pending: 0n, payable: 0n, paid: 0n });
  });

  it('B1b (tz-bucket): on_delivery`de mature de donmus ay anahtarini kullanir', async () => {
    const tenant = await createTenant(prisma, {
      maturationRule: MaturationRule.on_delivery,
      timezone: 'America/New_York',
    });
    await createPlan(prisma, tenant.id);
    const [seller] = await createChain(prisma, tenant.id, 1);
    const saleDate = new Date('2026-07-01T05:30:00Z');

    const sale = await createSale(prisma, tenant.id, seller.id, 100_000n, { saleDate });
    await engine.approveSale(sale.id);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { timezone: 'America/Los_Angeles' } });

    await engine.markDelivered(sale.id, new Date('2026-07-02T00:00:00Z'));
    await engine.matureCommissions(new Date('2026-07-03T00:00:00Z'));

    const rows = await prisma.monthlySummary.findMany({ where: { membershipId: seller.id } });
    expect(rows.every((r) => r.month === '2026-07')).toBe(true);
    const s = await summaryTotals(prisma, seller.id);
    expect(s.pending).toBe(0n);
    expect(s.payable).toBe(5_000n); // 100.000 * %5
  });

  it('B2 (void↔mature yarisi): mature payable yaparken void araya girerse summary {0,0,0}', async () => {
    // days_after_approval(0): approve → pending + matures_at=approved_at (hemen due)
    const tenant = await createTenant(prisma, {
      maturationRule: MaturationRule.days_after_approval,
      maturationDays: 0,
    });
    await createPlan(prisma, tenant.id);
    const [seller] = await createChain(prisma, tenant.id, 1);

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);

    // mature ve void'i es zamanli kosun: FOR UPDATE sayesinde void taze statuyu okur
    const [, v] = await Promise.all([
      engine.matureCommissions(new Date(Date.now() + 1000)),
      engine.voidSale(sale.id),
    ]);
    expect(v.voided).toBe(true);

    // hangi sira kazanirsa kazansin: net 0, hayalet payable yok
    const s = await summaryTotals(prisma, seller.id);
    expect(s).toEqual({ pending: 0n, payable: 0n, paid: 0n });
    expect(await netLedger(prisma, seller.id)).toBe(0n);

    // ledger: orijinal commission reversed (mature payable yaptiysa bile), reversal mevcut
    const commissions = await prisma.ledgerEntry.findMany({
      where: { saleId: sale.id, type: LedgerType.commission },
    });
    expect(commissions.every((e) => e.status === LedgerStatus.reversed)).toBe(true);
  });

  it('B2b (void↔mature yarisi, ters sira): once void sonra mature — mature reversed satiri olgunlastirmaz', async () => {
    const tenant = await createTenant(prisma, {
      maturationRule: MaturationRule.days_after_approval,
      maturationDays: 0,
    });
    await createPlan(prisma, tenant.id);
    const [seller] = await createChain(prisma, tenant.id, 1);

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);
    await engine.voidSale(sale.id);

    // void sonrasi mature: olgunlastiracak pending commission satiri kalmadi
    const matured = await engine.matureCommissions(new Date(Date.now() + 1000));
    expect(matured.matured).toBe(0);

    const s = await summaryTotals(prisma, seller.id);
    expect(s).toEqual({ pending: 0n, payable: 0n, paid: 0n });
  });

  it('B3 (payout silme): payout`a bagli ledger satiri varken payout silinemez (Restrict)', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [seller] = await createChain(prisma, tenant.id, 1);

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { saleId: sale.id } });

    const payout = await prisma.payout.create({
      data: { tenantId: tenant.id, membershipId: seller.id, totalCents: 500_000n, period: '2026-06' },
    });
    await prisma.ledgerEntry.update({
      where: { id: entry.id },
      data: { status: LedgerStatus.paid, payoutId: payout.id },
    });

    // FK Restrict: silme engellenir
    await expect(prisma.payout.delete({ where: { id: payout.id } })).rejects.toThrow();

    // ledger bagi korundu
    const after = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.payoutId).toBe(payout.id);
    expect(after.status).toBe(LedgerStatus.paid);
  });

  it('B4 (plan trigger): es zamanli iki level commit`i SUM>pool olusturamaz', async () => {
    const tenant = await createTenant(prisma);
    // pool 1000, mevcut tek level 800 → her biri tek basina +200 ile 1000 (gecer)
    const plan = await prisma.commissionPlan.create({
      data: {
        tenantId: tenant.id,
        name: 'race',
        poolRateBps: 1000,
        depth: 8,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        levels: { create: [{ level: 0, rateBps: 800 }] },
      },
    });

    const insertLevel = (level: number) =>
      prisma.$transaction(async (tx) => {
        await tx.commissionPlanLevel.create({ data: { planId: plan.id, level, rateBps: 200 } });
      });

    // ikisi de gecerse SUM=1200>1000 olurdu; trigger FOR UPDATE ile en az birini reddetmeli
    const results = await Promise.allSettled([insertLevel(6), insertLevel(7)]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBeLessThanOrEqual(1);

    const total = await prisma.commissionPlanLevel.aggregate({
      where: { planId: plan.id },
      _sum: { rateBps: true },
    });
    expect(total._sum.rateBps ?? 0).toBeLessThanOrEqual(1000);
  });
});
