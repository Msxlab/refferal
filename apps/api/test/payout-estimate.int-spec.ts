import { LedgerStatus, LedgerType } from '@prisma/client';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { PayoutEstimateService } from '../src/payouts/payout-estimate.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

/** Faz E — tahmini odeme tarihi: compute + refresh + sweep (gercek DB). */
describe('payout estimate (entegrasyon)', () => {
  let prisma: PrismaService;
  let svc: PayoutEstimateService;
  let engine: EngineService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new PayoutEstimateService(prisma);
    engine = new EngineService(prisma, new RanksService(prisma));
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await truncateAll(prisma); });

  /** type estimate hesabini etkilemez (compute status+maturesAt'e bakar); commission gercekci tip. */
  async function addLedger(
    tenantId: string,
    membershipId: string,
    amountCents: bigint,
    status: LedgerStatus,
    maturesAt: Date | null,
  ): Promise<void> {
    await prisma.ledgerEntry.create({
      data: {
        tenantId,
        saleId: null,
        beneficiaryMembershipId: membershipId,
        level: 0,
        rateBpsUsed: 0,
        amountCents,
        type: LedgerType.commission,
        status,
        maturesAt,
        summaryMonth: '2026-06',
      },
    });
  }

  it('payable >= payoutMin -> compute bir sonraki auto-request tarihini doner (null degil)', async () => {
    const tenant = await createTenant(prisma); // payoutMin varsayilan 100000
    const [member] = await createChain(prisma, tenant.id, 1);
    await addLedger(tenant.id, member.id, 100000n, LedgerStatus.payable, null);

    const date = await svc.compute(member.id);
    expect(date).not.toBeNull();
    expect(date!.getTime()).toBeGreaterThan(Date.now()); // gelecekteki 06:00
  });

  it('pending maturesAt yuruyusu esigi gecince o tarihi doner', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    const D1 = new Date('2026-07-01T00:00:00.000Z');
    const D2 = new Date('2026-07-10T00:00:00.000Z');
    await addLedger(tenant.id, member.id, 50000n, LedgerStatus.pending, D1);
    await addLedger(tenant.id, member.id, 60000n, LedgerStatus.pending, D2); // 50k+60k=110k >= 100k @ D2

    const date = await svc.compute(member.id);
    expect(date?.toISOString()).toBe(D2.toISOString());
  });

  it('esige ulasilamiyorsa null', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    await addLedger(tenant.id, member.id, 30000n, LedgerStatus.pending, new Date('2026-07-01T00:00:00.000Z'));

    expect(await svc.compute(member.id)).toBeNull();
  });

  it('maturesAt = null pending yuruyuse girmez (temkinli)', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    await addLedger(tenant.id, member.id, 200000n, LedgerStatus.pending, null); // tarihi yok -> haric

    expect(await svc.compute(member.id)).toBeNull();
  });

  it('refreshForMemberships alanlari Membership uzerine yazar', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    await addLedger(tenant.id, member.id, 100000n, LedgerStatus.payable, null);

    await svc.refreshForMemberships([member.id]);
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: member.id } });
    expect(m.estimatedPayoutDate).not.toBeNull();
    expect(m.estimatedPayoutAt).not.toBeNull();
  });

  it('sweepEstimates pending/payable bakiyeli uyeyi gunceller, bakiyesizi atlar', async () => {
    const tenant = await createTenant(prisma);
    const [withBal, without] = await createChain(prisma, tenant.id, 2);
    await addLedger(tenant.id, withBal.id, 100000n, LedgerStatus.payable, null);

    const res = await svc.sweepEstimates();
    expect(res.skipped).toBe(false);
    expect(res.swept).toBeGreaterThanOrEqual(1);

    const a = await prisma.membership.findUniqueOrThrow({ where: { id: withBal.id } });
    const b = await prisma.membership.findUniqueOrThrow({ where: { id: without.id } });
    expect(a.estimatedPayoutDate).not.toBeNull();
    expect(b.estimatedPayoutAt).toBeNull(); // hic ledger'i yok -> taramaya girmez
  });

  it('matureCommissions affectedMembershipIds doner (Yaklasim A kaynagi)', async () => {
    const tenant = await createTenant(prisma);
    await createChain(prisma, tenant.id, 1);
    const past = new Date(Date.now() - 60_000);
    // Bos kosumda da yeni alan mevcut olmali (sozlesme); tam olgunlasma->refresh zinciri
    // scheduler.int-spec'te kapsanir (job artik refreshForMemberships cagiriyor).
    const out = await engine.matureCommissions(past);
    expect(Array.isArray(out.affectedMembershipIds)).toBe(true);
    expect(typeof out.matured).toBe('number');
  });
});
