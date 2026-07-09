import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role, Tenant } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { EngineService } from '../src/engine/engine.service';
import { RanksService } from '../src/ranks/ranks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { monthKey } from '../src/engine/month';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

const monthKeyFor = (tz: string) => monthKey(new Date(), tz);

/** Platform yuzeyi: kiracci-ustu sirket dizini + drill-in. Yalniz isPlatformAdmin erisir. */
describe('platform companies (entegrasyon)', () => {
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

  afterAll(async () => await app.close());
  beforeEach(async () => await truncateAll(prisma));

  function token(p: Partial<AccessTokenPayload> & { sub: string }): string {
    const payload: AccessTokenPayload = { mid: null, tid: null, role: null, ...p };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  it('platform admin sirketleri + KPI + agi gorur; tenant_owner goremez (403)', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 4);
    await prisma.membership.update({ where: { id: chain[0].id }, data: { role: Role.tenant_owner } });
    const engine = new EngineService(prisma, new RanksService(prisma));
    const sale = await createSale(prisma, tenant.id, chain[3].id, 10_000_000n);
    await engine.approveSale(sale.id);

    const platformUser = await prisma.user.create({
      data: { email: 'plat@test.refearn.local', passwordHash: 'x', fullName: 'Platform', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });

    // sirketler dizini (sayfali: { total, rows })
    const companies = (await request(app.getHttpServer()).get('/v1/platform/companies').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(companies.total).toBe(1);
    expect(companies.rows).toHaveLength(1);
    expect(companies.rows[0].id).toBe(tenant.id);
    expect(companies.rows[0].members).toBe(4);
    expect(companies.rows[0].revenueThisMonthCents).toBe('10000000');

    // sirket ozeti
    const detail = (await request(app.getHttpServer()).get(`/v1/platform/companies/${tenant.id}`).set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(detail.kpis.members).toBe(4);
    expect(detail.plan).not.toBeNull();

    // ag (flat nodes)
    const net = (await request(app.getHttpServer()).get(`/v1/platform/companies/${tenant.id}/network`).set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(net).toHaveLength(4);
    expect(net[0]).toHaveProperty('referralCode');

    // tenant_owner platform yuzeyine eremez
    const ownerTok = token({ sub: chain[0].userId, mid: chain[0].id, tid: tenant.id, role: Role.tenant_owner });
    await request(app.getHttpServer()).get('/v1/platform/companies').set('Authorization', `Bearer ${ownerTok}`).expect(403);
  });

  it('C2 billing (manuel): config → fatura → mark-paid → AR; duplicate 409; owner eremez', async () => {
    const tenant = await createTenant(prisma);
    const platformUser = await prisma.user.create({ data: { email: 'plat2@test.refearn.local', passwordHash: 'x', fullName: 'Platform', isPlatformAdmin: true } });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    // config ($99/ay)
    const cfg = (await request(srv).put(`/v1/platform/companies/${tenant.id}/billing`).set('Authorization', `Bearer ${platTok}`).send({ monthlyFeeCents: 9900, active: true }).expect(200)).body;
    expect(cfg.config.monthlyFeeCents).toBe('9900');

    // fatura kes (open)
    const inv = (await request(srv).post(`/v1/platform/companies/${tenant.id}/invoices`).set('Authorization', `Bearer ${platTok}`).send({ period: '2026-06' }).expect(200)).body;
    expect(inv.status).toBe('open');
    expect(inv.amountCents).toBe('9900');

    // ayni donem tekrar → 409
    await request(srv).post(`/v1/platform/companies/${tenant.id}/invoices`).set('Authorization', `Bearer ${platTok}`).send({ period: '2026-06' }).expect(409);

    // AR: acik 9900
    const ar1 = (await request(srv).get('/v1/platform/billing').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(ar1.totals.openCents).toBe('9900');
    expect(ar1.totals.paidCents).toBe('0');

    // odendi (cek referansiyla)
    const paid = (await request(srv).post(`/v1/platform/invoices/${inv.id}/paid`).set('Authorization', `Bearer ${platTok}`).send({ note: 'check #555' }).expect(200)).body;
    expect(paid.status).toBe('paid');
    expect(paid.paidNote).toBe('check #555');

    // AR: artik acik 0, odenen 9900
    const ar2 = (await request(srv).get('/v1/platform/billing').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(ar2.totals.openCents).toBe('0');
    expect(ar2.totals.paidCents).toBe('9900');

    // owner billing'e eremez
    const owner = await prisma.user.create({ data: { email: 'o@test.refearn.local', passwordHash: 'x', fullName: 'O' } });
    const m = await prisma.membership.create({ data: { tenantId: tenant.id, userId: owner.id, role: Role.tenant_owner, referralCode: 'O1', path: 'x', depth: 0 } });
    const ownerTok = token({ sub: owner.id, mid: m.id, tid: tenant.id, role: Role.tenant_owner });
    await request(srv).get('/v1/platform/billing').set('Authorization', `Bearer ${ownerTok}`).expect(403);
  });

  it('C1: platform admin sirketi askiya alir / aktive eder (audit)', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id); // item 2 (Task 3) activate-gate: aktivasyon icin plan gerekli
    const platformUser = await prisma.user.create({ data: { email: 'plat3@test.refearn.local', passwordHash: 'x', fullName: 'Platform', isPlatformAdmin: true } });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    await request(srv).patch(`/v1/platform/companies/${tenant.id}/status`).set('Authorization', `Bearer ${platTok}`).send({ status: 'suspended' }).expect(200);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('suspended');

    await request(srv).patch(`/v1/platform/companies/${tenant.id}/status`).set('Authorization', `Bearer ${platTok}`).send({ status: 'active' }).expect(200);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('active');

    const audit = await prisma.auditLog.count({ where: { tenantId: tenant.id, action: { startsWith: 'platform.tenant_' } } });
    expect(audit).toBe(2);
  });

  it('item 11: paginates, filters by status, and computes revenue in one grouped pass', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-pg@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    // 25 tenants; one gets a current-month approved sale, one is suspended
    const tenants: Tenant[] = [];
    for (let i = 0; i < 25; i++) tenants.push(await createTenant(prisma));
    await prisma.tenant.update({ where: { id: tenants[0].id }, data: { status: 'suspended' } });
    const chain = await createChain(prisma, tenants[1].id, 1);
    const sale = await createSale(prisma, tenants[1].id, chain[0].id, 5_000_000n, { status: 'approved' });
    await prisma.sale.update({
      where: { id: sale.id },
      data: { summaryMonth: monthKeyFor(tenants[1].timezone) },
    });

    // page 1, size 10 → 10 rows, total 25
    const p1 = (await request(srv).get('/v1/platform/companies?page=1&pageSize=10')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(p1.total).toBe(25);
    expect(p1.rows).toHaveLength(10);

    // page 3 → 5 rows
    const p3 = (await request(srv).get('/v1/platform/companies?page=3&pageSize=10')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(p3.rows).toHaveLength(5);

    // status filter
    const suspended = (await request(srv).get('/v1/platform/companies?status=suspended&pageSize=100')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(suspended.total).toBe(1);
    expect(suspended.rows[0].id).toBe(tenants[0].id);

    // revenue attributed to the right tenant (single grouped query)
    const all = (await request(srv).get('/v1/platform/companies?pageSize=100')
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    const withRev = all.rows.find((r: { id: string }) => r.id === tenants[1].id);
    expect(withRev.revenueThisMonthCents).toBe('5000000');
  });

  it('item 2: setup_needed enum round-trips and status schema accepts it', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-sn@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const tenant = await prisma.tenant.create({
      data: { slug: 'setup-co', name: 'Setup Co', status: 'setup_needed' },
    });
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('setup_needed');

    // plan gerekli: item 2 (Task 3) activate-gate plansiz aktivasyonu 400'ler; enum round-trip niyeti korunur
    await createPlan(prisma, tenant.id);

    // PATCH status accepts setup_needed → active
    await request(app.getHttpServer())
      .patch(`/v1/platform/companies/${tenant.id}/status`)
      .set('Authorization', `Bearer ${platTok}`)
      .send({ status: 'active' })
      .expect(200);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('active');
  });

  it('item 2: createCompany lands in setup_needed; branding validates; activate blocked without plan', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-wiz@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const created = (await request(srv).post('/v1/platform/companies')
      .set('Authorization', `Bearer ${platTok}`)
      .send({ name: 'Wizard Co', slug: 'wizard-co', currency: 'USD', timezone: 'America/New_York', ownerEmail: 'own@wiz.co', ownerName: 'Owner' })
      .expect(201)).body;
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: created.id } });
    expect(t.status).toBe('setup_needed');

    // company() exposes setup block (has default plan → hasPlan true)
    const detail = (await request(srv).get(`/v1/platform/companies/${created.id}`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(detail.setup).toMatchObject({ hasPlan: true, hasBranding: false });

    // bad hex rejected
    await request(srv).put(`/v1/platform/companies/${created.id}/branding`)
      .set('Authorization', `Bearer ${platTok}`)
      .send({ primaryHex: 'red' }).expect(400);

    // good branding persists
    await request(srv).put(`/v1/platform/companies/${created.id}/branding`)
      .set('Authorization', `Bearer ${platTok}`)
      .send({ primaryHex: '#112233', logoUrl: 'https://cdn.example.com/l.png' }).expect(200);
    const d2 = (await request(srv).get(`/v1/platform/companies/${created.id}`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(d2.setup.hasBranding).toBe(true);

    // activate with plan → allowed
    await request(srv).patch(`/v1/platform/companies/${created.id}/status`)
      .set('Authorization', `Bearer ${platTok}`).send({ status: 'active' }).expect(200);

    // a plan-less tenant cannot be activated
    const bare = await prisma.tenant.create({ data: { slug: 'bare-co', name: 'Bare', status: 'setup_needed' } });
    await request(srv).patch(`/v1/platform/companies/${bare.id}/status`)
      .set('Authorization', `Bearer ${platTok}`).send({ status: 'active' }).expect(400);
  });

  it('item 3: members + payouts endpoints are tenant-scoped and paginate', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-tab@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const tA = await createTenant(prisma);
    const tB = await createTenant(prisma);
    const chainA = await createChain(prisma, tA.id, 3);
    await createChain(prisma, tB.id, 2);
    await prisma.payout.create({ data: { tenantId: tA.id, membershipId: chainA[0].id, totalCents: 1000n, period: '2026-07' } });

    const members = (await request(srv).get(`/v1/platform/companies/${tA.id}/members?page=1&pageSize=2`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(members.total).toBe(3);
    expect(members.rows).toHaveLength(2);
    expect(members.rows.every((r: { tenantId: string }) => r.tenantId === undefined || r.tenantId === tA.id)).toBe(true);

    const payouts = (await request(srv).get(`/v1/platform/companies/${tA.id}/payouts`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(payouts.total).toBe(1);
    expect(payouts.rows[0].totalCents).toBe('1000');
  });

  it('item 1: overview surfaces each needs-attention kind exactly once; suspended excluded from no-member/no-plan', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-ov@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    // no members (active, no memberships, no plan) — surfaces no-members AND no-plan
    const noMembers = await createTenant(prisma);
    // no plan but has members
    const noPlan = await createTenant(prisma);
    await createChain(prisma, noPlan.id, 1);
    // stuck payout (4 days old, requested)
    const stuck = await createTenant(prisma);
    const sc = await createChain(prisma, stuck.id, 1);
    await createPlan(prisma, stuck.id);
    const oldPayout = await prisma.payout.create({ data: { tenantId: stuck.id, membershipId: sc[0].id, totalCents: 1n, period: '2026-07', status: 'requested' } });
    await prisma.payout.update({ where: { id: oldPayout.id }, data: { createdAt: new Date(Date.now() - 4 * 86_400_000) } });
    // suspended → must NOT appear for no-member/no-plan
    const suspended = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: suspended.id }, data: { status: 'suspended' } });

    const ov = (await request(srv).get('/v1/platform/overview').set('Authorization', `Bearer ${platTok}`).expect(200)).body;

    expect(ov.kpis.companies).toBeGreaterThanOrEqual(4);
    const kinds = (id: string) => ov.needsAttention.filter((r: { tenantId: string }) => r.tenantId === id).map((r: { kind: string }) => r.kind).sort();
    expect(kinds(noMembers.id)).toEqual(['no_members', 'no_plan']);
    expect(kinds(stuck.id)).toContain('stuck_payout');
    expect(ov.needsAttention.find((r: { kind: string; severity: string }) => r.kind === 'stuck_payout').severity).toBe('high');
    expect(kinds(suspended.id)).not.toContain('no_members');
    expect(kinds(suspended.id)).not.toContain('no_plan');
  });

  it('item 4: platform admin with NO membership impersonates owner (GET ok, POST 403); suspended rejected; audits land', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-imp@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const tenant = await createTenant(prisma);
    const [owner] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: 'tenant_owner' } });

    const res = (await request(srv).post(`/v1/platform/companies/${tenant.id}/impersonate`)
      .set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(res.accessToken).toBeTruthy();
    const claims = JSON.parse(Buffer.from(res.accessToken.split('.')[1], 'base64').toString());
    expect(claims.imp).toBe(platformUser.id);
    expect(claims.mid).toBe(owner.id);
    expect(claims.role).toBe('tenant_owner');

    // GET works, POST 403 (read-only by construction)
    await request(srv).get('/v1/app/dashboard').set('Authorization', `Bearer ${res.accessToken}`).expect(200);
    await request(srv).post('/v1/app/sales').set('Authorization', `Bearer ${res.accessToken}`).send({ amountCents: 1 }).expect(403);

    // start + end audit rows in tenant chain
    await request(srv).post(`/v1/platform/companies/${tenant.id}/impersonate/end`).set('Authorization', `Bearer ${platTok}`).expect(200);
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'security.platform_impersonate_start' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'security.platform_impersonate_end' } })).toBe(1);

    // suspended tenant rejected
    const susp = await createTenant(prisma);
    const [so] = await createChain(prisma, susp.id, 1);
    await prisma.membership.update({ where: { id: so.id }, data: { role: 'tenant_owner' } });
    await prisma.tenant.update({ where: { id: susp.id }, data: { status: 'suspended' } });
    await request(srv).post(`/v1/platform/companies/${susp.id}/impersonate`).set('Authorization', `Bearer ${platTok}`).expect(400);

    // impersonate/end for a non-existent tenant → 404 (no orphan audit row)
    await request(srv).post('/v1/platform/companies/00000000-0000-0000-0000-000000000000/impersonate/end')
      .set('Authorization', `Bearer ${platTok}`).expect(404);
  });

  it('item 6: per-tenant + global audit viewer with action filter and actor resolution', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-au@test.refearn.local', passwordHash: 'x', fullName: 'Platform Admin', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const tA = await createTenant(prisma);
    const tB = await createTenant(prisma);
    // suspend tA (writes platform.tenant_suspended) + billing on tB
    await request(srv).patch(`/v1/platform/companies/${tA.id}/status`).set('Authorization', `Bearer ${platTok}`).send({ status: 'suspended' }).expect(200);
    await request(srv).put(`/v1/platform/companies/${tB.id}/billing`).set('Authorization', `Bearer ${platTok}`).send({ monthlyFeeCents: 5000, active: true }).expect(200);
    const inv = (await request(srv).post(`/v1/platform/companies/${tB.id}/invoices`).set('Authorization', `Bearer ${platTok}`).send({ period: '2026-06' }).expect(200)).body;
    await request(srv).post(`/v1/platform/invoices/${inv.id}/paid`).set('Authorization', `Bearer ${platTok}`).send({}).expect(200);

    // per-tenant feed for tA
    const a = (await request(srv).get(`/v1/platform/companies/${tA.id}/audit`).set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(a.items.some((r: { action: string; actorName: string }) => r.action === 'platform.tenant_suspended' && r.actorName === 'Platform Admin')).toBe(true);

    // global feed: rows from multiple tenants + tenantName
    const g = (await request(srv).get('/v1/platform/audit?pageSize=100').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    const tenantIds = new Set(g.items.map((r: { tenantId: string }) => r.tenantId));
    expect(tenantIds.has(tA.id) && tenantIds.has(tB.id)).toBe(true);
    expect(g.items[0]).toHaveProperty('tenantName');

    // filter by action
    const paid = (await request(srv).get('/v1/platform/audit?action=billing.invoice_paid&pageSize=100').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(paid.items.length).toBe(1);
    expect(paid.items[0].action).toBe('billing.invoice_paid');

    // tenant_admin token 403 on global feed
    const owner = await prisma.user.create({ data: { email: 'ow6@test.refearn.local', passwordHash: 'x', fullName: 'O' } });
    const m = await prisma.membership.create({ data: { tenantId: tB.id, userId: owner.id, role: 'tenant_owner', referralCode: 'OW6', path: 'x', depth: 0 } });
    const ownerTok = token({ sub: owner.id, mid: m.id, tid: tB.id, role: 'tenant_owner' });
    await request(srv).get('/v1/platform/audit').set('Authorization', `Bearer ${ownerTok}`).expect(403);
  });

  it('item 5: cross-tenant search finds users by email + members by referral code; q<2 empty; tenant_admin 403', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-se@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const tA = await createTenant(prisma);
    const target = await prisma.user.create({ data: { email: 'findme@acme.co', passwordHash: 'x', fullName: 'Find Me' } });
    const mem = await prisma.membership.create({ data: { tenantId: tA.id, userId: target.id, role: 'member', referralCode: 'GOLD99', path: 'x', depth: 0 } });

    const byEmail = (await request(srv).get('/v1/platform/search?q=findme').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(byEmail.users.some((u: { email: string }) => u.email === 'findme@acme.co')).toBe(true);

    // referral code case-insensitive
    const byCode = (await request(srv).get('/v1/platform/search?q=gold99').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(byCode.members.some((m: { referralCode: string; tenantId: string }) => m.referralCode === 'GOLD99' && m.tenantId === tA.id)).toBe(true);

    // q < 2 → all empty
    const short = (await request(srv).get('/v1/platform/search?q=a').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(short.users).toHaveLength(0);
    expect(short.members).toHaveLength(0);

    // tenant_admin 403
    const admin = await prisma.user.create({ data: { email: 'ad5@test.refearn.local', passwordHash: 'x', fullName: 'A' } });
    const am = await prisma.membership.create({ data: { tenantId: tA.id, userId: admin.id, role: 'tenant_admin', referralCode: 'AD5', path: 'y', depth: 0 } });
    const adminTok = token({ sub: admin.id, mid: am.id, tid: tA.id, role: 'tenant_admin' });
    await request(srv).get('/v1/platform/search?q=findme').set('Authorization', `Bearer ${adminTok}`).expect(403);
    void mem;
  });

  it('item 7: /platform/health returns db:true + jobs array + backups; tenant token 403', async () => {
    const platformUser = await prisma.user.create({
      data: { email: 'plat-hl@test.refearn.local', passwordHash: 'x', fullName: 'P', isPlatformAdmin: true },
    });
    const platTok = token({ sub: platformUser.id, plat: true });
    const srv = app.getHttpServer();

    const h = (await request(srv).get('/v1/platform/health').set('Authorization', `Bearer ${platTok}`).expect(200)).body;
    expect(h.db).toBe(true);
    expect(Array.isArray(h.jobs)).toBe(true);
    expect(h).toHaveProperty('backups');

    const owner = await prisma.user.create({ data: { email: 'ow7@test.refearn.local', passwordHash: 'x', fullName: 'O' } });
    const tenant = await createTenant(prisma);
    const m = await prisma.membership.create({ data: { tenantId: tenant.id, userId: owner.id, role: 'tenant_owner', referralCode: 'OW7', path: 'x', depth: 0 } });
    const ownerTok = token({ sub: owner.id, mid: m.id, tid: tenant.id, role: 'tenant_owner' });
    await request(srv).get('/v1/platform/health').set('Authorization', `Bearer ${ownerTok}`).expect(403);
  });
});
