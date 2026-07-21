import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, SaleStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
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
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    engine = moduleRef.get(EngineService);
    members = moduleRef.get(MembersAdminService);
    hierarchy = moduleRef.get(NetworkHierarchyService);
    jwt = moduleRef.get(JwtService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  function memberToken(membershipId: string, userId: string, tenantId: string): string {
    const payload: AccessTokenPayload = {
      sub: userId,
      mid: membershipId,
      tid: tenantId,
      role: Role.member,
      authGeneration: 1,
    };
    return jwt.sign(payload, {
      secret: authConfig.accessSecret(),
      expiresIn: authConfig.accessTtlSeconds,
    });
  }

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
    const [root, tier1, tier2, tier3] = await createChain(
      prisma,
      tenant.id,
      4,
    );
    const actor = { userId: root.userId, tenantId: tenant.id };

    const contextBeforeTier4 = await hierarchy.memberContext(actor, {
      rootMembershipId: root.id,
    });
    const directBeforeTier4 = contextBeforeTier4.initialPage.items.find(
      (item) => item.kind === 'direct',
    );
    const anonymous = contextBeforeTier4.initialPage.items.filter(
      (item) => item.kind === 'anonymous',
    );
    if (!directBeforeTier4 || directBeforeTier4.kind !== 'direct') {
      throw new Error('missing Tier 1');
    }

    expect(contextBeforeTier4.sponsor).toBeNull();
    expect(contextBeforeTier4.self.nodeRef).toBe('self');
    expect(anonymous).toHaveLength(2);
    expect(anonymous).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ localTier: 2, label: 'Tier 2 member' }),
        expect.objectContaining({ localTier: 3, label: 'Tier 3 member', canExpand: false }),
      ]),
    );

    const childrenBeforeTier4 = await hierarchy.memberChildren(actor, {
      rootMembershipId: root.id,
      parentRef: directBeforeTier4.nodeRef,
      snapshotAt: contextBeforeTier4.scope.snapshotAt,
    });
    const searchBeforeTier4 = await hierarchy.memberDirectSearch(actor, {
      rootMembershipId: root.id,
      query: 'User',
    });
    const comparable = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, nestedValue) =>
          ['nodeRef', 'parentRef', 'clusterRef', 'snapshotAt'].includes(key)
            ? undefined
            : nestedValue,
        ),
      );

    // Create and mutate the Tier 4 membership after taking the visible baseline.
    // It even matches the direct-search text, so an unbounded search would surface it.
    const [tier4] = await createChain(prisma, tenant.id, 1, tier3);
    await Promise.all([
      prisma.user.update({
        where: { id: tier4.userId },
        data: { fullName: 'User Tier Four Mutation' },
      }),
      prisma.membership.update({
        where: { id: tier4.id },
        data: { referralCode: 'TIER4-PRIVATE' },
      }),
    ]);
    const contextAfterTier4Membership = await hierarchy.memberContext(actor, {
      rootMembershipId: root.id,
    });
    const directAfterTier4Membership =
      contextAfterTier4Membership.initialPage.items.find(
        (item) => item.kind === 'direct',
      );
    if (
      !directAfterTier4Membership ||
      directAfterTier4Membership.kind !== 'direct'
    ) {
      throw new Error('missing Tier 1 after Tier 4 membership mutation');
    }
    const childrenAfterTier4Membership = await hierarchy.memberChildren(actor, {
      rootMembershipId: root.id,
      parentRef: directAfterTier4Membership.nodeRef,
      snapshotAt: contextAfterTier4Membership.scope.snapshotAt,
    });
    const searchAfterTier4Membership = await hierarchy.memberDirectSearch(actor, {
      rootMembershipId: root.id,
      query: 'User',
    });

    expect(comparable(contextAfterTier4Membership)).toEqual(
      comparable(contextBeforeTier4),
    );
    expect(comparable(childrenAfterTier4Membership)).toEqual(
      comparable(childrenBeforeTier4),
    );
    expect(comparable(searchAfterTier4Membership)).toEqual(
      comparable(searchBeforeTier4),
    );
    const serializedAfterMembership = JSON.stringify({
      contextAfterTier4Membership,
      childrenAfterTier4Membership,
      searchAfterTier4Membership,
    });
    expect(serializedAfterMembership).not.toContain(tier2.id);
    expect(serializedAfterMembership).not.toContain(tier3.id);
    expect(serializedAfterMembership).not.toContain(tier4.id);
    expect(serializedAfterMembership).not.toContain('User Tier Four Mutation');
    expect(serializedAfterMembership).not.toContain('TIER4-PRIVATE');

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
    const directAfterTier4Sale = afterTier4Sale.initialPage.items.find(
      (item) => item.kind === 'direct',
    );
    if (!directAfterTier4Sale || directAfterTier4Sale.kind !== 'direct') {
      throw new Error('missing Tier 1 after Tier 4 sale');
    }
    const childrenAfterTier4Sale = await hierarchy.memberChildren(actor, {
      rootMembershipId: root.id,
      parentRef: directAfterTier4Sale.nodeRef,
      snapshotAt: afterTier4Sale.scope.snapshotAt,
    });
    const searchAfterTier4Sale = await hierarchy.memberDirectSearch(actor, {
      rootMembershipId: root.id,
      query: 'User',
    });
    expect(comparable(afterTier4Sale)).toEqual(comparable(contextBeforeTier4));
    expect(comparable(childrenAfterTier4Sale)).toEqual(
      comparable(childrenBeforeTier4),
    );
    expect(comparable(searchAfterTier4Sale)).toEqual(
      comparable(searchBeforeTier4),
    );
    expect(searchAfterTier4Membership.items).toHaveLength(1);
    expect(searchAfterTier4Membership.items[0].referralCode).toBe(
      tier1.referralCode,
    );
  });

  it('serves the authenticated member tree routes without disclosing deeper identities', async () => {
    const tenant = await createTenant(prisma);
    const [root, tier1, tier2, tier3, tier4] = await createChain(prisma, tenant.id, 5);
    const token = memberToken(root.id, root.userId, tenant.id);
    const auth = (requestBuilder: request.Test) => requestBuilder.set('Authorization', `Bearer ${token}`);

    const tree = await auth(request(app.getHttpServer()).get('/v1/app/team/tree')).expect(200);
    const direct = tree.body.initialPage.items.find((item: { kind: string }) => item.kind === 'direct');
    expect(direct).toMatchObject({ localTier: 1, referralCode: tier1.referralCode });
    expect(tree.body.scope.maxVisibleTier).toBe(3);

    const children = await auth(
      request(app.getHttpServer())
        .get('/v1/app/team/tree/children')
        .query({ parentRef: direct.nodeRef, snapshotAt: tree.body.scope.snapshotAt }),
    ).expect(200);
    expect(children.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'anonymous', localTier: 2 })]),
    );

    const search = await auth(
      request(app.getHttpServer()).post('/v1/app/team/tree/direct-search'),
    ).send({ query: 'User' }).expect(200);
    expect(search.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'direct', referralCode: tier1.referralCode })]),
    );

    const serialized = JSON.stringify({ tree: tree.body, children: children.body, search: search.body });
    for (const privateMember of [tier2, tier3, tier4]) {
      expect(serialized).not.toContain(privateMember.referralCode);
      expect(serialized).not.toContain(privateMember.userId);
    }
    await auth(
      request(app.getHttpServer())
        .get('/v1/app/team/tree/children')
        .query({ parentRef: 'invalid', snapshotAt: tree.body.scope.snapshotAt }),
    ).expect(400);
  });
});
