import { PrismaService } from '../src/prisma/prisma.service';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 3 — MLM rutbe override: satici, ulastigi rutbenin overrideBps'i kadar KENDI satisinda ek bonus alir. */
describe('rank override bonus (entegrasyon)', () => {
  let prisma: PrismaService;
  let engine: EngineService;
  let ranks: RanksService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ranks = new RanksService(prisma);
    engine = new EngineService(prisma, ranks);
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await truncateAll(prisma); });

  async function setup() {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [sponsor, seller] = await createChain(prisma, tenant.id, 2);
    const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n);
    return { tenant, sponsor, seller, sale };
  }

  it('rutbe override yokken seviye-1002 satiri yazilmaz', async () => {
    const { sale, seller } = await setup();
    await engine.approveSale(sale.id);
    const override = await prisma.ledgerEntry.findFirst({ where: { saleId: sale.id, level: 1002 } });
    expect(override).toBeNull();
    // ama base komisyon var (saglik kontrolu)
    expect(await prisma.ledgerEntry.count({ where: { beneficiaryMembershipId: seller.id, level: 0 } })).toBe(1);
  });

  it('overrideBps tanimliyken satici kendi satisinda ek bonus alir (seviye 1002)', async () => {
    const { tenant, sale, seller } = await setup();
    // herkesin kalifiye oldugu tek tier: %5 override
    await prisma.rankTier.create({ data: { tenantId: tenant.id, name: 'All', sortOrder: 0, minTeam: 0, minEarningsCents: 0n, overrideBps: 500 } });

    await engine.approveSale(sale.id);

    const override = await prisma.ledgerEntry.findFirst({ where: { saleId: sale.id, level: 1002, beneficiaryMembershipId: seller.id } });
    expect(override).toBeTruthy();
    expect(override!.amountCents).toBe(50_000n); // 1,000,000 * %5
    expect(override!.rateBpsUsed).toBe(500);
    expect(override!.type).toBe('commission');
  });

  it('memberRank guncel overrideBps dondurur', async () => {
    const { tenant, seller } = await setup();
    await prisma.rankTier.create({ data: { tenantId: tenant.id, name: 'Gold', sortOrder: 0, minTeam: 0, minEarningsCents: 0n, overrideBps: 800 } });
    const r = await ranks.memberRank(seller.id, tenant.id);
    expect(r.overrideBps).toBe(800);
    expect(r.current).toBe('Gold');
  });
});
