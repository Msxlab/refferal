import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LedgerStatus, LedgerType, SaleStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createSale, createTenant, truncateAll } from './helpers';

const migrationPath = join(
  __dirname,
  '../prisma/migrations/20260715100200_backfill_unambiguous_sale_commission_plan_provenance/migration.sql',
);

let sequence = 0;

describe('commission plan provenance backfill (integration)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });
  afterAll(async () => prisma.$disconnect());
  beforeEach(async () => truncateAll(prisma));

  async function createTimedPlan(
    tenantId: string,
    options: {
      version: number;
      effectiveFrom: Date;
      createdAt: Date;
      updatedAt?: Date;
      rates?: number[];
      depth?: number;
    },
  ) {
    const rates = options.rates ?? [500];
    const updatedAt = options.updatedAt ?? options.createdAt;
    return prisma.commissionPlan.create({
      data: {
        tenantId,
        version: options.version,
        name: `Backfill plan ${++sequence}`,
        poolRateBps: rates.reduce((sum, rate) => sum + rate, 0),
        depth: options.depth ?? rates.length,
        effectiveFrom: options.effectiveFrom,
        createdAt: options.createdAt,
        updatedAt,
        levels: {
          create: rates.map((rateBps, level) => ({
            level,
            rateBps,
            createdAt: options.createdAt,
            updatedAt,
          })),
        },
      },
    });
  }

  async function createLegacySale(
    tenantId: string,
    sellerMembershipId: string,
    saleDate: Date,
    amountCents = 100_000n,
  ) {
    const sale = await createSale(prisma, tenantId, sellerMembershipId, amountCents, {
      saleDate,
      status: SaleStatus.approved,
    });
    return prisma.sale.update({ where: { id: sale.id }, data: { approvedAt: saleDate } });
  }

  async function createEvidence(options: {
    tenantId: string;
    saleId: string;
    beneficiaryMembershipId: string;
    createdAt: Date;
    level?: number;
    rateBps?: number;
    amountCents?: bigint;
  }) {
    return prisma.ledgerEntry.create({
      data: {
        tenantId: options.tenantId,
        saleId: options.saleId,
        beneficiaryMembershipId: options.beneficiaryMembershipId,
        level: options.level ?? 0,
        rateBpsUsed: options.rateBps ?? 500,
        amountCents: options.amountCents ?? 5_000n,
        type: LedgerType.commission,
        status: LedgerStatus.payable,
        createdAt: options.createdAt,
        updatedAt: options.createdAt,
      },
    });
  }

  function runBackfill(): Promise<number> {
    return prisma.$executeRawUnsafe(readFileSync(migrationPath, 'utf8'));
  }

  it('pins only the uniquely proven historical snapshot and is idempotent', async () => {
    const planTime = new Date('2026-01-01T00:00:00.000Z');
    const saleDate = new Date('2026-06-01T12:00:00.000Z');
    const evidenceAt = new Date('2026-06-02T12:00:00.000Z');
    const tenant = await createTenant(prisma);
    const plan = await createTimedPlan(tenant.id, { version: 1, effectiveFrom: planTime, createdAt: planTime });
    const [seller] = await createChain(prisma, tenant.id, 1);
    const sale = await createLegacySale(tenant.id, seller.id, saleDate);
    await createEvidence({
      tenantId: tenant.id,
      saleId: sale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: evidenceAt,
    });

    expect(await runBackfill()).toBe(1);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBe(plan.id);
    expect(await runBackfill()).toBe(0);
  });

  it('leaves late-backdated and no-plan history null instead of guessing', async () => {
    const saleDate = new Date('2026-06-01T12:00:00.000Z');
    const evidenceAt = new Date('2026-06-02T12:00:00.000Z');
    const guardedIds: string[] = [];

    const lateTenant = await createTenant(prisma);
    const [lateSeller] = await createChain(prisma, lateTenant.id, 1);
    await createTimedPlan(lateTenant.id, {
      version: 1,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await createTimedPlan(lateTenant.id, {
      version: 2,
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      rates: [700],
    });
    const lateSale = await createLegacySale(lateTenant.id, lateSeller.id, saleDate);
    guardedIds.push(lateSale.id);
    await createEvidence({
      tenantId: lateTenant.id,
      saleId: lateSale.id,
      beneficiaryMembershipId: lateSeller.id,
      createdAt: evidenceAt,
    });

    const noPlanTenant = await createTenant(prisma);
    const [noPlanSeller] = await createChain(prisma, noPlanTenant.id, 1);
    const noPlanSale = await createLegacySale(noPlanTenant.id, noPlanSeller.id, saleDate);
    guardedIds.push(noPlanSale.id);
    await createEvidence({
      tenantId: noPlanTenant.id,
      saleId: noPlanSale.id,
      beneficiaryMembershipId: noPlanSeller.id,
      createdAt: evidenceAt,
    });

    expect(await runBackfill()).toBe(0);
    const guarded = await prisma.sale.findMany({ where: { id: { in: guardedIds } } });
    expect(guarded.every((sale) => sale.commissionPlanId === null)).toBe(true);
  });

  it('requires a complete immutable level snapshot and an exact ledger signature', async () => {
    const planTime = new Date('2026-01-01T00:00:00.000Z');
    const saleDate = new Date('2026-06-01T12:00:00.000Z');
    const evidenceAt = new Date('2026-06-02T12:00:00.000Z');
    const guardedIds: string[] = [];

    const incompleteTenant = await createTenant(prisma);
    const [incompleteSeller] = await createChain(prisma, incompleteTenant.id, 1);
    await createTimedPlan(incompleteTenant.id, {
      version: 1,
      effectiveFrom: planTime,
      createdAt: planTime,
      rates: [500],
      depth: 2,
    });
    const incompleteSale = await createLegacySale(incompleteTenant.id, incompleteSeller.id, saleDate);
    guardedIds.push(incompleteSale.id);
    await createEvidence({
      tenantId: incompleteTenant.id,
      saleId: incompleteSale.id,
      beneficiaryMembershipId: incompleteSeller.id,
      createdAt: evidenceAt,
    });

    const mismatchTenant = await createTenant(prisma);
    const [mismatchSeller] = await createChain(prisma, mismatchTenant.id, 1);
    await createTimedPlan(mismatchTenant.id, { version: 1, effectiveFrom: planTime, createdAt: planTime });
    const mismatchSale = await createLegacySale(mismatchTenant.id, mismatchSeller.id, saleDate);
    guardedIds.push(mismatchSale.id);
    await createEvidence({
      tenantId: mismatchTenant.id,
      saleId: mismatchSale.id,
      beneficiaryMembershipId: mismatchSeller.id,
      createdAt: evidenceAt,
      rateBps: 600,
      amountCents: 6_000n,
    });

    expect(await runBackfill()).toBe(0);
    const guarded = await prisma.sale.findMany({ where: { id: { in: guardedIds } } });
    expect(guarded.every((sale) => sale.commissionPlanId === null)).toBe(true);
  });
});
