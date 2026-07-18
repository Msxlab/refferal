import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, Role, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, summaryTotals, truncateAll } from './helpers';

/**
 * Kampanya motoru (Dalga 2): canli siralama → finalize → bonus 'adjustment' (payable)
 * ledger satiri (saleId NULL) → mevcut payout akisindan odenir. Uye kendi sirasini gorur.
 */
describe('campaigns (entegrasyon)', () => {
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

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  function token(opts: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const payload: AccessTokenPayload = { sub: opts.userId, mid: opts.membershipId, tid: opts.tenantId, role: opts.role };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  async function setup() {
    const tenant = await createTenant(prisma); // on_approval, payout min 100000 ($1000)
    await createPlan(prisma, tenant.id);
    const [owner] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const [a] = await createChain(prisma, tenant.id, 1, owner);
    const [b] = await createChain(prisma, tenant.id, 1, owner);
    return { tenant, owner, a, b };
  }

  const win = () => {
    const now = new Date();
    return { now, start: new Date(now.getTime() - 86_400_000), end: new Date(now.getTime() + 86_400_000) };
  };

  it('finalize: en cok ciro yapan rank #1 bonus alir → payable → payout oder', async () => {
    const { tenant, owner, a, b } = await setup();
    const adminTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const { now, start, end } = win();

    // pencere icinde onayli satis: A=$2000 > B=$1000 → A rank #1
    await createSale(prisma, tenant.id, a.id, 200_000n, { status: SaleStatus.approved, saleDate: now });
    await createSale(prisma, tenant.id, b.id, 100_000n, { status: SaleStatus.approved, saleDate: now });

    const created = await request(app.getHttpServer())
      .post('/v1/admin/campaigns')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Q3 Sprint', metric: 'revenue', startsAt: start, endsAt: end, prizes: [{ rank: 1, bonusCents: 500_000 }] })
      .expect(201);
    const id = created.body.id;

    // canli siralama: A tepede
    const detail = await request(app.getHttpServer())
      .get(`/v1/admin/campaigns/${id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    expect(detail.body.standings[0].membershipId).toBe(a.id);
    expect(detail.body.standings[0].bonusCents).toBe(500_000);

    // finalize → bonus dagit
    const fin = await request(app.getHttpServer())
      .post(`/v1/admin/campaigns/${id}/finalize`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    expect(fin.body.awardedCount).toBe(1);
    expect(fin.body.status).toBe('ended');

    // A'da satisa bagli OLMAYAN adjustment payable bonus satiri
    const bonus = await prisma.ledgerEntry.findFirst({
      where: { beneficiaryMembershipId: a.id, type: LedgerType.adjustment },
    });
    expect(bonus).toBeTruthy();
    expect(bonus!.saleId).toBeNull();
    expect(bonus!.status).toBe(LedgerStatus.payable);
    expect(bonus!.amountCents).toBe(500_000n);
    expect(bonus!.summaryMonth).toBeTruthy();

    // summary payable bonus'u icerir
    const sums = await summaryTotals(prisma, a.id);
    expect(sums.payable).toBe(500_000n);

    // payout run bonus'u oder (LEFT JOIN ile satisa bagli olmayan satir da alinir)
    const run = await request(app.getHttpServer())
      .post('/v1/admin/payouts/run')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ method: 'csv' })
      .expect(200);
    expect(run.body.paidCount).toBe(1);

    const paid = await prisma.ledgerEntry.findUnique({ where: { id: bonus!.id } });
    expect(paid!.status).toBe(LedgerStatus.paid);
    expect(paid!.payoutId).toBeTruthy();
  });

  it('bitmis kampanya tekrar finalize edilemez (cift odul yok)', async () => {
    const { tenant, owner, a } = await setup();
    const adminTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const { now, start, end } = win();
    await createSale(prisma, tenant.id, a.id, 100_000n, { status: SaleStatus.approved, saleDate: now });

    const created = await request(app.getHttpServer())
      .post('/v1/admin/campaigns')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Once', metric: 'sales_count', startsAt: start, endsAt: end, prizes: [{ rank: 1, bonusCents: 200_000 }] })
      .expect(201);

    await request(app.getHttpServer()).post(`/v1/admin/campaigns/${created.body.id}/finalize`).set('Authorization', `Bearer ${adminTok}`).expect(200);
    await request(app.getHttpServer()).post(`/v1/admin/campaigns/${created.body.id}/finalize`).set('Authorization', `Bearer ${adminTok}`).expect(409);

    // yalniz tek bonus satiri
    const bonuses = await prisma.ledgerEntry.count({ where: { beneficiaryMembershipId: a.id, type: LedgerType.adjustment } });
    expect(bonuses).toBe(1);
  });

  it('uye /app/campaigns ile aktif kampanyada kendi sirasini gorur', async () => {
    const { tenant, owner, a, b } = await setup();
    const adminTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const aTok = token({ userId: a.userId, membershipId: a.id, tenantId: tenant.id, role: Role.member });
    const { now, start, end } = win();
    await createSale(prisma, tenant.id, a.id, 300_000n, { status: SaleStatus.approved, saleDate: now });
    await createSale(prisma, tenant.id, b.id, 100_000n, { status: SaleStatus.approved, saleDate: now });

    const created = await request(app.getHttpServer())
      .post('/v1/admin/campaigns')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Live', metric: 'revenue', startsAt: start, endsAt: end, prizes: [{ rank: 1, bonusCents: 100_000 }] })
      .expect(201);
    // aktif yap (uye yalniz aktif kampanyalari gorur)
    await request(app.getHttpServer()).patch(`/v1/admin/campaigns/${created.body.id}`).set('Authorization', `Bearer ${adminTok}`).send({ status: 'active' }).expect(200);

    const mine = await request(app.getHttpServer()).get('/v1/app/campaigns').set('Authorization', `Bearer ${aTok}`).expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].myRank).toBe(1);
    expect(mine.body[0].leaderboard[0].membershipId).toBe(a.id);
  });
});
