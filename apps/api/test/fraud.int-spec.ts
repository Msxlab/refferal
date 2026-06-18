import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { FraudStatus, LedgerStatus, LedgerType, Role, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

/** Dalga 2 #11 — fraud sinyal motoru: tarama + risk skoru + payout hold. */
describe('fraud engine (entegrasyon)', () => {
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

  function token(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const p: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }
  const srv = () => app.getHttpServer();

  async function setup() {
    const tenant = await createTenant(prisma);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    return {
      tenant, owner, seller,
      ownerTok: token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner }),
      sellerTok: token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member }),
    };
  }

  it('tarama self-referral + yuksek void oranini yakalar; skor >= esik bloklar', async () => {
    const { tenant, seller, ownerTok } = await setup();
    const code = (await prisma.membership.findUniqueOrThrow({ where: { id: seller.id } })).referralCode;
    // 4 satis, hepsi self-referral (customerRef = kendi kodu), 2'si void → high_void_rate + self_referral
    for (let i = 0; i < 4; i++) {
      await prisma.sale.create({ data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100000n, saleDate: new Date(), customerRef: code, status: i < 2 ? SaleStatus.void : SaleStatus.approved } });
    }

    await request(srv()).post('/v1/admin/fraud/scan').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    const list = await request(srv()).get('/v1/admin/fraud').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    const flag = list.body.find((f: { membershipId: string }) => f.membershipId === seller.id);
    expect(flag).toBeTruthy();
    expect(flag.score).toBeGreaterThanOrEqual(50);
    expect(flag.blocked).toBe(true);
    expect(flag.reasons.join(',')).toMatch(/self_referral/);
    expect(flag.reasons.join(',')).toMatch(/high_void_rate/);
  });

  it('B3 hizli-odeme: YENI hesap (< 14 gun) buyuk payable biriktirince tarama dondurup bloklar', async () => {
    const { tenant, seller, ownerTok } = await setup();
    // seller createChain ile joinedAt=now (yeni). buyuk payable: $15k >= 10x payout esigi ($1000)
    await prisma.ledgerEntry.create({ data: { tenantId: tenant.id, saleId: null, beneficiaryMembershipId: seller.id, level: 0, rateBpsUsed: 0, amountCents: 1_500_000n, type: LedgerType.adjustment, status: LedgerStatus.payable, summaryMonth: '2026-06' } });

    await request(srv()).post('/v1/admin/fraud/scan').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    const list = await request(srv()).get('/v1/admin/fraud').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    const flag = list.body.find((f: { membershipId: string }) => f.membershipId === seller.id);
    expect(flag).toBeTruthy();
    expect(flag.blocked).toBe(true);
    expect(flag.reasons.join(',')).toMatch(/rapid_payout_new_account/);

    // ESKI hesap ayni bakiyeyle bu sinyali TETIKLEMEZ — joinedAt'i geriye al, yeni uye yok say
    await prisma.membership.update({ where: { id: seller.id }, data: { joinedAt: new Date(Date.now() - 60 * 86_400_000) } });
    await prisma.fraudFlag.delete({ where: { membershipId: seller.id } });
    await request(srv()).post('/v1/admin/fraud/scan').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    const list2 = await request(srv()).get('/v1/admin/fraud').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    expect(list2.body.find((f: { membershipId: string }) => f.membershipId === seller.id)).toBeFalsy();
  });

  it('bloklu uye payout alamaz; clear sonrasi serbest', async () => {
    const { tenant, seller, owner, ownerTok, sellerTok } = await setup();
    // odenebilir bakiye
    await prisma.ledgerEntry.create({ data: { tenantId: tenant.id, saleId: null, beneficiaryMembershipId: seller.id, level: 0, rateBpsUsed: 0, amountCents: 2_000_000n, type: LedgerType.adjustment, status: LedgerStatus.payable, summaryMonth: '2026-06' } });
    // manuel bloklu bayrak
    await prisma.fraudFlag.create({ data: { tenantId: tenant.id, membershipId: seller.id, score: 60, reasons: ['manual'], status: FraudStatus.open } });

    // uye talebi 400
    await request(srv()).post('/v1/app/payout-requests').set('Authorization', `Bearer ${sellerTok}`).expect(400);
    // admin run → bloklu uye atlanir (odenmez)
    const run = await request(srv()).post('/v1/admin/payouts/run').set('Authorization', `Bearer ${ownerTok}`).send({ method: 'csv' }).expect(200);
    expect(run.body.paidCount).toBe(0);
    expect(run.body.skipped.some((s: { membershipId: string; reason: string }) => s.membershipId === seller.id && /fraud/.test(s.reason))).toBe(true);

    // clear → talep acilir
    await request(srv()).post(`/v1/admin/fraud/${seller.id}/decide`).set('Authorization', `Bearer ${ownerTok}`).send({ action: 'clear' }).expect(200);
    const ok = await request(srv()).post('/v1/app/payout-requests').set('Authorization', `Bearer ${sellerTok}`).expect(200);
    expect(ok.body.status).toBe('requested');
    void owner;
  });
});
