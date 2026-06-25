import { PayoutMethod, PayoutStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { EventsService } from '../src/events/events.service';
import { SanctionsService } from '../src/sanctions/sanctions.service';
import { ActorContext } from '../src/common/actor';
import { createChain, createTenant, truncateAll } from './helpers';

/** Dalga 3 — banka mutabakati: ekstre satirlari odenmis payout'larla tutara gore eslenir, 'cleared' isaretlenir. */
describe('payout reconciliation (entegrasyon)', () => {
  let prisma: PrismaService;
  let payouts: PayoutsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const engine = new EngineService(prisma, new RanksService(prisma));
    payouts = new PayoutsService(prisma, engine, new WebhooksService(prisma), new EventsService(), new SanctionsService(prisma));
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await truncateAll(prisma); });

  async function paidPayout(tenantId: string, membershipId: string, cents: bigint) {
    return prisma.payout.create({ data: { tenantId, membershipId, totalCents: cents, method: PayoutMethod.manual, status: PayoutStatus.paid, period: '2026-06', paidAt: new Date() } });
  }

  it('tutara gore esler, cleared isaretler; eslesmeyeni raporlar', async () => {
    const tenant = await createTenant(prisma);
    const [a, b, cc] = await createChain(prisma, tenant.id, 3);
    const p1 = await paidPayout(tenant.id, a.id, 150_000n);
    const p2 = await paidPayout(tenant.id, b.id, 225_050n);
    await paidPayout(tenant.id, cc.id, 98_000n); // ekstrede yok → uncleared kalir
    const actor: ActorContext = { userId: a.userId, tenantId: tenant.id };

    const res = await payouts.reconcile(actor, [
      { amountCents: 150_000, ref: 'ACH-001' },
      { amountCents: 225_050 },
      { amountCents: 777_777, ref: 'HAYALET' }, // eslesmeyen
    ]);

    expect(res.clearedCount).toBe(2);
    expect(res.unmatched).toHaveLength(1);
    expect(res.unmatched[0].amountCents).toBe(777_777);
    expect(res.remainingUncleared).toBe(1); // cc hala mutabik degil

    const r1 = await prisma.payout.findUniqueOrThrow({ where: { id: p1.id } });
    expect(r1.clearedAt).not.toBeNull();
    expect(r1.bankRef).toBe('ACH-001');
    const r2 = await prisma.payout.findUniqueOrThrow({ where: { id: p2.id } });
    expect(r2.clearedAt).not.toBeNull();
  });

  it('ayni tutarda iki payout: iki ekstre satiri ikisini de esler (FIFO)', async () => {
    const tenant = await createTenant(prisma);
    const [a, b] = await createChain(prisma, tenant.id, 2);
    await paidPayout(tenant.id, a.id, 100_000n);
    await paidPayout(tenant.id, b.id, 100_000n);
    const actor: ActorContext = { userId: a.userId, tenantId: tenant.id };

    const res = await payouts.reconcile(actor, [{ amountCents: 100_000 }, { amountCents: 100_000 }]);
    expect(res.clearedCount).toBe(2);
    expect(res.remainingUncleared).toBe(0);
  });

  it('zaten cleared payout tekrar eslenmeye calisilirsa eslesmez (idempotent koruma)', async () => {
    const tenant = await createTenant(prisma);
    const [a] = await createChain(prisma, tenant.id, 1);
    await paidPayout(tenant.id, a.id, 50_000n);
    const actor: ActorContext = { userId: a.userId, tenantId: tenant.id };

    const first = await payouts.reconcile(actor, [{ amountCents: 50_000 }]);
    expect(first.clearedCount).toBe(1);
    const second = await payouts.reconcile(actor, [{ amountCents: 50_000 }]);
    expect(second.clearedCount).toBe(0); // artik uncleared yok
    expect(second.unmatched).toHaveLength(1);
  });
});
