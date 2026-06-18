import { INestApplication } from '@nestjs/common';
import { RanksService } from '../src/ranks/ranks.service';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { LedgerStatus, PayoutStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, summaryTotals, truncateAll } from './helpers';

/**
 * Payout akisi (SPEC 8/9) + MVP "bitti sayilir" para dongusu:
 * satis → onay → bakiye → CSV ile odeme → void → mahsup.
 */
describe('payouts (entegrasyon)', () => {
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
    const payload: AccessTokenPayload = {
      sub: opts.userId,
      mid: opts.membershipId,
      tid: opts.tenantId,
      role: opts.role,
    };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  /** tenant (on_approval, min $1000) + plan + owner(rol) + 5 ust zincir; satici en altta. */
  async function scenario() {
    const tenant = await createTenant(prisma); // on_approval → payable, payoutMin 100000
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    await prisma.membership.update({ where: { id: chain[0].id }, data: { role: Role.tenant_owner } });
    return { tenant, chain, seller: chain[5], owner: chain[0] };
  }

  it('MVP dongusu: onay → payable → run → paid → CSV; void → mahsup', async () => {
    const { tenant, chain, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    // iki satis: biri odenecek, biri void edilecek
    const s1 = await createSale(prisma, tenant.id, seller.id, 10_000_000n); // L0 = 500.000
    const s2 = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    const engine = new EngineService(prisma, new RanksService(prisma));
    await engine.approveSale(s1.id);
    await engine.approveSale(s2.id);

    // seller payable = 1.000.000 (iki satistan L0)
    let s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(1_000_000n);

    // payable liste: seller esigi gecmis gorunur
    const payable = await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    const sellerRow = payable.body.members.find((m: { membershipId: string }) => m.membershipId === seller.id);
    expect(sellerRow.netCents).toBe('1000000');

    // run: tum esik ustu uyeler odenir
    const run = await request(app.getHttpServer())
      .post('/v1/admin/payouts/run')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ method: 'csv' })
      .expect(200);
    expect(run.body.paidCount).toBeGreaterThanOrEqual(1);
    const sellerPaid = run.body.paid.find((p: { membershipId: string }) => p.membershipId === seller.id);
    expect(sellerPaid.totalCents).toBe('1000000');

    // seller summary: payable→paid
    s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(0n);
    expect(s.paid).toBe(1_000_000n);

    // ledger: L0 satirlari paid + payout_id
    const paidEntries = await prisma.ledgerEntry.findMany({
      where: { beneficiaryMembershipId: seller.id, status: LedgerStatus.paid },
    });
    expect(paidEntries).toHaveLength(2);
    expect(paidEntries.every((e) => e.payoutId === sellerPaid.payoutId)).toBe(true);

    // CSV export: payout satiri var
    const csv = await request(app.getHttpServer())
      .get('/v1/admin/payouts/export.csv')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(seller.referralCode);
    expect(csv.text).toContain('1000000');

    // VOID: odenmis satis s2 void edilir → reversal payable NEGATIF (mahsup)
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${s2.id}/void`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);

    s = await summaryTotals(prisma, seller.id);
    expect(s.payable).toBe(-500_000n); // sonraki kazanclardan mahsup edilecek
    expect(s.paid).toBe(1_000_000n); // gercekte odenen degismez

    // seller cuzdaninda payable negatif gorunur
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(wallet.body.balance.payableCents).toBe('-500000');
    expect(wallet.body.balance.paidCents).toBe('1000000');

    // odenmis ledger satirina bagli payout silinemez (B3) — yan dogrulama
    const someEntry = paidEntries[0];
    await expect(
      prisma.payout.delete({ where: { id: someEntry.payoutId as string } }),
    ).rejects.toThrow();

    void chain;
  });

  it('esik alti odenmez (skipped: below_min)', async () => {
    const { tenant, seller, owner } = await scenario();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    // kucuk satis: L0 = $5 (< $1000 esik)
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma, new RanksService(prisma)).approveSale(sale.id);

    // payable liste bos (esik altinda)
    const payable = await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(payable.body.members).toHaveLength(0);

    // belirli uyeye run istense bile atlanir
    const run = await request(app.getHttpServer())
      .post('/v1/admin/payouts/run')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ membershipIds: [seller.id] })
      .expect(200);
    expect(run.body.paidCount).toBe(0);
    expect(run.body.skipped[0].reason).toBe('below_min');
  });

  it('uye payout talebi: esik alti 400, esik ustu requested', async () => {
    const { tenant, seller, owner } = await scenario();
    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    void owner;

    // bakiye yokken talep 400
    await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(400);

    // payable olustur ($5000)
    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const { EngineService } = await import('../src/engine/engine.service');
    await new EngineService(prisma, new RanksService(prisma)).approveSale(sale.id);
    // not: cek-odeme adresi (Faz A2 kapisi) createChain helper'inda varsayilan dolu gelir

    const req1 = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(req1.body.status).toBe(PayoutStatus.requested);
    expect(req1.body.requestedCents).toBe('500000');

    // ayni donemde ikinci talep yeni kayit acmaz (idempotent intent)
    const req2 = await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(req2.body.id).toBe(req1.body.id);

    const mine = await request(app.getHttpServer())
      .get('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(mine.body).toHaveLength(1);
  });

  it('staff payout goremez/calistiramaz (403)', async () => {
    const { tenant, chain } = await scenario();
    const staff = chain[2];
    await prisma.membership.update({ where: { id: staff.id }, data: { role: Role.tenant_staff } });
    const staffTok = token({ userId: staff.userId, membershipId: staff.id, tenantId: tenant.id, role: Role.tenant_staff });

    await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${staffTok}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/v1/admin/payouts/run')
      .set('Authorization', `Bearer ${staffTok}`)
      .send({})
      .expect(403);
  });
});
