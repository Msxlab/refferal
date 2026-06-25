import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { EngineService } from '../src/engine/engine.service';
import { MembersAdminService } from '../src/members/members.admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 3 — ag gorunumu zenginlestirme: tree ucu yasam-boyu kazanc + katilim tarihi tasir (KPI/isi haritasi icin). */
describe('network tree analytics (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: EngineService;
  let members: MembersAdminService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    engine = moduleRef.get(EngineService);
    members = moduleRef.get(MembersAdminService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  it('tree dugumleri joinedAt + earningsCents (payable+paid) tasir', async () => {
    const tenant = await createTenant(prisma); // on_approval → approve sonrasi payable
    await createPlan(prisma, tenant.id);
    const [sponsor, seller] = await createChain(prisma, tenant.id, 2);
    const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n);
    await engine.approveSale(sale.id);

    const tree = await members.tree(tenant.id);
    expect(tree.length).toBe(2);
    for (const node of tree) {
      expect(typeof node.joinedAt).toBe('string');
      expect(node.joinedAt.length).toBeGreaterThan(0);
      expect(typeof node.earningsCents).toBe('string');
    }
    // sponsor level-1 komisyon kazandi → earnings > 0
    const sp = tree.find((n) => n.id === sponsor.id)!;
    expect(BigInt(sp.earningsCents)).toBeGreaterThan(0n);
    // satici level-0 komisyon kazandi → earnings > 0; bu ay cirosu = satis tutari
    const sl = tree.find((n) => n.id === seller.id)!;
    expect(BigInt(sl.earningsCents)).toBeGreaterThan(0n);
    expect(BigInt(sl.revenueCents)).toBe(1_000_000n);
    expect(sl.salesCount).toBe(1);
  });
});
