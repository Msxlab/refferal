import { BadRequestException, ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SaleStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { EngineService } from '../src/engine/engine.service';
import { PlansService } from '../src/plans/plans.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { ActorContext } from '../src/common/actor';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 2.3+2.4 — komisyon plani simulatoru + versiyonlama. */
describe('plans (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plans: PlansService;
  let engine: EngineService;
  let settings: SettingsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    plans = moduleRef.get(PlansService);
    engine = moduleRef.get(EngineService);
    settings = moduleRef.get(SettingsService);
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
    expect(created.version).toBe(2);
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

  it('createVersion: ayni tenant eszamanli yazimlarda monoton ve benzersiz version tahsis eder', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id, { effectiveFrom: new Date('2026-01-01T00:00:00.000Z') });
    const actor: ActorContext = { userId: '00000000-0000-0000-0000-000000000001', tenantId: tenant.id };

    const created = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        plans.createVersion(actor, {
          name: `Concurrent ${index}`,
          poolRateBps: 1000,
          depth: 1,
          levels: [{ level: 0, rateBps: 500 }],
        }),
      ),
    );

    expect(created.map((plan) => plan.version).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    expect(new Set(created.map((plan) => plan.effectiveFrom.toISOString())).size).toBe(4);
  });

  it('plan snapshot satirlari degistirilemez; ayni effectiveFrom yeni versiyon olarak da reddedilir', async () => {
    const tenant = await createTenant(prisma);
    const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');
    const plan = await createPlan(prisma, tenant.id, { effectiveFrom });
    const level = await prisma.commissionPlanLevel.findFirstOrThrow({ where: { planId: plan.id } });
    const actor: ActorContext = { userId: '00000000-0000-0000-0000-000000000001', tenantId: tenant.id };

    await expect(
      prisma.commissionPlan.update({ where: { id: plan.id }, data: { name: 'mutated' } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.commissionPlanLevel.update({ where: { id: level.id }, data: { rateBps: 1 } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.commissionPlanLevel.create({ data: { planId: plan.id, level: 7, rateBps: 1 } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      plans.createVersion(actor, {
        name: 'Duplicate date',
        poolRateBps: 1000,
        depth: 1,
        levels: [{ level: 0, rateBps: 500 }],
        effectiveFrom: effectiveFrom.toISOString(),
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('yalniz complete false->true seal gecisine izin verir; rollback parent ve levellari birakmaz', async () => {
    const tenant = await createTenant(prisma);
    const partial = await prisma.commissionPlan.create({
      data: {
        tenantId: tenant.id,
        version: 1,
        finalized: false,
        name: 'Partial',
        poolRateBps: 1000,
        depth: 2,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        levels: { create: [{ level: 0, rateBps: 400 }] },
      },
    });

    await expect(
      prisma.commissionPlan.update({ where: { id: partial.id }, data: { finalized: true } }),
    ).rejects.toThrow(/complete/);
    await expect(
      prisma.commissionPlan.update({ where: { id: partial.id }, data: { finalized: true, name: 'Bypass' } }),
    ).rejects.toThrow(/immutable/);
    await prisma.commissionPlanLevel.create({ data: { planId: partial.id, level: 1, rateBps: 300 } });
    await prisma.commissionPlan.update({ where: { id: partial.id }, data: { finalized: true } });
    await expect(
      prisma.commissionPlan.update({ where: { id: partial.id }, data: { finalized: false } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.commissionPlan.create({
        data: {
          tenantId: tenant.id,
          version: 2,
          finalized: true,
          name: 'Insert bypass',
          poolRateBps: 500,
          depth: 1,
          effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
          levels: { create: [{ level: 0, rateBps: 500 }] },
        },
      }),
    ).rejects.toThrow(/unfinalized/);

    const beforePlans = await prisma.commissionPlan.count({ where: { tenantId: tenant.id } });
    const beforeLevels = await prisma.commissionPlanLevel.count({ where: { plan: { tenantId: tenant.id } } });
    await expect(
      prisma.$transaction(async (tx) => {
        const created = await tx.commissionPlan.create({
          data: {
            tenantId: tenant.id,
            version: 2,
            finalized: false,
            name: 'Rollback',
            poolRateBps: 500,
            depth: 1,
            effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
            levels: { create: [{ level: 0, rateBps: 500 }] },
          },
        });
        await tx.commissionPlan.update({ where: { id: created.id }, data: { finalized: true } });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');
    expect(await prisma.commissionPlan.count({ where: { tenantId: tenant.id } })).toBe(beforePlans);
    expect(await prisma.commissionPlanLevel.count({ where: { plan: { tenantId: tenant.id } } })).toBe(beforeLevels);
  });

  it('finalize ile level insert yarisi plan satiri uzerinden serialize edilir', async () => {
    const tenant = await createTenant(prisma);
    const draft = await prisma.commissionPlan.create({
      data: {
        tenantId: tenant.id,
        version: 1,
        finalized: false,
        name: 'Concurrent seal',
        poolRateBps: 1000,
        depth: 1,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        levels: { create: [{ level: 0, rateBps: 500 }] },
      },
    });

    let releaseFinalize!: () => void;
    const finalizeRelease = new Promise<void>((resolve) => {
      releaseFinalize = resolve;
    });
    let finalizeUpdated!: () => void;
    const finalizeHasRowLock = new Promise<void>((resolve) => {
      finalizeUpdated = resolve;
    });

    const finalizePromise = prisma.$transaction(async (tx) => {
      await tx.commissionPlan.update({ where: { id: draft.id }, data: { finalized: true } });
      finalizeUpdated();
      await finalizeRelease;
    });
    await finalizeHasRowLock;

    let insertSettled = false;
    const insertPromise = prisma
      .$transaction((tx) =>
        tx.commissionPlanLevel.create({
          data: { planId: draft.id, level: 1, rateBps: 100 },
        }),
      )
      .finally(() => {
        insertSettled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const settledBeforeFinalizeCommit = insertSettled;
    releaseFinalize();
    const [finalizeResult, insertResult] = await Promise.allSettled([finalizePromise, insertPromise]);

    expect(settledBeforeFinalizeCommit).toBe(false);
    expect(finalizeResult.status).toBe('fulfilled');
    expect(insertResult.status).toBe('rejected');
    expect(await prisma.commissionPlanLevel.count({ where: { planId: draft.id } })).toBe(1);
    expect((await prisma.commissionPlan.findUniqueOrThrow({ where: { id: draft.id } })).finalized).toBe(true);
  });

  it('partial plan list/settings/engine tarafindan gorunmez; sale provenance ilk pinden sonra sabittir', async () => {
    const tenant = await createTenant(prisma);
    const visible = await createPlan(prisma, tenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500],
    });
    const partial = await prisma.commissionPlan.create({
      data: {
        tenantId: tenant.id,
        version: 2,
        finalized: false,
        name: 'Hidden partial',
        poolRateBps: 900,
        depth: 1,
        effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
        levels: { create: [{ level: 0, rateBps: 900 }] },
      },
    });
    const [seller] = await createChain(prisma, tenant.id, 1);
    const sale = await createSale(prisma, tenant.id, seller.id, 100_000n, {
      saleDate: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect((await plans.list(tenant.id)).plans.map((plan) => plan.id)).toEqual([visible.id]);
    await expect(settings.getPlanBonus(tenant.id)).resolves.toMatchObject({ planId: visible.id });
    await engine.approveSale(sale.id);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBe(visible.id);

    const alternative = await createPlan(prisma, tenant.id, {
      version: 3,
      effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
      rates: [600],
    });
    await prisma.sale.update({
      where: { id: sale.id },
      data: { commissionPlanId: visible.id, status: SaleStatus.approved },
    });
    await expect(
      prisma.sale.update({ where: { id: sale.id }, data: { commissionPlanId: alternative.id } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.sale.update({ where: { id: sale.id }, data: { commissionPlanId: null } }),
    ).rejects.toThrow(/immutable/);
    expect(partial.finalized).toBe(false);
  });
});
