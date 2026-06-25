import { PrismaService } from '../src/prisma/prisma.service';
import { ReportsService } from '../src/reports/reports.service';
import { createTenant, truncateAll } from './helpers';

/** Dalga 2 #12 — hash-zincirli audit log: seal + verify + kurcalanma tespiti. */
describe('audit hash chain (entegrasyon)', () => {
  let prisma: PrismaService;
  let reports: ReportsService;

  beforeAll(async () => { prisma = new PrismaService(); await prisma.$connect(); reports = new ReportsService(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await truncateAll(prisma); });

  async function seedLogs(tenantId: string, n: number) {
    for (let i = 0; i < n; i++) {
      await prisma.auditLog.create({ data: { tenantId, action: `act.${i}`, entity: 'sale', after: { i } } });
    }
  }

  it('seal sonrasi zincir butundur; bir satir oynanirsa kirilir', async () => {
    const tenant = await createTenant(prisma);
    await seedLogs(tenant.id, 4);

    const sealed = await reports.sealAuditChain(tenant.id);
    expect(sealed.sealed).toBe(4);

    let v = await reports.verifyAuditChain(tenant.id);
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(4);

    // ilk satirin hash'i null degil; prevHash null (genesis)
    const rows = await prisma.auditLog.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } });
    expect(rows[0].prevHash).toBeNull();
    expect(rows[0].hash).toBeTruthy();

    // kurcala: ortadaki bir kaydin icerigini degistir (hash'i guncellemeden)
    await prisma.auditLog.update({ where: { id: rows[1].id }, data: { action: 'TAMPERED' } });
    v = await reports.verifyAuditChain(tenant.id);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(rows[1].id);
  });

  it('seal idempotent + artımlı (yeni kayitlar zincire eklenir)', async () => {
    const tenant = await createTenant(prisma);
    await seedLogs(tenant.id, 2);
    await reports.sealAuditChain(tenant.id);
    await seedLogs(tenant.id, 3); // 3 yeni
    const second = await reports.sealAuditChain(tenant.id);
    expect(second.sealed).toBe(3); // yalniz yeniler
    const v = await reports.verifyAuditChain(tenant.id);
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(5);
  });
});
