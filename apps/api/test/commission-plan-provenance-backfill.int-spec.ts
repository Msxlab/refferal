import { LedgerStatus, LedgerType, SaleStatus } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createSale, createTenant, truncateAll } from './helpers';

let sequence = 0;
const initialBackfillSql = readFileSync(
  resolve(
    __dirname,
    '../prisma/migrations/20260715100200_backfill_unambiguous_sale_commission_plan_provenance/migration.sql',
  ),
  'utf8',
);
const initialBackfillLocks = initialBackfillSql.match(/LOCK TABLE[^;]+;/g) ?? [];
const initialBackfillStatement = initialBackfillSql.slice(initialBackfillSql.indexOf('WITH evidence AS'));

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
    return prisma.$transaction(async (tx) => {
      const depth = options.depth ?? rates.length;
      const plan = await tx.commissionPlan.create({
        data: {
          tenantId,
          version: options.version,
          finalized: false,
          name: `Backfill plan ${++sequence}`,
          poolRateBps: rates.reduce((sum, rate) => sum + rate, 0),
          depth,
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
      if (rates.length !== depth) return plan;
      return tx.commissionPlan.update({
        where: { id: plan.id },
        data: { finalized: true, updatedAt },
      });
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

  async function runBackfill(): Promise<number> {
    const [result] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT reconcile_sale_commission_plan_provenance() AS count
    `;
    return Number(result.count);
  }

  async function runInitialBackfillMigration(): Promise<number> {
    return prisma.$transaction(async (tx) => {
      for (const lock of initialBackfillLocks) await tx.$executeRawUnsafe(lock);
      return tx.$executeRawUnsafe(initialBackfillStatement);
    });
  }

  it('both backfill stages pin only the uniquely proven historical winner and are idempotent', async () => {
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

    expect(await runInitialBackfillMigration()).toBe(1);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBe(plan.id);

    const reconciledSale = await createLegacySale(tenant.id, seller.id, saleDate);
    await createEvidence({
      tenantId: tenant.id,
      saleId: reconciledSale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: evidenceAt,
    });

    const sameTransactionCounts = await prisma.$transaction(async (tx) => {
      const [first] = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT reconcile_sale_commission_plan_provenance() AS count
      `;
      const [second] = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT reconcile_sale_commission_plan_provenance() AS count
      `;
      return [Number(first.count), Number(second.count)];
    });
    expect(sameTransactionCounts).toEqual([1, 0]);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: reconciledSale.id } })).commissionPlanId).toBe(
      plan.id,
    );
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

  it('treats an incomplete post-evidence higher legacy plan as attribution uncertainty', async () => {
    const tenant = await createTenant(prisma);
    const [seller] = await createChain(prisma, tenant.id, 1);
    await createTimedPlan(tenant.id, {
      version: 1,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500],
    });
    await createTimedPlan(tenant.id, {
      version: 2,
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      rates: [500],
      depth: 2,
    });
    const sale = await createLegacySale(
      tenant.id,
      seller.id,
      new Date('2026-06-01T12:00:00.000Z'),
    );
    await createEvidence({
      tenantId: tenant.id,
      saleId: sale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: new Date('2026-06-02T12:00:00.000Z'),
    });

    expect(await runInitialBackfillMigration()).toBe(0);
    expect(await runBackfill()).toBe(0);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBeNull();
  });

  it('does not fall back to a lower exact plan when the historical winner is incomplete', async () => {
    const tenant = await createTenant(prisma);
    const [seller] = await createChain(prisma, tenant.id, 1);
    await createTimedPlan(tenant.id, {
      version: 1,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500],
    });
    await createTimedPlan(tenant.id, {
      version: 2,
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      rates: [500],
      depth: 2,
    });
    const sale = await createLegacySale(
      tenant.id,
      seller.id,
      new Date('2026-06-01T12:00:00.000Z'),
    );
    await createEvidence({
      tenantId: tenant.id,
      saleId: sale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: new Date('2026-06-02T12:00:00.000Z'),
    });

    expect(await runInitialBackfillMigration()).toBe(0);
    expect(await runBackfill()).toBe(0);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBeNull();
  });

  it('does not fall back to a lower exact plan when the historical winner signature mismatches', async () => {
    const tenant = await createTenant(prisma);
    const [seller] = await createChain(prisma, tenant.id, 1);
    await createTimedPlan(tenant.id, {
      version: 1,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500],
    });
    await createTimedPlan(tenant.id, {
      version: 2,
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      rates: [600],
    });
    const sale = await createLegacySale(
      tenant.id,
      seller.id,
      new Date('2026-06-01T12:00:00.000Z'),
    );
    await createEvidence({
      tenantId: tenant.id,
      saleId: sale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: new Date('2026-06-02T12:00:00.000Z'),
    });

    expect(await runInitialBackfillMigration()).toBe(0);
    expect(await runBackfill()).toBe(0);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBeNull();
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

  it('rejects untrusted evidence but accepts a void original while ignoring its reversal', async () => {
    const planTime = new Date('2026-01-01T00:00:00.000Z');
    const saleDate = new Date('2026-06-01T12:00:00.000Z');
    const evidenceAt = new Date('2026-06-02T12:00:00.000Z');
    const tenant = await createTenant(prisma);
    const plan = await createTimedPlan(tenant.id, {
      version: 1,
      effectiveFrom: planTime,
      createdAt: planTime,
    });
    const [seller] = await createChain(prisma, tenant.id, 1);
    const guardedIds: string[] = [];

    const synthetic = await createLegacySale(tenant.id, seller.id, saleDate);
    guardedIds.push(synthetic.id);
    await createEvidence({ tenantId: tenant.id, saleId: synthetic.id, beneficiaryMembershipId: seller.id, createdAt: evidenceAt });
    await createEvidence({
      tenantId: tenant.id,
      saleId: synthetic.id,
      beneficiaryMembershipId: seller.id,
      createdAt: evidenceAt,
      level: 1000,
      rateBps: 100,
      amountCents: 1_000n,
    });

    const split = await createLegacySale(tenant.id, seller.id, saleDate);
    guardedIds.push(split.id);
    await createEvidence({ tenantId: tenant.id, saleId: split.id, beneficiaryMembershipId: seller.id, createdAt: evidenceAt });
    await createEvidence({
      tenantId: tenant.id,
      saleId: split.id,
      beneficiaryMembershipId: seller.id,
      createdAt: new Date(evidenceAt.getTime() + 1_000),
      level: 1,
    });

    const foreignTenant = await createTenant(prisma);
    const [foreignMember] = await createChain(prisma, foreignTenant.id, 1);
    const crossTenant = await createLegacySale(tenant.id, seller.id, saleDate);
    guardedIds.push(crossTenant.id);
    await createEvidence({
      tenantId: foreignTenant.id,
      saleId: crossTenant.id,
      beneficiaryMembershipId: foreignMember.id,
      createdAt: evidenceAt,
    });

    const wrongAmount = await createLegacySale(tenant.id, seller.id, saleDate);
    guardedIds.push(wrongAmount.id);
    await createEvidence({
      tenantId: tenant.id,
      saleId: wrongAmount.id,
      beneficiaryMembershipId: seller.id,
      createdAt: evidenceAt,
      amountCents: 4_999n,
    });

    const draft = await createSale(prisma, tenant.id, seller.id, 100_000n, { saleDate });
    guardedIds.push(draft.id);
    await createEvidence({ tenantId: tenant.id, saleId: draft.id, beneficiaryMembershipId: seller.id, createdAt: evidenceAt });

    const missingApproval = await createSale(prisma, tenant.id, seller.id, 100_000n, {
      saleDate,
      status: SaleStatus.approved,
    });
    guardedIds.push(missingApproval.id);
    await createEvidence({
      tenantId: tenant.id,
      saleId: missingApproval.id,
      beneficiaryMembershipId: seller.id,
      createdAt: evidenceAt,
    });

    const noLedger = await createLegacySale(tenant.id, seller.id, saleDate);
    guardedIds.push(noLedger.id);

    const voidSale = await createLegacySale(tenant.id, seller.id, saleDate);
    await prisma.sale.update({ where: { id: voidSale.id }, data: { status: SaleStatus.void } });
    await createEvidence({ tenantId: tenant.id, saleId: voidSale.id, beneficiaryMembershipId: seller.id, createdAt: evidenceAt });
    await prisma.ledgerEntry.create({
      data: {
        tenantId: tenant.id,
        saleId: voidSale.id,
        beneficiaryMembershipId: seller.id,
        level: 0,
        rateBpsUsed: 500,
        amountCents: -5_000n,
        type: LedgerType.reversal,
        status: LedgerStatus.reversed,
        createdAt: new Date(evidenceAt.getTime() + 1_000),
        updatedAt: new Date(evidenceAt.getTime() + 1_000),
      },
    });

    expect(await runInitialBackfillMigration()).toBe(1);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: voidSale.id } })).commissionPlanId).toBe(plan.id);
    expect(await runBackfill()).toBe(0);
    const guarded = await prisma.sale.findMany({ where: { id: { in: guardedIds } } });
    expect(guarded.every((sale) => sale.commissionPlanId === null)).toBe(true);
  });

  it('treats distinct plausible plan identities as ambiguous even when used commission rates match', async () => {
    const tenant = await createTenant(prisma);
    const [seller] = await createChain(prisma, tenant.id, 1);
    await createTimedPlan(tenant.id, {
      version: 1,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500],
    });
    await createTimedPlan(tenant.id, {
      version: 2,
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      rates: [500, 100],
    });
    const sale = await createLegacySale(
      tenant.id,
      seller.id,
      new Date('2026-06-01T12:00:00.000Z'),
    );
    await createEvidence({
      tenantId: tenant.id,
      saleId: sale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: new Date('2026-06-02T12:00:00.000Z'),
      rateBps: 500,
      amountCents: 5_000n,
    });

    expect(await runInitialBackfillMigration()).toBe(0);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBeNull();
    expect(await runBackfill()).toBe(0);
  });

  it('preserves an authoritative pin created between conservative reconciliation passes', async () => {
    const tenant = await createTenant(prisma);
    const [seller] = await createChain(prisma, tenant.id, 1);
    const authoritativePlan = await createTimedPlan(tenant.id, {
      version: 1,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500],
    });
    await createTimedPlan(tenant.id, {
      version: 2,
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      rates: [500],
    });
    const sale = await createLegacySale(
      tenant.id,
      seller.id,
      new Date('2026-06-01T12:00:00.000Z'),
    );
    await createEvidence({
      tenantId: tenant.id,
      saleId: sale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: new Date('2026-06-02T12:00:00.000Z'),
    });

    // Initial conservative pass (151002 semantics): ambiguity must remain unpinned.
    expect(await runBackfill()).toBe(0);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBeNull();

    // Simulate the engine authoritatively pinning after 151002 and before 151005.
    await prisma.sale.update({
      where: { id: sale.id },
      data: { commissionPlanId: authoritativePlan.id },
    });

    // 151005 and any post-151006 rerun must be idempotent and must never touch a non-null pin.
    expect(await runBackfill()).toBe(0);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBe(
      authoritativePlan.id,
    );
    expect(await runBackfill()).toBe(0);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBe(
      authoritativePlan.id,
    );
  });
});
