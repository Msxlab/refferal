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
 * SPEC Bolum 11 — T1..T10 motor senaryolari, gercek Postgres'e karsi.
 * Varsayilan plan: %10 havuz, 5 kademe = 500/200/150/100/50 bps.
 */
describe('komisyon motoru (entegrasyon)', () => {
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

  it('T1: $100.000 satis, 4+ ust → 5000/2000/1500/1000/500, toplam $10.000', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6); // kok + 5 (satici en altta)
    const seller = chain[5];

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const result = await engine.approveSale(sale.id);
    expect(result.applied).toBe(true);
    expect(result.entryCount).toBe(5);

    const entries = await prisma.ledgerEntry.findMany({
      where: { saleId: sale.id, type: LedgerType.commission },
      orderBy: { level: 'asc' },
    });
    expect(entries.map((e) => e.amountCents)).toEqual([500_000n, 200_000n, 150_000n, 100_000n, 50_000n]);
    expect(entries.map((e) => e.beneficiaryMembershipId)).toEqual(
      [chain[5], chain[4], chain[3], chain[2], chain[1]].map((m) => m.id),
    );
    expect(entries.map((e) => e.rateBpsUsed)).toEqual([500, 200, 150, 100, 50]);
    // on_approval → direkt payable
    expect(entries.every((e) => e.status === LedgerStatus.payable)).toBe(true);

    const total = entries.reduce((a, e) => a + e.amountCents, 0n);
    expect(total).toBe(1_000_000n);

    // summary ayni transaction'da yazildi
    const sellerSummary = await summaryTotals(prisma, seller.id);
    expect(sellerSummary.payable).toBe(500_000n);

    // outbox'a bildirim yazildi
    const notifications = await prisma.notification.count({ where: { template: 'commission_earned' } });
    expect(notifications).toBe(5);
  });

  it('T2: kurucu satar (0 ust) → sadece saticiya $5.000, baska satir yok', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [founder] = await createChain(prisma, tenant.id, 1);

    const sale = await createSale(prisma, tenant.id, founder.id, 10_000_000n);
    await engine.approveSale(sale.id);

    const entries = await prisma.ledgerEntry.findMany({ where: { saleId: sale.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 0,
      beneficiaryMembershipId: founder.id,
      amountCents: 500_000n,
    });
    // kalan $5.000 dagitilmadi: baska hicbir satir yok
  });

  it('T3: saticinin yalniz 2 ustu var → L0/L1/L2 yazilir, L3/L4 satiri yok', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 3);
    const seller = chain[2];

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);

    const entries = await prisma.ledgerEntry.findMany({
      where: { saleId: sale.id },
      orderBy: { level: 'asc' },
    });
    expect(entries.map((e) => e.level)).toEqual([0, 1, 2]);
    expect(entries.map((e) => e.amountCents)).toEqual([500_000n, 200_000n, 150_000n]);
  });

  it('T4: applyCommissions ayni satisa 2. kez cagrilir → hicbir yeni satir yok (idempotent)', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);

    const sale = await createSale(prisma, tenant.id, chain[5].id, 10_000_000n);
    const first = await engine.approveSale(sale.id);
    expect(first.applied).toBe(true);

    const second = await engine.applyCommissions(sale.id);
    expect(second.applied).toBe(false);
    expect(second.reason).toBe('already_applied');

    const count = await prisma.ledgerEntry.count({ where: { saleId: sale.id } });
    expect(count).toBe(5);
  });

  it('T5: onayli satis void edilir → esit-ters reversal, uye net etkisi 0, summary duser', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    const seller = chain[5];

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);

    const result = await engine.voidSale(sale.id);
    expect(result.voided).toBe(true);
    expect(result.reversalCount).toBe(5);

    // her commission satirina esit-ters reversal
    const commissions = await prisma.ledgerEntry.findMany({
      where: { saleId: sale.id, type: LedgerType.commission },
      orderBy: { level: 'asc' },
    });
    const reversals = await prisma.ledgerEntry.findMany({
      where: { saleId: sale.id, type: LedgerType.reversal },
      orderBy: { level: 'asc' },
    });
    expect(reversals).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(reversals[i].amountCents).toBe(-commissions[i].amountCents);
      expect(reversals[i].beneficiaryMembershipId).toBe(commissions[i].beneficiaryMembershipId);
    }
    // orijinal satirlar silinmedi, reversed oldu
    expect(commissions.every((e) => e.status === LedgerStatus.reversed)).toBe(true);

    // uye net etkisi 0
    for (const m of chain.slice(1)) {
      expect(await netLedger(prisma, m.id)).toBe(0n);
    }
    // summary dustu
    const s = await summaryTotals(prisma, seller.id);
    expect(s).toEqual({ pending: 0n, payable: 0n, paid: 0n });

    // void edilen satis tekrar onaylanamaz
    await expect(engine.approveSale(sale.id)).rejects.toThrow();
  });

  it('T5b: paid satirin reversal\'i payable kalir → bakiye eksiye duser (mahsup)', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [founder] = await createChain(prisma, tenant.id, 1);

    const sale = await createSale(prisma, tenant.id, founder.id, 10_000_000n);
    await engine.approveSale(sale.id);

    // payout modulunun yapacagi isi simule et: payable → paid + summary kaydirmasi
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { saleId: sale.id } });
    await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { status: LedgerStatus.paid } });
    await prisma.monthlySummary.updateMany({
      where: { membershipId: founder.id },
      data: { payableCents: { decrement: entry.amountCents }, paidCents: { increment: entry.amountCents } },
    });

    await engine.voidSale(sale.id);

    const reversal = await prisma.ledgerEntry.findFirstOrThrow({
      where: { saleId: sale.id, type: LedgerType.reversal },
    });
    expect(reversal.amountCents).toBe(-500_000n);
    expect(reversal.status).toBe(LedgerStatus.payable); // sonraki kazanclardan mahsup

    const original = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(original.status).toBe(LedgerStatus.paid); // odenmis satir paid kalir

    const s = await summaryTotals(prisma, founder.id);
    expect(s.payable).toBe(-500_000n); // eksi bakiye
    expect(s.paid).toBe(500_000n); // gercekte odenen degismez
  });

  it('T6: plan degisikligi gecmise uygulanmaz; yeni satis yeni oranla', async () => {
    const tenant = await createTenant(prisma);
    const now = new Date('2026-06-10T12:00:00Z');
    const tomorrow = new Date('2026-06-11T12:00:00Z');
    const dayAfter = new Date('2026-06-12T12:00:00Z');

    await createPlan(prisma, tenant.id, { effectiveFrom: new Date('2026-01-01T00:00:00Z') });
    const chain = await createChain(prisma, tenant.id, 6);

    // eski plan ile satis
    const oldSale = await createSale(prisma, tenant.id, chain[5].id, 10_000_000n, { saleDate: now });
    await engine.approveSale(oldSale.id);

    // yeni plan: yarindan itibaren farkli oranlar
    await createPlan(prisma, tenant.id, {
      effectiveFrom: tomorrow,
      rates: [600, 200, 100, 50, 50],
    });

    // eski ledger aynen — yeniden hesaplama yok (idempotensi de bunu garanti eder)
    const reRun = await engine.applyCommissions(oldSale.id);
    expect(reRun.applied).toBe(false);
    const oldEntries = await prisma.ledgerEntry.findMany({
      where: { saleId: oldSale.id },
      orderBy: { level: 'asc' },
    });
    expect(oldEntries.map((e) => e.rateBpsUsed)).toEqual([500, 200, 150, 100, 50]);

    // yeni satis yeni oranla
    const newSale = await createSale(prisma, tenant.id, chain[5].id, 10_000_000n, { saleDate: dayAfter });
    await engine.approveSale(newSale.id);
    const newEntries = await prisma.ledgerEntry.findMany({
      where: { saleId: newSale.id },
      orderBy: { level: 'asc' },
    });
    expect(newEntries.map((e) => e.rateBpsUsed)).toEqual([600, 200, 100, 50, 50]);
    expect(newEntries.map((e) => e.amountCents)).toEqual([600_000n, 200_000n, 100_000n, 50_000n, 50_000n]);
  });

  it('T7: on_delivery — approved ama delivered degil → pending; teslim + job → payable', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_delivery });
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    const seller = chain[5];

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);

    let entries = await prisma.ledgerEntry.findMany({ where: { saleId: sale.id } });
    expect(entries.every((e) => e.status === LedgerStatus.pending)).toBe(true);
    expect(entries.every((e) => e.maturesAt === null)).toBe(true);

    // teslim yokken job hicbir sey olgunlastirmaz
    let matured = await engine.matureCommissions();
    expect(matured.matured).toBe(0);

    let s = await summaryTotals(prisma, seller.id);
    expect(s.pending).toBe(500_000n);
    expect(s.payable).toBe(0n);

    // delivered_at set → job payable yapar
    await engine.markDelivered(sale.id);
    matured = await engine.matureCommissions();
    expect(matured.matured).toBe(5);

    entries = await prisma.ledgerEntry.findMany({ where: { saleId: sale.id } });
    expect(entries.every((e) => e.status === LedgerStatus.payable)).toBe(true);

    s = await summaryTotals(prisma, seller.id);
    expect(s.pending).toBe(0n);
    expect(s.payable).toBe(500_000n);

    // job idempotent
    matured = await engine.matureCommissions();
    expect(matured.matured).toBe(0);
  });

  it('T8: adalet — ozdes alt-yapiya sahip L1 uyesi ve L7 uyesi birebir esit kazanir', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);

    // govde: 7 uyelik zincir; A = derinlik 1, B = derinlik 6 ("L7")
    const trunk = await createChain(prisma, tenant.id, 7);
    const memberA = trunk[1];
    const memberB = trunk[6];

    // ozdes alt-yapi: her birinin altinda 4 kisilik zincir
    const downA = await createChain(prisma, tenant.id, 4, memberA);
    const downB = await createChain(prisma, tenant.id, 4, memberB);

    // ozdes satislar: uyenin kendisi + altindaki 4 kisi, her biri $10.000
    for (const seller of [memberA, ...downA]) {
      const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n);
      await engine.approveSale(sale.id);
    }
    for (const seller of [memberB, ...downB]) {
      const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n);
      await engine.approveSale(sale.id);
    }

    const earningsA = await netLedger(prisma, memberA.id);
    const earningsB = await netLedger(prisma, memberB.id);
    expect(earningsA).toBe(earningsB);
    expect(earningsA).toBe(100_000n); // $10.000 x %10 havuzun tamami (tum pencere dolu)
  });

  it('T9: $33.333 satis — her seviye floor, toplam ≤ %10, fark sirkette', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);

    const sale = await createSale(prisma, tenant.id, chain[5].id, 3_333_300n);
    await engine.approveSale(sale.id);

    const entries = await prisma.ledgerEntry.findMany({
      where: { saleId: sale.id },
      orderBy: { level: 'asc' },
    });
    expect(entries.map((e) => e.amountCents)).toEqual([166_665n, 66_666n, 49_999n, 33_333n, 16_666n]);

    const total = entries.reduce((a, e) => a + e.amountCents, 0n);
    expect(total).toBe(333_329n);
    expect(total <= 333_330n).toBe(true); // havuz %10 = 333.330; 1 cent sirkette
  });

  it('T10: paralel approve → tek set satir (unique constraint + FOR UPDATE)', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);

    const sale = await createSale(prisma, tenant.id, chain[5].id, 10_000_000n);

    const results = await Promise.allSettled([engine.approveSale(sale.id), engine.approveSale(sale.id)]);
    // en az biri basarili olmali; digeri no-op veya kilit bekleyip no-op
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({ where: { saleId: sale.id } });
    expect(entries).toHaveLength(5);
    expect(new Set(entries.map((e) => e.level)).size).toBe(5);

    // summary cift sayilmadi
    const s = await summaryTotals(prisma, chain[5].id);
    expect(s.payable).toBe(500_000n);
  });

  it('draft satista komisyon dagitilmaz (no-op)', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [founder] = await createChain(prisma, tenant.id, 1);

    const sale = await createSale(prisma, tenant.id, founder.id, 10_000_000n);
    const result = await engine.applyCommissions(sale.id);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('not_approved');
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id } })).toBe(0);
  });

  it('days_after_approval(N): satirlar pending + matures_at = approved_at + N gun', async () => {
    const tenant = await createTenant(prisma, {
      maturationRule: MaturationRule.days_after_approval,
      maturationDays: 14,
    });
    await createPlan(prisma, tenant.id);
    const [founder] = await createChain(prisma, tenant.id, 1);

    const sale = await createSale(prisma, tenant.id, founder.id, 10_000_000n);
    await engine.approveSale(sale.id);

    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(entry.status).toBe(LedgerStatus.pending);
    const refreshed = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    const expected = refreshed.approvedAt!.getTime() + 14 * 86_400_000;
    expect(entry.maturesAt!.getTime()).toBe(expected);

    // 14 gun sonrasi simulasyonu: job gelecekteki "now" ile kosulur
    const matured = await engine.matureCommissions(new Date(expected + 1000));
    expect(matured.matured).toBe(1);
  });
});
