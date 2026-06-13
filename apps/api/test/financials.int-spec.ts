import { Role } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReportsService } from '../src/reports/reports.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 3 — gunluk finansal invariant: saglikli akista ok; kurcalanmis summary'de sapma. */
describe('financial invariants (entegrasyon)', () => {
  let prisma: PrismaService;
  let engine: EngineService;
  let reports: ReportsService;

  beforeAll(async () => { prisma = new PrismaService(); await prisma.$connect(); engine = new EngineService(prisma); reports = new ReportsService(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await truncateAll(prisma); });

  it('saglikli akis (onay→payout) dengelidir; summary kurcalaninca sapma raporlanir', async () => {
    const tenant = await createTenant(prisma); // on_approval, min 100000
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: chain[0].id }, data: { role: Role.tenant_owner } });
    const seller = chain[1];

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id); // komisyonlar payable
    await engine.payoutMember({ tenantId: tenant.id, membershipId: seller.id, period: '2026-06' });

    const healthy = await reports.verifyFinancials(tenant.id);
    expect(healthy.ok).toBe(true);

    // kurcala: bir summary satirini boz
    const sum = await prisma.monthlySummary.findFirst({ where: { tenantId: tenant.id } });
    if (sum) await prisma.monthlySummary.update({ where: { id: sum.id }, data: { payableCents: sum.payableCents + 999n } });

    const broken = await reports.verifyFinancials(tenant.id);
    expect(broken.ok).toBe(false);
    expect(broken.summaryMismatches.length).toBeGreaterThanOrEqual(1);
  });
});
