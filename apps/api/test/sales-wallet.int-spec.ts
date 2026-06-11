import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MembershipStatus, Role, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

/**
 * Sales (admin) + wallet/dashboard/team (uye) — HTTP, gercek Postgres.
 * SPEC 8/9: motor tetikleme, RBAC, tenant-scope, gizlilik (agregat ekip).
 */
describe('sales + wallet (entegrasyon)', () => {
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

  /** Belirli rol/uyelik icin access token uretir (login akisindan bagimsiz). */
  function tokenFor(opts: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const payload: AccessTokenPayload = {
      sub: opts.userId,
      mid: opts.membershipId,
      tid: opts.tenantId,
      role: opts.role,
    };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  async function setRole(membershipId: string, role: Role): Promise<void> {
    await prisma.membership.update({ where: { id: membershipId }, data: { role } });
  }

  it('admin satis girer → onaylar → motor calisir; staff onaylayamaz', async () => {
    const tenant = await createTenant(prisma); // on_approval
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    const owner = chain[0];
    const seller = chain[5];
    await setRole(owner.id, Role.tenant_owner);

    const ownerTok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    // satis gir (referral kod ile)
    const created = await request(app.getHttpServer())
      .post('/v1/admin/sales')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ sellerReferralCode: seller.referralCode, amountCents: 10_000_000 })
      .expect(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.amountCents).toBe('10000000');
    const saleId = created.body.id;

    // staff onaylayamaz (rol kisidi)
    const staffUser = chain[3];
    await setRole(staffUser.id, Role.tenant_staff);
    const staffTok = tokenFor({ userId: staffUser.userId, membershipId: staffUser.id, tenantId: tenant.id, role: Role.tenant_staff });
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${saleId}/approve`)
      .set('Authorization', `Bearer ${staffTok}`)
      .expect(403);

    // owner onaylar → 5 ledger satiri
    const approved = await request(app.getHttpServer())
      .post(`/v1/admin/sales/${saleId}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(approved.body.applied).toBe(true);
    expect(approved.body.entryCount).toBe(5);

    const count = await prisma.ledgerEntry.count({ where: { saleId } });
    expect(count).toBe(5);
  });

  it('tenant izolasyonu: baska tenantin satisi onaylanamaz (404)', async () => {
    const t1 = await createTenant(prisma);
    await createPlan(prisma, t1.id);
    const [owner1] = await createChain(prisma, t1.id, 1);
    await setRole(owner1.id, Role.tenant_owner);

    const t2 = await createTenant(prisma);
    await createPlan(prisma, t2.id);
    const [seller2] = await createChain(prisma, t2.id, 1);
    const sale2 = await prisma.sale.create({
      data: { tenantId: t2.id, sellerMembershipId: seller2.id, amountCents: 100_000n, saleDate: new Date() },
    });

    const owner1Tok = tokenFor({ userId: owner1.userId, membershipId: owner1.id, tenantId: t1.id, role: Role.tenant_owner });
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${sale2.id}/approve`)
      .set('Authorization', `Bearer ${owner1Tok}`)
      .expect(404);

    // t2'nin satisi t1 listesinde gorunmez
    const list = await request(app.getHttpServer())
      .get('/v1/admin/sales')
      .set('Authorization', `Bearer ${owner1Tok}`)
      .expect(200);
    expect(list.body.total).toBe(0);
  });

  it('CSV import: draft satislar olusur, hatali satirlar raporlanir', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 3);
    const owner = chain[0];
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const csv = [
      'referral_code,amount_cents,sale_date,customer_ref',
      `${chain[1].referralCode},5000000,2026-06-01,Musteri A`,
      `${chain[2].referralCode},7500000,2026-06-02,"Musteri, B"`,
      'YOKKOD,1000,2026-06-03,Hatali',
      `${chain[1].referralCode},-5,2026-06-04,Negatif`,
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/v1/admin/sales/import')
      .set('Authorization', `Bearer ${tok}`)
      .send({ csv })
      .expect(200);

    expect(res.body.created).toBe(2);
    expect(res.body.errors).toHaveLength(2);
    expect(await prisma.sale.count({ where: { tenantId: tenant.id, status: SaleStatus.draft } })).toBe(2);
    // tirnakli alan icindeki virgul korundu
    const b = await prisma.sale.findFirstOrThrow({ where: { customerRef: 'Musteri, B' } });
    expect(b.amountCents).toBe(7_500_000n);
  });

  it('uye dashboard + wallet: onay sonrasi dogru tutarlar, KENDI verisi', async () => {
    const tenant = await createTenant(prisma); // on_approval → payable
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    const owner = chain[0];
    const seller = chain[5];
    await setRole(owner.id, Role.tenant_owner);
    const ownerTok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const sale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 10_000_000n, saleDate: new Date() },
    });
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${sale.id}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);

    // satici (L0) cuzdani: payable 500.000
    const sellerTok = tokenFor({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(wallet.body.balance.payableCents).toBe('500000');
    expect(wallet.body.balance.pendingCents).toBe('0');
    expect(wallet.body.ledger.items).toHaveLength(1);
    expect(wallet.body.ledger.items[0].level).toBe(0);

    const dash = await request(app.getHttpServer())
      .get('/v1/app/dashboard')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(dash.body.totals.payableCents).toBe('500000');
    expect(dash.body.levels[0].level).toBe(0);

    // 1 ust (L1) uyenin cuzdani: payable 200.000, sadece kendi satiri
    const up1 = chain[4];
    const up1Tok = tokenFor({ userId: up1.userId, membershipId: up1.id, tenantId: tenant.id, role: Role.member });
    const up1Wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${up1Tok}`)
      .expect(200);
    expect(up1Wallet.body.balance.payableCents).toBe('200000');
    expect(up1Wallet.body.ledger.items).toHaveLength(1);
    expect(up1Wallet.body.ledger.items[0].level).toBe(1);
  });

  it('team: seviye basina AGREGAT sayilar; isim/satis donmez; kayan pencere', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id); // depth 5 → relLevel 1..4
    // owner altinda genis bir agac: owner→a→b→c→d→e→f (6 alt seviye)
    const trunk = await createChain(prisma, tenant.id, 7);
    const owner = trunk[0];
    // owner'in 1. seviyesine ikinci bir kol daha ekle
    await createChain(prisma, tenant.id, 1, owner);

    const ownerTok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.member });
    const team = await request(app.getHttpServer())
      .get('/v1/app/team')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);

    // pencere plan derinligiyle sinirli: yalnizca relLevel 1..4
    expect(team.body.levels.map((l: { level: number }) => l.level)).toEqual([1, 2, 3, 4]);
    // L1: trunk[1] + ikinci kol = 2 kisi
    expect(team.body.levels.find((l: { level: number }) => l.level === 1).memberCount).toBe(2);
    // L2: trunk[2] = 1
    expect(team.body.levels.find((l: { level: number }) => l.level === 2).memberCount).toBe(1);
    // agregat alanlardan baska bir sey sizmamali (isim/satis yok)
    const keys = Object.keys(team.body.levels[0]).sort();
    expect(keys).toEqual(['activeCount', 'level', 'memberCount']);
  });

  it('pasif uye adina satis girilemez', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 2);
    const owner = chain[0];
    await setRole(owner.id, Role.tenant_owner);
    await prisma.membership.update({ where: { id: chain[1].id }, data: { status: MembershipStatus.inactive } });
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    await request(app.getHttpServer())
      .post('/v1/admin/sales')
      .set('Authorization', `Bearer ${tok}`)
      .send({ sellerReferralCode: chain[1].referralCode, amountCents: 100_000 })
      .expect(400);
  });

  it('member rolu admin satis rotalarina erisemez', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [member] = await createChain(prisma, tenant.id, 1);
    const tok = tokenFor({ userId: member.userId, membershipId: member.id, tenantId: tenant.id, role: Role.member });

    await request(app.getHttpServer())
      .get('/v1/admin/sales')
      .set('Authorization', `Bearer ${tok}`)
      .expect(403);
  });
});
