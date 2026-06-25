import { MembershipStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 5 — atil toggle'lar gercek: inactiveMembersEarn + compressionEnabled motorda uygulanir. */
describe('engine toggles: inactive-earn / compression (entegrasyon)', () => {
  let prisma: PrismaService;
  let engine: EngineService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    engine = new EngineService(prisma, new RanksService(prisma));
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await truncateAll(prisma); });

  // zincir: [grand(kok), sponsor, satici]; sponsor pasif
  async function setup() {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id, { poolRateBps: 2000, rates: [1000, 500, 300] });
    const [grand, sponsor, seller] = await createChain(prisma, tenant.id, 3);
    await prisma.membership.update({ where: { id: sponsor.id }, data: { status: MembershipStatus.inactive } });
    return { tenant, grand, sponsor, seller };
  }

  const lineFor = (tenantId: string, mid: string, level: number) =>
    prisma.ledgerEntry.findFirst({ where: { tenantId, beneficiaryMembershipId: mid, level, type: 'commission' } });

  it('varsayilan (inactiveMembersEarn=true): pasif sponsor yine kazanir', async () => {
    const { tenant, grand, sponsor, seller } = await setup();
    const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n);
    await engine.approveSale(sale.id);
    expect(BigInt((await lineFor(tenant.id, sponsor.id, 1))!.amountCents)).toBe(50_000n); // level1
    expect(BigInt((await lineFor(tenant.id, grand.id, 2))!.amountCents)).toBe(30_000n);   // level2
  });

  it('inactiveMembersEarn=false: pasif sponsor pay ALMAZ, roll-up YOK (sirkette kalir)', async () => {
    const { tenant, grand, sponsor, seller } = await setup();
    await prisma.tenant.update({ where: { id: tenant.id }, data: { inactiveMembersEarn: false } });
    const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n);
    await engine.approveSale(sale.id);
    expect(await lineFor(tenant.id, sponsor.id, 1)).toBeNull();                            // pasif -> yok
    expect(BigInt((await lineFor(tenant.id, grand.id, 2))!.amountCents)).toBe(30_000n);    // pozisyon AYNI (roll-up yok)
    expect(BigInt((await lineFor(tenant.id, seller.id, 0))!.amountCents)).toBe(100_000n);  // satici degismez
  });

  it('compressionEnabled=true: pasif sponsor atlanir, grand yukari kayar (level1)', async () => {
    const { tenant, grand, sponsor, seller } = await setup();
    await prisma.tenant.update({ where: { id: tenant.id }, data: { compressionEnabled: true } });
    const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n);
    await engine.approveSale(sale.id);
    expect(await lineFor(tenant.id, sponsor.id, 1)).toBeNull();                            // atlandi
    expect(BigInt((await lineFor(tenant.id, grand.id, 1))!.amountCents)).toBe(50_000n);    // ROLL-UP: level1'e kaydi
    expect(await lineFor(tenant.id, grand.id, 2)).toBeNull();
  });
});
