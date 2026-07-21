import { LedgerStatus, LedgerType, MaturationRule, MembershipStatus, SaleStatus } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
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
 * SPEC Section 11 - T1..T10 engine scenarios against real Postgres.
 * Default plan: 10% pool, 5 levels = 500/200/150/100/50 bps.
 */
describe('commission engine (integration)', () => {
  let prisma: PrismaService;
  let engine: EngineService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    engine = new EngineService(prisma, undefined, new RanksService(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('T1: $100,000 sale, 4+ uplines -> 5000/2000/1500/1000/500, total $10,000', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6); // Root + 5 members, seller at the bottom.
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
    // on_approval -> immediately payable.
    expect(entries.every((e) => e.status === LedgerStatus.payable)).toBe(true);

    const total = entries.reduce((a, e) => a + e.amountCents, 0n);
    expect(total).toBe(1_000_000n);

    // Summary was written in the same transaction.
    const sellerSummary = await summaryTotals(prisma, seller.id);
    expect(sellerSummary.payable).toBe(500_000n);

    // Outbox notifications were written.
    const notifications = await prisma.notification.count({ where: { template: 'commission_earned' } });
    expect(notifications).toBe(5);
  });

  it('T2: founder sells with 0 uplines -> only seller gets $5,000, no other rows', async () => {
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
    // Remaining $5,000 is not distributed; there are no other rows.
  });

  it('T3: seller has only 2 uplines -> writes L0/L1/L2, no L3/L4 rows', async () => {
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

  it('T4: second applyCommissions call on same sale writes no new rows (idempotent)', async () => {
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

  it('T5: voiding an approved sale creates equal-opposite reversals, zero member net, and lower summary', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    const seller = chain[5];

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);

    const result = await engine.voidSale(sale.id);
    expect(result.voided).toBe(true);
    expect(result.reversalCount).toBe(5);

    // Equal-opposite reversal for every commission row.
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
    // Original rows are not deleted; they are marked reversed.
    expect(commissions.every((e) => e.status === LedgerStatus.reversed)).toBe(true);

    // Member net effect is 0.
    for (const m of chain.slice(1)) {
      expect(await netLedger(prisma, m.id)).toBe(0n);
    }
    // Summary decreased.
    const s = await summaryTotals(prisma, seller.id);
    expect(s).toEqual({ pending: 0n, payable: 0n, processing: 0n, paid: 0n });

    // A voided sale cannot be approved again.
    await expect(engine.approveSale(sale.id)).rejects.toThrow();
  });

  it('T5b: reversal of a paid row stays payable -> balance becomes negative for offset', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [founder] = await createChain(prisma, tenant.id, 1);

    const sale = await createSale(prisma, tenant.id, founder.id, 10_000_000n);
    await engine.approveSale(sale.id);

    // Simulate what the payout module does: payable -> paid plus summary movement.
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
    expect(reversal.status).toBe(LedgerStatus.payable); // Offset against future earnings.

    const original = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(original.status).toBe(LedgerStatus.paid); // Paid row remains paid.

    const s = await summaryTotals(prisma, founder.id);
    expect(s.payable).toBe(-500_000n); // Negative balance.
    expect(s.paid).toBe(500_000n); // Actual paid amount does not change.
  });

  it('T6: plan changes are not applied retroactively; new sale uses new rate', async () => {
    const tenant = await createTenant(prisma);
    const now = new Date('2026-06-10T12:00:00Z');
    const tomorrow = new Date('2026-06-11T12:00:00Z');
    const dayAfter = new Date('2026-06-12T12:00:00Z');

    const originalPlan = await createPlan(prisma, tenant.id, { effectiveFrom: new Date('2026-01-01T00:00:00Z') });
    const chain = await createChain(prisma, tenant.id, 6);

    // Sale with the old plan.
    const oldSale = await createSale(prisma, tenant.id, chain[5].id, 10_000_000n, { saleDate: now });
    await engine.approveSale(oldSale.id);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: oldSale.id } })).commissionPlanId).toBe(originalPlan.id);

    // New plan with different rates starting tomorrow.
    await createPlan(prisma, tenant.id, {
      effectiveFrom: tomorrow,
      rates: [600, 200, 100, 50, 50],
    });

    // Old ledger remains unchanged; no recalculation, and idempotency guarantees it.
    const reRun = await engine.applyCommissions(oldSale.id);
    expect(reRun.applied).toBe(false);
    const oldEntries = await prisma.ledgerEntry.findMany({
      where: { saleId: oldSale.id },
      orderBy: { level: 'asc' },
    });
    expect(oldEntries.map((e) => e.rateBpsUsed)).toEqual([500, 200, 150, 100, 50]);

    // New sale uses the new rate.
    const newSale = await createSale(prisma, tenant.id, chain[5].id, 10_000_000n, { saleDate: dayAfter });
    await engine.approveSale(newSale.id);
    const newEntries = await prisma.ledgerEntry.findMany({
      where: { saleId: newSale.id },
      orderBy: { level: 'asc' },
    });
    expect(newEntries.map((e) => e.rateBpsUsed)).toEqual([600, 200, 100, 50, 50]);
    expect(newEntries.map((e) => e.amountCents)).toEqual([600_000n, 200_000n, 100_000n, 50_000n, 50_000n]);
  });

  it('T6 provenance: onceden pinlenmis satis daha yeni plan varken exact snapshot ile hesaplanir', async () => {
    const tenant = await createTenant(prisma);
    const originalPlan = await createPlan(prisma, tenant.id, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      rates: [500, 200],
    });
    const [, seller] = await createChain(prisma, tenant.id, 2);
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n, {
      saleDate: new Date('2026-06-10T12:00:00.000Z'),
    });
    await prisma.sale.update({ where: { id: sale.id }, data: { commissionPlanId: originalPlan.id } });

    await createPlan(prisma, tenant.id, {
      effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
      rates: [900, 100],
    });
    await engine.approveSale(sale.id);

    const entries = await prisma.ledgerEntry.findMany({
      where: { saleId: sale.id, type: LedgerType.commission },
      orderBy: { level: 'asc' },
    });
    expect(entries.map((entry) => entry.rateBpsUsed)).toEqual([500, 200]);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).commissionPlanId).toBe(originalPlan.id);
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

    // Without delivery, the job does not mature anything.
    let matured = await engine.matureCommissions();
    expect(matured.matured).toBe(0);

    let s = await summaryTotals(prisma, seller.id);
    expect(s.pending).toBe(500_000n);
    expect(s.payable).toBe(0n);

    // Setting delivered_at lets the job make entries payable.
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

  it('T8: fairness - L1 and L7 members with identical downlines earn exactly the same', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);

    // Trunk: 7-member chain; A = depth 1, B = depth 6 ("L7").
    const trunk = await createChain(prisma, tenant.id, 7);
    const memberA = trunk[1];
    const memberB = trunk[6];

    // Identical downlines: each has a 4-person chain underneath.
    const downA = await createChain(prisma, tenant.id, 4, memberA);
    const downB = await createChain(prisma, tenant.id, 4, memberB);

    // Identical sales: the member plus 4 downline people, each $10,000.
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
    expect(earningsA).toBe(100_000n); // $10,000 x full 10% pool because the whole window is filled.
  });

  it('T9: $33,333 sale - each level floors, total <= 10%, difference stays with company', async () => {
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
    expect(total <= 333_330n).toBe(true); // 10% pool = 333,330; 1 cent stays with the company.
  });

  it('T10: parallel approve -> one row set (unique constraint + FOR UPDATE)', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);

    const sale = await createSale(prisma, tenant.id, chain[5].id, 10_000_000n);

    const results = await Promise.allSettled([engine.approveSale(sale.id), engine.approveSale(sale.id)]);
    // At least one should succeed; the other is no-op or waits for the lock and becomes no-op.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({ where: { saleId: sale.id } });
    expect(entries).toHaveLength(5);
    expect(new Set(entries.map((e) => e.level)).size).toBe(5);

    // Summary is not counted twice.
    const s = await summaryTotals(prisma, chain[5].id);
    expect(s.payable).toBe(500_000n);
  });

  it('rolls back every sale mutation and financial write when the shared transaction fails', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [seller] = await createChain(prisma, tenant.id, 1);
    const firstSale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const secondSale = await createSale(prisma, tenant.id, seller.id, 20_000_000n);
    const sentinel = new Error('sale mutation rollback sentinel');

    await expect(
      engine.runSaleMutationTransaction(tenant.id, async (transaction) => {
        await transaction.lockSales([firstSale.id, secondSale.id]);
        await transaction.approveSale(firstSale.id);
        await transaction.approveSale(secondSale.id);
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);

    const sales = await prisma.sale.findMany({
      where: { id: { in: [firstSale.id, secondSale.id] } },
      orderBy: { id: 'asc' },
    });
    expect(sales.map((sale) => sale.status)).toEqual([SaleStatus.draft, SaleStatus.draft]);
    expect(await prisma.ledgerEntry.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.monthlySummary.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id } })).toBe(0);
  });

  it('locks duplicate sale ids once in lexical order and commits both approvals in one transaction', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [seller] = await createChain(prisma, tenant.id, 1);
    const firstSale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const secondSale = await createSale(prisma, tenant.id, seller.id, 20_000_000n);
    const sortedIds = [firstSale.id, secondSale.id].sort();

    const results = await engine.runSaleMutationTransaction(tenant.id, async (transaction) => {
      const lockedIds = await transaction.lockSales([secondSale.id, firstSale.id, secondSale.id]);
      expect(lockedIds).toEqual(sortedIds);
      return [
        await transaction.approveSale(secondSale.id),
        await transaction.approveSale(firstSale.id),
      ];
    });

    expect(results).toEqual([
      { applied: true, entryCount: 1 },
      { applied: true, entryCount: 1 },
    ]);
    const sales = await prisma.sale.findMany({
      where: { id: { in: sortedIds } },
      orderBy: { id: 'asc' },
    });
    expect(sales.map((sale) => sale.status)).toEqual([SaleStatus.approved, SaleStatus.approved]);
    const entries = await prisma.ledgerEntry.findMany({
      where: { saleId: { in: sortedIds } },
      orderBy: { saleId: 'asc' },
    });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.status)).toEqual([LedgerStatus.payable, LedgerStatus.payable]);
    expect(entries.map((entry) => entry.amountCents).sort((a, b) => Number(a - b))).toEqual([500_000n, 1_000_000n]);
    expect((await summaryTotals(prisma, seller.id)).payable).toBe(1_500_000n);
  });

  it('runs the shared sale mutation callback at serializable isolation', async () => {
    const tenant = await createTenant(prisma);

    const isolation = await engine.runSaleMutationTransaction(tenant.id, async (transaction) =>
      transaction.db.$queryRaw<Array<{ transaction_isolation: string }>>`SHOW transaction_isolation`,
    );

    expect(isolation).toEqual([{ transaction_isolation: 'serializable' }]);
  });

  it('binds shared sale mutation capabilities to one tenant', async () => {
    const firstTenant = await createTenant(prisma);
    const secondTenant = await createTenant(prisma);
    await createPlan(prisma, firstTenant.id);
    await createPlan(prisma, secondTenant.id);
    const [firstSeller] = await createChain(prisma, firstTenant.id, 1);
    const [secondSeller] = await createChain(prisma, secondTenant.id, 1);
    const firstSale = await createSale(prisma, firstTenant.id, firstSeller.id, 10_000_000n);
    const secondSale = await createSale(prisma, secondTenant.id, secondSeller.id, 10_000_000n);

    await expect(
      engine.runSaleMutationTransaction(firstTenant.id, async (transaction) => {
        expect(await transaction.lockSales([secondSale.id, firstSale.id])).toEqual([firstSale.id]);
        await transaction.approveSale(secondSale.id);
      }),
    ).rejects.toMatchObject({ status: 404 });

    const sales = await prisma.sale.findMany({
      where: { id: { in: [firstSale.id, secondSale.id] } },
      orderBy: { id: 'asc' },
    });
    expect(sales.map((sale) => sale.status)).toEqual([SaleStatus.draft, SaleStatus.draft]);
    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect(await prisma.monthlySummary.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('draft sale does not distribute commissions (no-op)', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [founder] = await createChain(prisma, tenant.id, 1);

    const sale = await createSale(prisma, tenant.id, founder.id, 10_000_000n);
    const result = await engine.applyCommissions(sale.id);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('not_approved');
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id } })).toBe(0);
  });

  it('days_after_approval(N): rows are pending with matures_at = approved_at + N days', async () => {
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

    // Simulate after 14 days by running the job with a future "now".
    const matured = await engine.matureCommissions(new Date(expected + 1000));
    expect(matured.matured).toBe(1);
  });

  it('inactive upline + compression off: level gap is preserved and inactive share stays with company', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { inactiveMembersEarn: false, compressionEnabled: false },
    });
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    await prisma.membership.update({ where: { id: chain[4].id }, data: { status: MembershipStatus.inactive } });

    const sale = await createSale(prisma, tenant.id, chain[5].id, 10_000_000n);
    await engine.approveSale(sale.id);

    const entries = await prisma.ledgerEntry.findMany({
      where: { saleId: sale.id },
      orderBy: { level: 'asc' },
    });
    expect(entries.map((e) => e.level)).toEqual([0, 2, 3, 4]);
    expect(entries.map((e) => e.beneficiaryMembershipId)).toEqual([chain[5].id, chain[3].id, chain[2].id, chain[1].id]);
    expect(entries.map((e) => e.amountCents)).toEqual([500_000n, 150_000n, 100_000n, 50_000n]);
  });

  it('inactive upline + compression on: active sponsors are compressed upward', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { inactiveMembersEarn: false, compressionEnabled: true },
    });
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    await prisma.membership.update({ where: { id: chain[4].id }, data: { status: MembershipStatus.inactive } });

    const sale = await createSale(prisma, tenant.id, chain[5].id, 10_000_000n);
    await engine.approveSale(sale.id);

    const entries = await prisma.ledgerEntry.findMany({
      where: { saleId: sale.id },
      orderBy: { level: 'asc' },
    });
    expect(entries.map((e) => e.level)).toEqual([0, 1, 2, 3]);
    expect(entries.map((e) => e.beneficiaryMembershipId)).toEqual([chain[5].id, chain[3].id, chain[2].id, chain[1].id]);
    expect(entries.map((e) => e.amountCents)).toEqual([500_000n, 200_000n, 150_000n, 100_000n]);
  });
});
