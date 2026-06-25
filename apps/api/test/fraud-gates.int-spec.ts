import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { defaultPermissionsForTier } from '../src/common/permissions';
import { EngineService } from '../src/engine/engine.service';
import { InvitesService } from '../src/invites/invites.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dolandiricilik kapilari: SoD maker-checker, e-posta dogrulama, davet cap, guvenlik olay logu. */
describe('dolandiricilik kapilari (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let engine: EngineService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    engine = moduleRef.get(EngineService);
  });

  afterAll(async () => await app.close());
  beforeEach(async () => await truncateAll(prisma));

  function token(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const p: AccessTokenPayload = {
      sub: o.userId,
      mid: o.membershipId,
      tid: o.tenantId,
      role: o.role,
      perms: defaultPermissionsForTier(o.role),
    };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  it('SoD: requireSeparateApprover=true iken satisi giren onaylayamaz; baska admin onaylar', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { requireSeparateApprover: true } });
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 3);
    const owner = chain[0];
    const admin2 = chain[1];
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: admin2.id }, data: { role: Role.tenant_admin } });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const admin2Tok = token({ userId: admin2.userId, membershipId: admin2.id, tenantId: tenant.id, role: Role.tenant_admin });

    // owner satis girer (createdBy=owner)
    const created = await request(app.getHttpServer())
      .post('/v1/admin/sales')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ sellerReferralCode: chain[2].referralCode, amountCents: 10_000_000 })
      .expect(201);
    const saleId = created.body.id;

    // owner kendi girdigini onaylayamaz → 403
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${saleId}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(403);

    // baska admin onaylar → 200
    const ok = await request(app.getHttpServer())
      .post(`/v1/admin/sales/${saleId}/approve`)
      .set('Authorization', `Bearer ${admin2Tok}`)
      .expect(200);
    expect(ok.body.applied).toBe(true);
  });

  it('SoD kapali (varsayilan): self-onay calisir ama audit`e security.self_approved_sale dusulur', async () => {
    const tenant = await createTenant(prisma); // requireSeparateApprover=false varsayilan
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 2);
    const owner = chain[0];
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const created = await request(app.getHttpServer())
      .post('/v1/admin/sales')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ sellerReferralCode: chain[1].referralCode, amountCents: 1_000_000 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);

    const flag = await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'security.self_approved_sale' } });
    expect(flag).toBe(1);
  });

  it('payout talebi: dogrulanmamis e-posta 400; dogrulayinca gecer', async () => {
    const tenant = await createTenant(prisma); // on_approval → payable
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    const seller = chain[5];
    // seller'i dogrulanmamis yap
    await prisma.user.update({ where: { id: seller.userId }, data: { emailVerifiedAt: null } });

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    await engine.approveSale(sale.id);

    const sellerTok = token({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(400);

    // dogrula → gecer
    await prisma.user.update({ where: { id: seller.userId }, data: { emailVerifiedAt: new Date() } });
    await request(app.getHttpServer())
      .post('/v1/app/payout-requests')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
  });

  it('davet cap: gunluk limit asilinca reddedilir', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    const invites = new InvitesService(prisma);

    // 20 davet (gunluk limit) basarili, 21. reddedilir
    for (let i = 0; i < 20; i++) {
      await invites.create(member.id);
    }
    await expect(invites.create(member.id)).rejects.toThrow();
  });

  it('guvenlik olayi: basarisiz login security.login_failed audit`e yazar', async () => {
    const tenant = await createTenant(prisma);
    const [m] = await createChain(prisma, tenant.id, 1);
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: m.userId } })).email;

    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: 'kesinlikle-yanlis-sifre' })
      .expect(401);

    const ev = await prisma.auditLog.findFirst({ where: { action: 'security.login_failed' } });
    expect(ev).not.toBeNull();
    expect((ev!.after as { email: string }).email).toBe(email);
  });
});
