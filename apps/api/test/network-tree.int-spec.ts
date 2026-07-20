import { INestApplication } from '@nestjs/common';
import { SaleStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { EngineService } from '../src/engine/engine.service';
import { monthKey } from '../src/engine/month';
import { MembersAdminService } from '../src/members/members.admin.service';
import { NetworkHierarchyService } from '../src/members/network-hierarchy.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 3 — ag gorunumu zenginlestirme: tree ucu yasam-boyu kazanc + katilim tarihi tasir (KPI/isi haritasi icin). */
describe('network tree analytics (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: EngineService;
  let members: MembersAdminService;
  let hierarchy: NetworkHierarchyService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    engine = moduleRef.get(EngineService);
    members = moduleRef.get(MembersAdminService);
    hierarchy = moduleRef.get(NetworkHierarchyService);
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

  it('projects a member root through Tier 3 only and keeps descendants anonymous', async () => {
    const tenant = await createTenant(prisma);
    const [root, tier1, tier2, tier3, tier4] = await createChain(
      prisma,
      tenant.id,
      5,
    );
    const actor = { userId: root.userId, tenantId: tenant.id };

    const context = await hierarchy.memberContext(actor, {
      rootMembershipId: root.id,
    });
    const direct = context.initialPage.items.find(
      (item) => item.kind === 'direct',
    );
    const anonymous = context.initialPage.items.filter(
      (item) => item.kind === 'anonymous',
    );
    if (!direct || direct.kind !== 'direct') throw new Error('missing Tier 1');

    expect(context.sponsor).toBeNull();
    expect(context.self.nodeRef).toBe('self');
    expect(anonymous).toHaveLength(2);
    expect(anonymous).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ localTier: 2, label: 'Tier 2 member' }),
        expect.objectContaining({ localTier: 3, label: 'Tier 3 member', canExpand: false }),
      ]),
    );
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain(tier2.id);
    expect(serialized).not.toContain(tier3.id);
    expect(serialized).not.toContain(tier4.id);

    const saleDate = new Date();
    await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: tier4.id,
        amountCents: 99_999_999n,
        saleDate,
        summaryMonth: monthKey(saleDate, tenant.timezone),
        status: SaleStatus.approved,
        approvedAt: saleDate,
      },
    });
    const afterTier4Sale = await hierarchy.memberContext(actor, {
      rootMembershipId: root.id,
    });
    const afterDirect = afterTier4Sale.initialPage.items.find(
      (item) => item.kind === 'direct',
    );
    if (!afterDirect || afterDirect.kind !== 'direct') {
      throw new Error('missing Tier 1 after Tier 4 sale');
    }
    expect(afterTier4Sale.self.performance).toEqual(context.self.performance);
    expect(afterDirect.performance).toEqual(direct.performance);

    const children = await hierarchy.memberChildren(actor, {
      rootMembershipId: root.id,
      parentRef: direct.nodeRef,
      snapshotAt: context.scope.snapshotAt,
    });
    expect(children.items).toEqual([
      expect.objectContaining({ kind: 'anonymous', localTier: 2 }),
    ]);
    expect(JSON.stringify(children)).not.toContain(tier2.id);

    const search = await hierarchy.memberDirectSearch(actor, {
      rootMembershipId: root.id,
      query: 'User',
    });
    expect(search.items).toHaveLength(1);
    expect(search.items[0].referralCode).toBe(tier1.referralCode);
    expect(JSON.stringify(search)).not.toContain(tier2.id);
  });
});
