import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LedgerStatus, LedgerType, SaleStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createSale, createTenant, truncateAll } from './helpers';

const migrationPath = join(
  __dirname,
  '../prisma/migrations/20260714140000_backfill_unambiguous_sale_commission_plan_provenance/migration.sql',
);

let sequence = 0;

describe('commission plan provenance backfill (integration)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  async function createTimedPlan(
    tenantId: string,
    options: {
      effectiveFrom: Date;
      createdAt: Date;
      updatedAt?: Date;
      levelCreatedAt?: Date;
      levelUpdatedAt?: Date;
      rates?: number[];
      depth?: number;
    },
  ) {
    const rates = options.rates ?? [500];
    const updatedAt = options.updatedAt ?? options.createdAt;
    const levelCreatedAt = options.levelCreatedAt ?? options.createdAt;
    const levelUpdatedAt = options.levelUpdatedAt ?? levelCreatedAt;
    return prisma.commissionPlan.create({
      data: {
        tenantId,
        name: `Backfill plan ${++sequence}`,
        poolRateBps: rates.reduce((total, rate) => total + rate, 0),
        depth: options.depth ?? rates.length,
        effectiveFrom: options.effectiveFrom,
        createdAt: options.createdAt,
        updatedAt,
        levels: {
          create: rates.map((rateBps, level) => ({
            level,
            rateBps,
            createdAt: levelCreatedAt,
            updatedAt: levelUpdatedAt,
          })),
        },
      },
    });
  }

  async function createLegacySale(
    tenantId: string,
    sellerMembershipId: string,
    options: { saleDate: Date; status?: SaleStatus; amountCents?: bigint },
  ) {
    const status = options.status ?? SaleStatus.approved;
    const sale = await createSale(prisma, tenantId, sellerMembershipId, options.amountCents ?? 100_000n, {
      saleDate: options.saleDate,
      status,
    });
    if (status === SaleStatus.draft) return sale;
    return prisma.sale.update({
      where: { id: sale.id },
      data: { approvedAt: options.saleDate },
    });
  }

  async function createLedgerEvidence(options: {
    tenantId: string;
    saleId: string;
    beneficiaryMembershipId: string;
    createdAt: Date;
    level?: number;
    rateBps?: number;
    amountCents?: bigint;
    type?: LedgerType;
    status?: LedgerStatus;
  }) {
    const type = options.type ?? LedgerType.commission;
    return prisma.ledgerEntry.create({
      data: {
        tenantId: options.tenantId,
        saleId: options.saleId,
        beneficiaryMembershipId: options.beneficiaryMembershipId,
        level: options.level ?? 0,
        rateBpsUsed: options.rateBps ?? 500,
        amountCents: options.amountCents ?? (type === LedgerType.commission ? 5_000n : -5_000n),
        type,
        status: options.status ?? LedgerStatus.payable,
        createdAt: options.createdAt,
        updatedAt: options.createdAt,
      },
    });
  }

  async function runBackfill(): Promise<number> {
    return prisma.$executeRawUnsafe(readFileSync(migrationPath, 'utf8'));
  }

  it('pins the unique trusted as-of plan, ignores another tenant, and is idempotent', async () => {
    const planTime = new Date('2026-01-01T00:00:00.000Z');
    const saleDate = new Date('2026-06-01T12:00:00.000Z');
    const evidenceAt = new Date('2026-06-02T12:00:00.000Z');
    const tenant = await createTenant(prisma);
    const otherTenant = await createTenant(prisma);
    const plan = await createTimedPlan(tenant.id, { effectiveFrom: planTime, createdAt: planTime });
    await createTimedPlan(otherTenant.id, { effectiveFrom: planTime, createdAt: planTime });
    const [seller] = await createChain(prisma, tenant.id, 1);
    const sale = await createLegacySale(tenant.id, seller.id, { saleDate });
    await createLedgerEvidence({
      tenantId: tenant.id,
      saleId: sale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: evidenceAt,
    });
    const before = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });

    expect(await runBackfill()).toBe(1);
    const after = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(after.commissionPlanId).toBe(plan.id);
    expect(after.status).toBe(before.status);
    expect(after.updatedAt).toEqual(before.updatedAt);

    expect(await runBackfill()).toBe(0);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBe(plan.id);
  });

  it('uses native timestamp boundaries without truncation', async () => {
    const tenant = await createTenant(prisma);
    const [seller] = await createChain(prisma, tenant.id, 1);
    const boundary = new Date('2026-06-10T12:00:00.000Z');
    const evidenceAt = new Date('2026-06-11T12:00:00.000Z');
    const oldPlan = await createTimedPlan(tenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500],
    });
    const newPlan = await createTimedPlan(tenant.id, {
      effectiveFrom: boundary,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      rates: [600],
    });
    const cases = [
      { date: new Date(boundary.getTime() - 1), rate: 500, amount: 5_000n, planId: oldPlan.id },
      { date: boundary, rate: 600, amount: 6_000n, planId: newPlan.id },
      { date: new Date(boundary.getTime() + 1), rate: 600, amount: 6_000n, planId: newPlan.id },
    ];
    const saleIds: string[] = [];
    for (const item of cases) {
      const sale = await createLegacySale(tenant.id, seller.id, { saleDate: item.date });
      saleIds.push(sale.id);
      await createLedgerEvidence({
        tenantId: tenant.id,
        saleId: sale.id,
        beneficiaryMembershipId: seller.id,
        createdAt: evidenceAt,
        rateBps: item.rate,
        amountCents: item.amount,
      });
    }

    expect(await runBackfill()).toBe(3);
    const persisted = await prisma.sale.findMany({ where: { id: { in: saleIds } } });
    const byId = new Map(persisted.map((sale) => [sale.id, sale.commissionPlanId]));
    cases.forEach((item, index) => expect(byId.get(saleIds[index])).toBe(item.planId));
  });

  it('accepts a plan created after the sale but before commission evidence', async () => {
    const tenant = await createTenant(prisma);
    const [seller] = await createChain(prisma, tenant.id, 1);
    await createTimedPlan(tenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500],
    });
    const usedPlan = await createTimedPlan(tenant.id, {
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      createdAt: new Date('2026-06-10T12:00:01.000Z'),
      rates: [600],
    });
    const sale = await createLegacySale(tenant.id, seller.id, {
      saleDate: new Date('2026-06-10T12:00:00.000Z'),
    });
    await createLedgerEvidence({
      tenantId: tenant.id,
      saleId: sale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: new Date('2026-06-10T12:00:02.000Z'),
      rateBps: 600,
      amountCents: 6_000n,
    });

    expect(await runBackfill()).toBe(1);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBe(usedPlan.id);
  });

  it('leaves ambiguous or untrusted historical evidence null without falling back', async () => {
    const evidenceAt = new Date('2026-06-10T12:00:00.000Z');
    const saleDate = new Date('2026-06-01T12:00:00.000Z');
    const guardedSaleIds: string[] = [];

    // A higher eligible plan created after the transaction-start evidence could have been used.
    const lateTenant = await createTenant(prisma);
    const [lateSeller] = await createChain(prisma, lateTenant.id, 1);
    await createTimedPlan(lateTenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500],
    });
    await createTimedPlan(lateTenant.id, {
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      rates: [700],
    });
    const lateSale = await createLegacySale(lateTenant.id, lateSeller.id, { saleDate });
    guardedSaleIds.push(lateSale.id);
    await createLedgerEvidence({
      tenantId: lateTenant.id,
      saleId: lateSale.id,
      beneficiaryMembershipId: lateSeller.id,
      createdAt: evidenceAt,
    });

    // The higher as-of winner is mutable evidence, so an older matching plan must not win.
    const fallbackTenant = await createTenant(prisma);
    const [fallbackSeller] = await createChain(prisma, fallbackTenant.id, 1);
    await createTimedPlan(fallbackTenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500],
    });
    await createTimedPlan(fallbackTenant.id, {
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      rates: [600],
    });
    const fallbackSale = await createLegacySale(fallbackTenant.id, fallbackSeller.id, { saleDate });
    guardedSaleIds.push(fallbackSale.id);
    await createLedgerEvidence({
      tenantId: fallbackTenant.id,
      saleId: fallbackSale.id,
      beneficiaryMembershipId: fallbackSeller.id,
      createdAt: evidenceAt,
      rateBps: 500,
      amountCents: 5_000n,
    });

    // Split evidence timestamps and a bad amount are not one immutable application event.
    const splitTenant = await createTenant(prisma);
    const splitChain = await createChain(prisma, splitTenant.id, 2);
    await createTimedPlan(splitTenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500, 200],
    });
    const splitSale = await createLegacySale(splitTenant.id, splitChain[1].id, { saleDate });
    guardedSaleIds.push(splitSale.id);
    await createLedgerEvidence({
      tenantId: splitTenant.id,
      saleId: splitSale.id,
      beneficiaryMembershipId: splitChain[1].id,
      createdAt: evidenceAt,
      level: 0,
      rateBps: 500,
      amountCents: 5_001n,
    });
    await createLedgerEvidence({
      tenantId: splitTenant.id,
      saleId: splitSale.id,
      beneficiaryMembershipId: splitChain[0].id,
      createdAt: new Date(evidenceAt.getTime() + 1),
      level: 1,
      rateBps: 200,
      amountCents: 2_000n,
    });

    // Tenant mismatch must be observed and rejected, not hidden by the evidence join.
    const mismatchTenant = await createTenant(prisma);
    const otherTenant = await createTenant(prisma);
    const [mismatchSeller] = await createChain(prisma, mismatchTenant.id, 1);
    await createTimedPlan(mismatchTenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const mismatchSale = await createLegacySale(mismatchTenant.id, mismatchSeller.id, { saleDate });
    guardedSaleIds.push(mismatchSale.id);
    await createLedgerEvidence({
      tenantId: otherTenant.id,
      saleId: mismatchSale.id,
      beneficiaryMembershipId: mismatchSeller.id,
      createdAt: evidenceAt,
    });

    // A matching rate is insufficient when the persisted integer amount is wrong.
    const amountTenant = await createTenant(prisma);
    const [amountSeller] = await createChain(prisma, amountTenant.id, 1);
    await createTimedPlan(amountTenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const amountSale = await createLegacySale(amountTenant.id, amountSeller.id, { saleDate });
    guardedSaleIds.push(amountSale.id);
    await createLedgerEvidence({
      tenantId: amountTenant.id,
      saleId: amountSale.id,
      beneficiaryMembershipId: amountSeller.id,
      createdAt: evidenceAt,
      amountCents: 5_001n,
    });

    // A level changed after the evidence cutoff cannot prove the old snapshot.
    const mutableLevelTenant = await createTenant(prisma);
    const [mutableLevelSeller] = await createChain(prisma, mutableLevelTenant.id, 1);
    await createTimedPlan(mutableLevelTenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      levelUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    const mutableLevelSale = await createLegacySale(mutableLevelTenant.id, mutableLevelSeller.id, { saleDate });
    guardedSaleIds.push(mutableLevelSale.id);
    await createLedgerEvidence({
      tenantId: mutableLevelTenant.id,
      saleId: mutableLevelSale.id,
      beneficiaryMembershipId: mutableLevelSeller.id,
      createdAt: evidenceAt,
    });

    // Membership ownership is evidence too; independent foreign keys are not enough.
    const membershipTenant = await createTenant(prisma);
    const foreignMembershipTenant = await createTenant(prisma);
    const [memberSeller] = await createChain(prisma, membershipTenant.id, 1);
    const [foreignMember] = await createChain(prisma, foreignMembershipTenant.id, 1);
    await createTimedPlan(membershipTenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const badBeneficiarySale = await createLegacySale(membershipTenant.id, memberSeller.id, { saleDate });
    guardedSaleIds.push(badBeneficiarySale.id);
    await createLedgerEvidence({
      tenantId: membershipTenant.id,
      saleId: badBeneficiarySale.id,
      beneficiaryMembershipId: foreignMember.id,
      createdAt: evidenceAt,
    });
    const badSellerSale = await createLegacySale(membershipTenant.id, foreignMember.id, { saleDate });
    guardedSaleIds.push(badSellerSale.id);
    await createLedgerEvidence({
      tenantId: membershipTenant.id,
      saleId: badSellerSale.id,
      beneficiaryMembershipId: memberSeller.id,
      createdAt: evidenceAt,
    });

    // A written level outside the historical plan depth is not valid provenance.
    const depthTenant = await createTenant(prisma);
    const depthChain = await createChain(prisma, depthTenant.id, 2);
    await createTimedPlan(depthTenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500, 200],
      depth: 1,
    });
    const depthSale = await createLegacySale(depthTenant.id, depthChain[1].id, { saleDate });
    guardedSaleIds.push(depthSale.id);
    await createLedgerEvidence({
      tenantId: depthTenant.id,
      saleId: depthSale.id,
      beneficiaryMembershipId: depthChain[0].id,
      createdAt: evidenceAt,
      level: 1,
      rateBps: 200,
      amountCents: 2_000n,
    });

    // No eligible plan and exact-cutoff plan creation both remain unknown.
    const noPlanTenant = await createTenant(prisma);
    const [noPlanSeller] = await createChain(prisma, noPlanTenant.id, 1);
    const noPlanSale = await createLegacySale(noPlanTenant.id, noPlanSeller.id, { saleDate });
    guardedSaleIds.push(noPlanSale.id);
    await createLedgerEvidence({
      tenantId: noPlanTenant.id,
      saleId: noPlanSale.id,
      beneficiaryMembershipId: noPlanSeller.id,
      createdAt: evidenceAt,
    });
    const cutoffTenant = await createTenant(prisma);
    const [cutoffSeller] = await createChain(prisma, cutoffTenant.id, 1);
    await createTimedPlan(cutoffTenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: evidenceAt,
    });
    const cutoffSale = await createLegacySale(cutoffTenant.id, cutoffSeller.id, { saleDate });
    guardedSaleIds.push(cutoffSale.id);
    await createLedgerEvidence({
      tenantId: cutoffTenant.id,
      saleId: cutoffSale.id,
      beneficiaryMembershipId: cutoffSeller.id,
      createdAt: evidenceAt,
    });

    expect(await runBackfill()).toBe(0);
    const guarded = await prisma.sale.findMany({ where: { id: { in: guardedSaleIds } } });
    expect(guarded.every((sale) => sale.commissionPlanId === null)).toBe(true);
  });

  it('handles void sales but never touches draft, no-ledger, reversal-only, or existing provenance', async () => {
    const tenant = await createTenant(prisma);
    const [seller] = await createChain(prisma, tenant.id, 1);
    const plan = await createTimedPlan(tenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const saleDate = new Date('2026-06-01T12:00:00.000Z');
    const evidenceAt = new Date('2026-06-02T12:00:00.000Z');

    const voidSale = await createLegacySale(tenant.id, seller.id, { saleDate, status: SaleStatus.void });
    await createLedgerEvidence({
      tenantId: tenant.id,
      saleId: voidSale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: evidenceAt,
      status: LedgerStatus.reversed,
    });

    const draftSale = await createLegacySale(tenant.id, seller.id, { saleDate, status: SaleStatus.draft });
    await createLedgerEvidence({
      tenantId: tenant.id,
      saleId: draftSale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: evidenceAt,
    });
    const noLedgerSale = await createLegacySale(tenant.id, seller.id, { saleDate });
    const reversalOnlySale = await createLegacySale(tenant.id, seller.id, { saleDate });
    await createLedgerEvidence({
      tenantId: tenant.id,
      saleId: reversalOnlySale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: evidenceAt,
      type: LedgerType.reversal,
      status: LedgerStatus.reversed,
    });
    const pinnedSale = await createLegacySale(tenant.id, seller.id, { saleDate });
    await prisma.sale.update({ where: { id: pinnedSale.id }, data: { commissionPlanId: plan.id } });
    await createLedgerEvidence({
      tenantId: tenant.id,
      saleId: pinnedSale.id,
      beneficiaryMembershipId: seller.id,
      createdAt: evidenceAt,
    });

    expect(await runBackfill()).toBe(1);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: voidSale.id } })).commissionPlanId).toBe(plan.id);
    const untouched = await prisma.sale.findMany({
      where: { id: { in: [draftSale.id, noLedgerSale.id, reversalOnlySale.id] } },
    });
    expect(untouched.every((sale) => sale.commissionPlanId === null)).toBe(true);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: pinnedSale.id } })).commissionPlanId).toBe(plan.id);
  });
});
