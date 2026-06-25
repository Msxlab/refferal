import { PrismaService } from '../src/prisma/prisma.service';
import { ChecksService } from '../src/checks/checks.service';
import { ActorContext } from '../src/common/actor';
import { createChain, createTenant, truncateAll } from './helpers';

/**
 * Faz A2.2 cek-run + guvenlik denetimi fix'leri (regresyon):
 * - postalanmis cek YENIDEN bastirilamaz (payoutIds verilse bile) → cift odeme korumasi
 * - 0/negatif tutarli payout cek-run'da atlanir
 * - payeeSnapshot/tutar butunluk kontrolu
 */
describe('checks — cek-run + denetim fix\'leri (entegrasyon)', () => {
  let prisma: PrismaService;
  let checks: ChecksService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    checks = new ChecksService(prisma);
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await truncateAll(prisma); });

  async function paidCheck(tenantId: string, membershipId: string, cents: bigint) {
    return prisma.payout.create({
      data: { tenantId, membershipId, totalCents: cents, method: 'check', status: 'paid', period: '2026-06', paidAt: new Date() },
    });
  }

  it('cek-run: sirali no + adres snapshot; postalanmis cek yeniden bastirilamaz (cift odeme korumasi)', async () => {
    const tenant = await createTenant(prisma);
    const [m] = await createChain(prisma, tenant.id, 1); // createChain adres dolu verir
    const actor: ActorContext = { userId: m.userId, tenantId: tenant.id };
    const p = await paidCheck(tenant.id, m.id, 123456n);

    // run → no atanir + snapshot
    const run = await checks.generateRun(actor, { payoutIds: [p.id] });
    expect(run.assignedCount).toBe(1);
    const after = await prisma.payout.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.checkNumber).toBe(1001); // default lastCheckNumber 1000 + 1
    expect(after.payeeSnapshot).toBeTruthy();

    // PDF basilabilir
    const pdf = await checks.buildPdf(tenant.id, [p.id]);
    expect(pdf.buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');

    // postalandi isaretle
    const mm = await checks.markMailed(actor, { payoutIds: [p.id] });
    expect(mm.mailed).toBe(1);

    // #3 FIX: postalanmis ceki payoutIds ile bile YENIDEN bastiramazsin
    await expect(checks.buildPdf(tenant.id, [p.id])).rejects.toThrow();
  });

  it('cek-run: 0 tutarli payout atlanir (cek kesilmez). negatif zaten DB chk_payout_total ile yasak.', async () => {
    const tenant = await createTenant(prisma);
    const [m] = await createChain(prisma, tenant.id, 1);
    const actor: ActorContext = { userId: m.userId, tenantId: tenant.id };
    const zero = await paidCheck(tenant.id, m.id, 0n);

    const run = await checks.generateRun(actor, { payoutIds: [zero.id] });
    expect(run.assignedCount).toBe(0);
    expect(run.skipped[0].reason).toBe('invalid_amount');

    const z = await prisma.payout.findUniqueOrThrow({ where: { id: zero.id } });
    expect(z.checkNumber).toBeNull(); // no atanmadi

    // negatif tutar DB seviyesinde reddedilir (chk_payout_total) — savunma katmani
    await expect(paidCheck(tenant.id, m.id, -500n)).rejects.toThrow();
  });

  it('cek-run: adres eksik uye atlanir', async () => {
    const tenant = await createTenant(prisma);
    const [m] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: m.id }, data: { mailingLine1: null } }); // adresi boz
    const actor: ActorContext = { userId: m.userId, tenantId: tenant.id };
    const p = await paidCheck(tenant.id, m.id, 100000n);

    const run = await checks.generateRun(actor, { payoutIds: [p.id] });
    expect(run.assignedCount).toBe(0);
    expect(run.skipped[0].reason).toBe('incomplete_address');
  });
});
