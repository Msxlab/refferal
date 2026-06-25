import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PayoutMethod } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { EngineService } from '../src/engine/engine.service';
import { PeriodsService } from '../src/periods/periods.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActorContext } from '../src/common/actor';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 3 — donem kilidi (muhasebe kapanisi): kilitli aya komisyon/payout yazilamaz. */
describe('period lock (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: EngineService;
  let periods: PeriodsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    engine = moduleRef.get(EngineService);
    periods = moduleRef.get(PeriodsService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  const PERIOD = '2026-06';
  const SALE_DATE = new Date('2026-06-15T12:00:00Z');

  async function setup() {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { payoutMinCents: 1n } });
    await createPlan(prisma, tenant.id);
    const [sponsor, seller] = await createChain(prisma, tenant.id, 2);
    const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n, { saleDate: SALE_DATE });
    const actor: ActorContext = { userId: sponsor.userId, tenantId: tenant.id };
    return { tenant, sponsor, seller, sale, actor };
  }

  it('kilitli aya komisyon yazilamaz; kilit acilinca yazilir', async () => {
    const { sale, actor } = await setup();
    await periods.lock(actor, PERIOD);

    await expect(engine.approveSale(sale.id, actor.userId)).rejects.toThrow(ConflictException);
    // ledger bos kaldi (tx geri alindi)
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id } })).toBe(0);

    await periods.unlock(actor, PERIOD);
    const res = await engine.approveSale(sale.id, actor.userId);
    expect(res.applied).toBe(true);
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id } })).toBeGreaterThan(0);
  });

  it('kilitli ayin payable payout edilemez', async () => {
    const { seller, sale, actor } = await setup();
    await engine.approveSale(sale.id, actor.userId); // on_approval → payable
    await periods.lock(actor, PERIOD);

    await expect(
      engine.payoutMember({ tenantId: actor.tenantId, membershipId: seller.id, period: PERIOD, method: PayoutMethod.manual }),
    ).rejects.toThrow(/kilitli/);
  });

  it('list: kapanis goruntusu kilitli donemi finansal ozetiyle dondurur', async () => {
    const { sale, actor } = await setup();
    await engine.approveSale(sale.id, actor.userId);
    await periods.lock(actor, PERIOD, 'haziran kapanisi');

    const { rows } = await periods.list(actor.tenantId);
    const june = rows.find((r) => r.period === PERIOD);
    expect(june).toBeTruthy();
    expect(june!.locked).toBe(true);
    expect(june!.note).toBe('haziran kapanisi');
    expect(BigInt(june!.revenueCents)).toBe(1_000_000n);
    expect(BigInt(june!.payableCents)).toBeGreaterThan(0n);
  });

  it('gecersiz donem bicimi reddedilir', async () => {
    const { actor } = await setup();
    await expect(periods.lock(actor, '2026/6')).rejects.toThrow(/YYYY-MM/);
  });
});
