import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PlansService } from '../src/plans/plans.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActorContext } from '../src/common/actor';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

/** Dalga 2.3+2.4 — komisyon plani simulatoru + versiyonlama. */
describe('plans (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plans: PlansService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    plans = moduleRef.get(PlansService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  it('simulate: aktif plan seviye dagilimini ve dagitilan toplami dondurur', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id, { poolRateBps: 2000, rates: [1000, 500, 300] });
    const [, , seller] = await createChain(prisma, tenant.id, 3); // kok, sponsor, satici

    const res = await plans.simulate(tenant.id, { amountCents: 1_000_000, sellerMembershipId: seller.id });
    expect(res.depth).toBe(3);
    expect(res.poolRateBps).toBe(2000);
    expect(res.levels).toHaveLength(3);
    // level 0 satici: 1,000,000 * %10 = 100,000; doludur (beneficiary var)
    const l0 = res.levels.find((l) => l.level === 0)!;
    expect(l0.amountCents).toBe('100000');
    expect(l0.beneficiary).toBeTruthy();
    expect(l0.retainedByCompany).toBe(false);
    // dagitilan = 100k + 50k + 30k = 180k (zincir 3 dolu)
    expect(res.distributedCents).toBe('180000');
  });

  it('simulate: upline eksikse pay sirkette kalir', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id, { poolRateBps: 2000, rates: [1000, 500, 300] });
    const [root] = await createChain(prisma, tenant.id, 1); // tek kisi, ustu yok

    const res = await plans.simulate(tenant.id, { amountCents: 1_000_000, sellerMembershipId: root.id });
    const l0 = res.levels.find((l) => l.level === 0)!;
    expect(l0.amountCents).toBe('100000'); // kendi payi var
    const l1 = res.levels.find((l) => l.level === 1)!;
    expect(l1.retainedByCompany).toBe(true); // sponsor yok -> sirkette
    expect(l1.amountCents).toBe('0');
    expect(res.distributedCents).toBe('100000');
  });

  it('createVersion: yeni plan INSERT eder, aktif plan yenisi olur, gecmis bozulmaz', async () => {
    const tenant = await createTenant(prisma);
    const old = await createPlan(prisma, tenant.id, { poolRateBps: 2000, rates: [1000], effectiveFrom: new Date('2026-01-01') });
    const actor: ActorContext = { userId: '00000000-0000-0000-0000-000000000001', tenantId: tenant.id };

    const created = await plans.createVersion(actor, {
      name: 'Yeni plan', poolRateBps: 3000, depth: 2, levels: [{ level: 0, rateBps: 1500 }, { level: 1, rateBps: 1000 }],
    });
    const list = await plans.list(tenant.id);
    expect(list.activeId).toBe(created.id);
    expect(list.plans.length).toBe(2); // eski + yeni (gecmis korunur)
    expect(list.plans.find((p) => p.id === old.id)).toBeTruthy();
  });

  it('createVersion: seviye toplami havuzu asarsa reddedilir', async () => {
    const tenant = await createTenant(prisma);
    const actor: ActorContext = { userId: '00000000-0000-0000-0000-000000000001', tenantId: tenant.id };
    await expect(plans.createVersion(actor, {
      name: 'Hatali', poolRateBps: 1000, depth: 2, levels: [{ level: 0, rateBps: 800 }, { level: 1, rateBps: 500 }],
    })).rejects.toThrow(BadRequestException);
  });
});
