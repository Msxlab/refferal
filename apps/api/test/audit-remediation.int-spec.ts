import { BadRequestException, ConflictException, INestApplication, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { MembershipStatus, Role, SaleStatus, TenantStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { ActorContext } from '../src/common/actor';
import { AnnouncementsService } from '../src/announcements/announcements.service';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { EngineService } from '../src/engine/engine.service';
import { KycService } from '../src/kyc/kyc.service';
import { MembersAdminService } from '../src/members/members.admin.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { PeriodsService } from '../src/periods/periods.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SalesService } from '../src/sales/sales.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/**
 * Denetim remediation regresyonu: her test, duzeltilen DAVRANISIN dogrulugunu kanitlar
 * (mevcut suite yalniz "kirilmadi"yi gosterir — bunlar "duzeltildi"yi gosterir).
 */
describe('audit remediation (regresyon)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let engine: EngineService;
  let payouts: PayoutsService;
  let periods: PeriodsService;
  let kyc: KycService;
  let members: MembersAdminService;
  let sales: SalesService;
  let campaigns: CampaignsService;
  let announcements: AnnouncementsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    engine = moduleRef.get(EngineService);
    payouts = moduleRef.get(PayoutsService);
    periods = moduleRef.get(PeriodsService);
    kyc = moduleRef.get(KycService);
    members = moduleRef.get(MembersAdminService);
    sales = moduleRef.get(SalesService);
    campaigns = moduleRef.get(CampaignsService);
    announcements = moduleRef.get(AnnouncementsService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); await prisma.sanctionsEntry.deleteMany(); await prisma.rankTier.deleteMany(); });

  const tok = (o: { userId: string; mid: string; tid: string; role: Role }) =>
    jwt.sign({ sub: o.userId, mid: o.mid, tid: o.tid, role: o.role } as AccessTokenPayload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });

  // ---- CRITICAL #1: pool-cap Model B (bonuslar havuz USTUNE, toplam tavan ALTINDA) ----
  it('pool-cap: bonuslar havuzun ustune odenir ama toplam dagitim tavani asilmaz', async () => {
    const tenant = await createTenant(prisma); // on_approval -> payable
    const plan = await createPlan(prisma, tenant.id);
    await prisma.commissionPlan.update({ where: { id: plan.id }, data: { fastStartBps: 1000, fastStartDays: 30, matchingBps: 1000 } });
    // rutbe override tier: minTeam/minEarnings=0 -> satici her zaman bu tier (override 500bps)
    await prisma.rankTier.create({ data: { tenantId: tenant.id, name: 'Top', sortOrder: 0, minTeam: 0, minEarningsCents: 0n, overrideBps: 500 } });
    const [, seller] = await createChain(prisma, tenant.id, 2);

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n); // $100k
    await engine.approveSale(sale.id);

    const lines = await prisma.ledgerEntry.findMany({ where: { saleId: sale.id, type: 'commission' } });
    const total = lines.reduce((a, e) => a + e.amountCents, 0n);
    // tavan = pool(1000) + fastStart(1000) + matching(1000) + maxOverride(500) = 3500bps of $100k
    const ceiling = (10_000_000n * 3500n) / 10000n;
    expect(total).toBeLessThanOrEqual(ceiling);
    // override satiri (sentetik 1002) saticinin USTUNE yazildi
    const override = lines.find((e) => e.level === 1002);
    expect(override?.amountCents).toBe(500_000n); // $100k * 5%
    // fast-start (1000) + matching (1001) de var (bonuslar havuz ustune)
    expect(lines.some((e) => e.level === 1000)).toBe(true);
    expect(lines.some((e) => e.level === 1001)).toBe(true);
  });

  // ---- CRITICAL #2: kilitli donemde payout talebi onaylanamaz ----
  it('period-lock: kilitli donemde decide(approve) reddedilir', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { payoutMinCents: 1n } });
    await createPlan(prisma, tenant.id);
    const [sponsor, seller] = await createChain(prisma, tenant.id, 2);
    const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n, { saleDate: new Date('2026-06-15T12:00:00Z') });
    await engine.approveSale(sale.id);
    const actor: ActorContext = { userId: sponsor.userId, tenantId: tenant.id };
    const req = await payouts.requestPayout(seller.id, tenant.id);
    await periods.lock(actor, '2026-06');
    await expect(payouts.decide(actor, req.id, { action: 'approve' })).rejects.toThrow(/kilitli/);
  });

  // ---- CRITICAL #3: reconcile ayni payout'u iki kez temizlemez ----
  it('reconcile: tek eslesen payout iki ekstre satiriyla cift-temizlenmez', async () => {
    const tenant = await createTenant(prisma);
    const [m] = await createChain(prisma, tenant.id, 1);
    await prisma.payout.create({ data: { tenantId: tenant.id, membershipId: m.id, totalCents: 150000n, method: 'manual', status: 'paid', period: '2026-06', paidAt: new Date() } });
    const actor: ActorContext = { userId: m.userId, tenantId: tenant.id };
    const res = await payouts.reconcile(actor, [{ amountCents: 150000 }, { amountCents: 150000 }]);
    expect(res.clearedCount).toBe(1);
    expect(res.unmatched.length).toBe(1);
    const cleared = await prisma.payout.count({ where: { tenantId: tenant.id, clearedAt: { not: null } } });
    expect(cleared).toBe(1);
  });

  // ---- HIGH: uye ikinci payout talebinde ayni acik talebi alir (dedup + DB unique) ----
  it('payout dedup: ikinci talep ayni acik payout u dondurur (tek acik kayit)', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { payoutMinCents: 1n } });
    await createPlan(prisma, tenant.id);
    const [, seller] = await createChain(prisma, tenant.id, 2);
    const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n);
    await engine.approveSale(sale.id);
    const r1 = await payouts.requestPayout(seller.id, tenant.id);
    const r2 = await payouts.requestPayout(seller.id, tenant.id);
    expect(r2.id).toBe(r1.id);
    const open = await prisma.payout.count({ where: { tenantId: tenant.id, membershipId: seller.id, status: 'requested' } });
    expect(open).toBe(1);
  });

  // ---- HIGH: RBAC tier yukseltme — sahip olmadigin izinle tenant_admin'e yukseltemezsin ----
  it('rbac: settings.roles tasiyan admin bir uyeyi tenant_admin e YUKSELTEMEZ (403)', async () => {
    const tenant = await createTenant(prisma);
    const [owner, admin, member] = await createChain(prisma, tenant.id, 3);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: admin.id }, data: { role: Role.tenant_admin } });
    const adminTok = jwt.sign(
      { sub: admin.userId, mid: admin.id, tid: tenant.id, role: Role.tenant_admin, perms: ['dashboard.view', 'settings.view', 'settings.roles'] } as AccessTokenPayload,
      { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds },
    );
    await request(app.getHttpServer())
      .patch(`/v1/admin/people/${member.id}/role`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ tier: 'tenant_admin' })
      .expect(403);
    const after = await prisma.membership.findUnique({ where: { id: member.id } });
    expect(after!.role).toBe(Role.member);
  });

  // ---- HIGH: API anahtari yasam-dongusu (sure dolma + kiraci askisi reddi) ----
  it('api-key: suresi dolmus anahtar ve askili kiraci reddedilir (401)', async () => {
    const tenant = await createTenant(prisma);
    const [owner] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const ownerTok = tok({ userId: owner.userId, mid: owner.id, tid: tenant.id, role: Role.tenant_owner });
    const created = await request(app.getHttpServer()).post('/v1/admin/api-keys').set('Authorization', `Bearer ${ownerTok}`).send({ name: 'CRM' }).expect(201);
    const raw = created.body.key as string;
    await request(app.getHttpServer()).get('/v1/admin/members').set('X-Api-Key', raw).expect(200);

    // sure dolma kapisi
    await prisma.apiKey.update({ where: { id: created.body.id }, data: { expiresAt: new Date('2020-01-01T00:00:00Z') } });
    await request(app.getHttpServer()).get('/v1/admin/members').set('X-Api-Key', raw).expect(401);
    await prisma.apiKey.update({ where: { id: created.body.id }, data: { expiresAt: null } });
    await request(app.getHttpServer()).get('/v1/admin/members').set('X-Api-Key', raw).expect(200);

    // kiraci askisi kapisi
    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: TenantStatus.suspended } });
    await request(app.getHttpServer()).get('/v1/admin/members').set('X-Api-Key', raw).expect(401);
  });

  // ---- HIGH: OFAC CANLI yeniden tarama (submit'te temiz, sonra listeye girince payout bloklu) ----
  it('ofac: submit sonrasi listeye giren ad payout talebinde CANLI yakalanir', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { payoutMinCents: 1n } });
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    const sale = await createSale(prisma, tenant.id, seller.id, 1_000_000n);
    await engine.approveSale(sale.id);
    const actor: ActorContext = { userId: owner.userId, tenantId: tenant.id };
    // TEMIZ profil (submit aninda liste bos)
    await kyc.upsert(actor, seller.id, { legalName: 'Clean Person', country: 'US', taxIdType: 'ssn', taxId: '123456789', routingNumber: '021000021', accountType: 'checking', accountNumber: '000111222' });
    const prof = await prisma.payoutProfile.findUnique({ where: { membershipId: seller.id } });
    expect(prof!.sanctionsHit).toBe(false);
    // ad SONRADAN listeye girer
    await prisma.sanctionsEntry.create({ data: { name: 'Clean Person', normalizedName: 'clean person', source: 'OFAC' } });
    // payout talebi CANLI tarama ile bloklanir
    await expect(payouts.requestPayout(seller.id, tenant.id)).rejects.toThrow(/sanctions/);
  });

  // ---- HIGH: maker-checker — onaylanan snapshot'tan fazlasi odenmez ----
  it('maker-checker: talep sonrasi bakiye artarsa decide(approve) reddedilir', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { payoutMinCents: 1n } });
    await createPlan(prisma, tenant.id);
    const [sponsor, seller] = await createChain(prisma, tenant.id, 2);
    const sale1 = await createSale(prisma, tenant.id, seller.id, 1_000_000n);
    await engine.approveSale(sale1.id);
    const actor: ActorContext = { userId: sponsor.userId, tenantId: tenant.id };
    const req = await payouts.requestPayout(seller.id, tenant.id); // snapshot = sale1 komisyonu
    // talepten SONRA yeni komisyon olgunlasir (bakiye artar)
    const sale2 = await createSale(prisma, tenant.id, seller.id, 5_000_000n);
    await engine.approveSale(sale2.id);
    await expect(payouts.decide(actor, req.id, { action: 'approve' })).rejects.toThrow(/yenileyin|artti/);
  });

  // ---- LOW: announcement markRead caprazl-tenant yazimi engellenir ----
  it('announcement: baska kiracinin duyurusu okundu isaretlenemez (NotFound)', async () => {
    const tA = await createTenant(prisma);
    const tB = await createTenant(prisma);
    const [ownerA] = await createChain(prisma, tA.id, 1);
    const [memberB] = await createChain(prisma, tB.id, 1);
    const ann = await announcements.create({ userId: ownerA.userId, tenantId: tA.id }, 'A duyuru', 'govde');
    // B kiracisindaki uye, A'nin duyurusunu kendi tenant'inda okundu yapamaz
    await expect(announcements.markRead(tB.id, memberB.id, ann.id)).rejects.toThrow(NotFoundException);
    // dogru tenant ise calisir
    const [memberA2] = await createChain(prisma, tA.id, 1);
    const ok = await announcements.markRead(tA.id, memberA2.id, ann.id);
    expect(ok.read).toBe(true);
  });

  // ---- LOW: pasif uye impersonate edilemez ----
  it('impersonation: pasif uye impersonate edilemez', async () => {
    const tenant = await createTenant(prisma);
    const [owner, member] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: member.id }, data: { status: MembershipStatus.inactive } });
    await expect(members.impersonate({ userId: owner.userId, tenantId: tenant.id }, member.id)).rejects.toThrow(BadRequestException);
  });

  // ---- LOW: void satislar ortalama-satis KPI'sini sismez ----
  it('sales summary: void satislar count/avg disinda kalir (yalniz statu kirilimda)', async () => {
    const tenant = await createTenant(prisma);
    const [, seller] = await createChain(prisma, tenant.id, 2);
    await createSale(prisma, tenant.id, seller.id, 1_000_000n, { status: SaleStatus.approved });
    await createSale(prisma, tenant.id, seller.id, 9_000_000n, { status: SaleStatus.void });
    const actor: ActorContext = { userId: seller.userId, tenantId: tenant.id };
    const s = await sales.summary(actor, {} as never);
    expect(s.count).toBe(1); // yalniz approved sayilir
    expect(s.sumCents).toBe('1000000'); // void haric
    expect(s.byStatus.void.count).toBe(1); // ama kirilimda gorunur
  });

  // ---- HIGH: kampanya finalize atomik claim — eszamanli finalize tek odul yazar ----
  it('campaign: eszamanli finalize cift odul yazmaz (atomik claim)', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const start = new Date(Date.now() - 7 * 86_400_000);
    const end = new Date(Date.now() + 7 * 86_400_000);
    // pencerede onayli satis -> seller rank 1
    const sale = await createSale(prisma, tenant.id, seller.id, 2_000_000n, { saleDate: new Date() });
    await engine.approveSale(sale.id);
    const c = await prisma.campaign.create({
      data: { tenantId: tenant.id, name: 'Yaris', metric: 'revenue', startsAt: start, endsAt: end, status: 'active', prizes: [{ rank: 1, bonusCents: 100000 }], createdBy: owner.userId },
    });
    const actor: ActorContext = { userId: owner.userId, tenantId: tenant.id };
    const results = await Promise.allSettled([campaigns.finalize(actor, c.id), campaigns.finalize(actor, c.id)]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBe(1); // yalniz biri gecis yapar
    const bonuses = await prisma.ledgerEntry.count({ where: { tenantId: tenant.id, type: 'adjustment' } });
    expect(bonuses).toBe(1); // odul yalniz BIR kez yazildi
  });
});
