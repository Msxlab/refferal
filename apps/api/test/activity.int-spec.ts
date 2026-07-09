import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, PayoutMethod, PayoutStatus, Role, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

/** Feature-gap #7 — activity feed: source coverage, time order, privacy scoping, cursor. */
describe('activity feed (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  function tokenFor(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const p: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }
  const srv = () => app.getHttpServer();

  it('returns items from each source in correct (desc) time order; direct join shows a name', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [me, recruit] = await createChain(prisma, tenant.id, 2);

    const t = (iso: string) => new Date(iso);
    await prisma.membership.update({ where: { id: recruit.id }, data: { joinedAt: t('2026-06-01T10:00:00Z') } });
    await prisma.sale.create({ data: { tenantId: tenant.id, sellerMembershipId: me.id, amountCents: 100_000n, saleDate: t('2026-06-02T00:00:00Z'), status: SaleStatus.approved, approvedAt: t('2026-06-02T12:00:00Z') } });
    await prisma.ledgerEntry.create({ data: { tenantId: tenant.id, saleId: null, beneficiaryMembershipId: me.id, level: 0, rateBpsUsed: 500, amountCents: 5_000n, type: LedgerType.commission, status: LedgerStatus.payable, summaryMonth: '2026-06', createdAt: t('2026-06-03T09:00:00Z') } });
    await prisma.payout.create({ data: { tenantId: tenant.id, membershipId: me.id, totalCents: 5_000n, method: PayoutMethod.check, status: PayoutStatus.paid, period: '2026-06', mailedAt: t('2026-06-04T08:00:00Z'), paidAt: t('2026-06-05T08:00:00Z') } });

    const tok = tokenFor({ userId: me.userId, membershipId: me.id, tenantId: tenant.id, role: Role.member });
    const res = await request(srv()).get('/v1/app/activity').set('Authorization', `Bearer ${tok}`).expect(200);

    const types = res.body.items.map((i: { type: string }) => i.type);
    // desc by ts: check_paid(6-5) > check_mailed(6-4) > commission(6-3) > sale(6-2) > join(6-1)
    expect(types).toEqual(['check_paid', 'check_mailed', 'commission_credited', 'sale_approved', 'team_join']);
    const join = res.body.items.find((i: { type: string }) => i.type === 'team_join');
    expect(join.subject).toBe((await prisma.user.findUniqueOrThrow({ where: { id: recruit.userId } })).fullName);
    expect(join.title).toMatch(/joined your team/);
  });

  it('privacy: a DEEP downline join (2 levels) does NOT appear in my feed', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [me, direct, grandchild] = await createChain(prisma, tenant.id, 3);

    const tok = tokenFor({ userId: me.userId, membershipId: me.id, tenantId: tenant.id, role: Role.member });
    const res = await request(srv()).get('/v1/app/activity').set('Authorization', `Bearer ${tok}`).expect(200);
    const joinIds = res.body.items.filter((i: { type: string }) => i.type === 'team_join').map((i: { id: string }) => i.id);
    expect(joinIds).toContain(`join:${direct.id}`);
    expect(joinIds).not.toContain(`join:${grandchild.id}`);
  });

  it('cursor pagination is stable: page1 + page2 = all items, no overlap', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [me] = await createChain(prisma, tenant.id, 1);
    for (let i = 0; i < 25; i++) {
      await prisma.ledgerEntry.create({ data: { tenantId: tenant.id, saleId: null, beneficiaryMembershipId: me.id, level: 0, rateBpsUsed: 0, amountCents: 100n, type: LedgerType.commission, status: LedgerStatus.payable, summaryMonth: '2026-06', createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, i)) } });
    }
    const tok = tokenFor({ userId: me.userId, membershipId: me.id, tenantId: tenant.id, role: Role.member });
    const p1 = (await request(srv()).get('/v1/app/activity').set('Authorization', `Bearer ${tok}`).expect(200)).body;
    expect(p1.items).toHaveLength(20);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await request(srv()).get(`/v1/app/activity?cursor=${encodeURIComponent(p1.nextCursor)}`).set('Authorization', `Bearer ${tok}`).expect(200)).body;
    expect(p2.items).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();
    const ids = new Set([...p1.items, ...p2.items].map((i: { id: string }) => i.id));
    expect(ids.size).toBe(25);
  });

  it('tenant isolation: another tenant\'s activity never leaks', async () => {
    const t1 = await createTenant(prisma);
    await createPlan(prisma, t1.id);
    const [me] = await createChain(prisma, t1.id, 1);
    const t2 = await createTenant(prisma);
    await createPlan(prisma, t2.id);
    const [other] = await createChain(prisma, t2.id, 1);
    await prisma.ledgerEntry.create({ data: { tenantId: t2.id, saleId: null, beneficiaryMembershipId: other.id, level: 0, rateBpsUsed: 0, amountCents: 999n, type: LedgerType.commission, status: LedgerStatus.payable, summaryMonth: '2026-06' } });

    const tok = tokenFor({ userId: me.userId, membershipId: me.id, tenantId: t1.id, role: Role.member });
    const res = await request(srv()).get('/v1/app/activity').set('Authorization', `Bearer ${tok}`).expect(200);
    expect(res.body.items).toHaveLength(0);
  });
});
