import { LedgerStatus, MaturationRule } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 2 #4 — iade penceresi: days_after_delivery kurali (teslim + N gun olgunlasma). */
describe('iade penceresi (days_after_delivery)', () => {
  let prisma: PrismaService;
  let engine: EngineService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    engine = new EngineService(prisma);
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await truncateAll(prisma); });

  it('teslime kadar pending; teslim+N gunde olgunlasir', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.days_after_delivery, maturationDays: 14 });
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 2); // owner + seller
    const seller = chain[1];

    const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n);
    await engine.approveSale(sale.id);

    // onay sonrasi: pending + matures_at NULL (teslim bekliyor)
    const lineId = (await prisma.ledgerEntry.findFirstOrThrow({ where: { saleId: sale.id, beneficiaryMembershipId: seller.id } })).id;
    let line = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: lineId } });
    expect(line.status).toBe(LedgerStatus.pending);
    expect(line.maturesAt).toBeNull();

    // teslim → matures_at = teslim + 14 gun, hala pending
    const delivered = new Date('2026-03-01T00:00:00.000Z');
    await engine.markDelivered(sale.id, delivered);
    line = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: lineId } });
    expect(line.status).toBe(LedgerStatus.pending);
    expect(line.maturesAt?.getTime()).toBe(delivered.getTime() + 14 * 86_400_000);

    // pencere acikken (13. gun) olgunlasmaz
    const r1 = await engine.matureCommissions(new Date(delivered.getTime() + 13 * 86_400_000));
    expect(r1.matured).toBe(0);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: lineId } })).status).toBe(LedgerStatus.pending);

    // pencere kapandiktan sonra (15. gun) payable olur
    const r2 = await engine.matureCommissions(new Date(delivered.getTime() + 15 * 86_400_000));
    expect(r2.matured).toBeGreaterThanOrEqual(1);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: lineId } })).status).toBe(LedgerStatus.payable);
  });
});
