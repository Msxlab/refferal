import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MembershipStatus, Role, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { defaultPermissionsForTier } from '../src/common/permissions';
import { PrismaService } from '../src/prisma/prisma.service';
import { SalesService } from '../src/sales/sales.service';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

/**
 * Sales (admin) plus wallet/dashboard/team (member): HTTP against real Postgres.
 * SPEC 8/9: engine triggering, RBAC, tenant scope, and aggregate-only team privacy.
 */
describe('sales + wallet (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let salesService: SalesService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    salesService = moduleRef.get(SalesService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** Creates an access token for a specific role/membership without the login flow. */
  function tokenFor(opts: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const payload: AccessTokenPayload = {
      sub: opts.userId,
      mid: opts.membershipId,
      tid: opts.tenantId,
      role: opts.role,
      perms: defaultPermissionsForTier(opts.role),
      authGeneration: 1,
    };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  async function setRole(membershipId: string, role: Role): Promise<void> {
    await prisma.membership.update({ where: { id: membershipId }, data: { role } });
  }

  it('admin creates a sale, approves it, and triggers the engine; staff cannot approve', async () => {
    const tenant = await createTenant(prisma); // on_approval
    await prisma.tenant.update({ where: { id: tenant.id }, data: { currency: 'EUR' } });
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 6);
    const owner = chain[0];
    const seller = chain[5];
    await setRole(owner.id, Role.tenant_owner);

    const ownerTok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    // Create sale by referral code.
    const created = await request(app.getHttpServer())
      .post('/v1/admin/sales')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ sellerReferralCode: seller.referralCode, amountCents: 10_000_000, externalRef: 'ORDER-1000' })
      .expect(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.amountCents).toBe('10000000');
    expect(created.body.currency).toBe('EUR');
    const saleId = created.body.id;

    const duplicate = await request(app.getHttpServer())
      .post('/v1/admin/sales')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ sellerReferralCode: seller.referralCode, amountCents: 99_999_999, externalRef: 'ORDER-1000' })
      .expect(201);
    expect(duplicate.body.id).toBe(saleId);
    expect(duplicate.body.amountCents).toBe('10000000');
    await expect(prisma.sale.count({ where: { tenantId: tenant.id, externalRef: 'ORDER-1000' } })).resolves.toBe(1);

    // Staff cannot approve because of role restrictions.
    const staffUser = chain[3];
    await setRole(staffUser.id, Role.tenant_staff);
    const staffTok = tokenFor({ userId: staffUser.userId, membershipId: staffUser.id, tenantId: tenant.id, role: Role.tenant_staff });
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${saleId}/approve`)
      .set('Authorization', `Bearer ${staffTok}`)
      .expect(403);

    // Owner approves, producing 5 ledger rows.
    const approved = await request(app.getHttpServer())
      .post(`/v1/admin/sales/${saleId}/approve`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    expect(approved.body.applied).toBe(true);
    expect(approved.body.entryCount).toBe(5);

    const count = await prisma.ledgerEntry.count({ where: { saleId } });
    expect(count).toBe(5);
  });

  it('concurrent external-ref replay creates one sale and one sale.create audit', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 2);
    const owner = chain[0];
    const seller = chain[1];
    await setRole(owner.id, Role.tenant_owner);
    const ownerTok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const internal = salesService as unknown as {
      findByExternalRef: (tenantId: string, externalRef: string) => Promise<unknown>;
    };
    const originalFind = internal.findByExternalRef.bind(internal);
    let findCalls = 0;
    let bothChecksReached!: () => void;
    const bothChecks = new Promise<void>((resolve) => {
      bothChecksReached = resolve;
    });
    let releaseChecks!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseChecks = resolve;
    });
    const findSpy = jest.spyOn(internal, 'findByExternalRef').mockImplementation(async (tenantId, externalRef) => {
      if (externalRef === 'CONCURRENT-ORDER-1' && ++findCalls <= 2) {
        if (findCalls === 2) bothChecksReached();
        await release;
      }
      return originalFind(tenantId, externalRef);
    });

    try {
      const first = request(app.getHttpServer())
        .post('/v1/admin/sales')
        .set('Authorization', `Bearer ${ownerTok}`)
        .send({ sellerReferralCode: seller.referralCode, amountCents: 1_000_000, externalRef: 'CONCURRENT-ORDER-1' })
        .then((response) => response);
      const second = request(app.getHttpServer())
        .post('/v1/admin/sales')
        .set('Authorization', `Bearer ${ownerTok}`)
        .send({ sellerReferralCode: seller.referralCode, amountCents: 1_000_000, externalRef: 'CONCURRENT-ORDER-1' })
        .then((response) => response);
      await bothChecks;
      releaseChecks();
      const attempts = await Promise.all([first, second]);
      expect(attempts.map((attempt) => attempt.status)).toEqual([201, 201]);
      expect(attempts[0].body.id).toBe(attempts[1].body.id);
      expect(await prisma.sale.count({ where: { tenantId: tenant.id, externalRef: 'CONCURRENT-ORDER-1' } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: 'sale.create', entityId: attempts[0].body.id } })).toBe(1);
    } finally {
      findSpy.mockRestore();
    }
  });

  it('CSV import reports a conflict-resolved external-ref race as skipped rather than created', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 2);
    const owner = chain[0];
    const seller = chain[1];
    await setRole(owner.id, Role.tenant_owner);
    const actor = { userId: owner.userId, tenantId: tenant.id };
    const internal = salesService as unknown as {
      findByExternalRef: (tenantId: string, externalRef: string) => Promise<unknown>;
    };
    const originalFind = internal.findByExternalRef.bind(internal);
    let preflightReached!: () => void;
    const preflight = new Promise<void>((resolve) => {
      preflightReached = resolve;
    });
    let releasePreflight!: () => void;
    const release = new Promise<void>((resolve) => {
      releasePreflight = resolve;
    });
    let calls = 0;
    const findSpy = jest.spyOn(internal, 'findByExternalRef').mockImplementation(async (tenantId, externalRef) => {
      if (externalRef === 'IMPORT-RACE-1' && ++calls === 1) {
        preflightReached();
        await release;
        return null;
      }
      return originalFind(tenantId, externalRef);
    });

    try {
      const importing = salesService.importCsv(
        actor,
        `referral_code,amount_cents,external_ref\n${seller.referralCode},1000000,IMPORT-RACE-1\n`,
      );
      await preflight;
      const winner = await salesService.create(actor, {
        sellerReferralCode: seller.referralCode,
        amountCents: 1_000_000,
        externalRef: 'IMPORT-RACE-1',
      });
      releasePreflight();
      const result = await importing;
      expect(result.created).toBe(0);
      expect(result.skipped).toEqual([{ line: 2, reason: 'external_ref already exists', saleId: winner.id }]);
      expect(await prisma.sale.count({ where: { tenantId: tenant.id, externalRef: 'IMPORT-RACE-1' } })).toBe(1);
    } finally {
      findSpy.mockRestore();
    }
  });

  it('canonicalizes blank external refs to null for direct sales and CSV imports', async () => {
    const tenant = await createTenant(prisma);
    const chain = await createChain(prisma, tenant.id, 2);
    const owner = chain[0];
    const seller = chain[1];
    await setRole(owner.id, Role.tenant_owner);
    const ownerTok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const first = await request(app.getHttpServer())
      .post('/v1/admin/sales')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ sellerReferralCode: seller.referralCode, amountCents: 100_000, externalRef: '' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/v1/admin/sales')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ sellerReferralCode: seller.referralCode, amountCents: 200_000, externalRef: '   ' })
      .expect(201);

    expect(second.body.id).not.toBe(first.body.id);
    expect(await prisma.sale.count({ where: { tenantId: tenant.id, externalRef: null } })).toBe(2);

    const imported = await request(app.getHttpServer())
      .post('/v1/admin/sales/import')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({
        csv: [
          'referral_code,amount_cents,external_ref',
          `${seller.referralCode},300000,`,
          `${seller.referralCode},400000,   `,
        ].join('\n'),
      })
      .expect(200);
    expect(imported.body).toMatchObject({ created: 2, errors: [] });
    expect(await prisma.sale.count({ where: { tenantId: tenant.id, externalRef: null } })).toBe(4);
  });

  it('normalizes service-level nonblank external refs before replay lookup', async () => {
    const tenant = await createTenant(prisma);
    const chain = await createChain(prisma, tenant.id, 2);
    const owner = chain[0];
    const seller = chain[1];
    const actor = { userId: owner.userId, tenantId: tenant.id };

    const first = await salesService.create(actor, {
      sellerReferralCode: seller.referralCode,
      amountCents: 100_000,
      externalRef: '  SERVICE-CANONICAL-REF  ',
    });
    const replay = await salesService.create(actor, {
      sellerReferralCode: seller.referralCode,
      amountCents: 200_000,
      externalRef: 'SERVICE-CANONICAL-REF',
    });

    expect(replay.id).toBe(first.id);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: first.id } })).externalRef).toBe('SERVICE-CANONICAL-REF');
  });

  it('CSV import rejects unsafe integer-cent values without rounding or creating a sale', async () => {
    const tenant = await createTenant(prisma);
    const chain = await createChain(prisma, tenant.id, 2);
    const owner = chain[0];
    const seller = chain[1];
    await setRole(owner.id, Role.tenant_owner);
    const ownerTok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const response = await request(app.getHttpServer())
      .post('/v1/admin/sales/import')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ csv: `referral_code,amount_cents\n${seller.referralCode},9007199254740993` })
      .expect(200);

    expect(response.body.created).toBe(0);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ line: 2, reason: 'invalid amount_cents: 9007199254740993' }),
    ]);
    expect(await prisma.sale.count({ where: { tenantId: tenant.id } })).toBe(0);
  });

  it('tenant isolation: a sale from another tenant cannot be approved (404)', async () => {
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

    // t2 sale is not visible in the t1 list.
    const list = await request(app.getHttpServer())
      .get('/v1/admin/sales')
      .set('Authorization', `Bearer ${owner1Tok}`)
      .expect(200);
    expect(list.body.total).toBe(0);
  });

  it('CSV import creates draft sales and reports invalid rows', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { currency: 'EUR' } });
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 3);
    const owner = chain[0];
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const csv = [
      'referral_code,amount,sale_date,customer_ref',
      `${chain[1].referralCode},50000.00,2026-06-01,Customer A`,
      `${chain[2].referralCode},75000.00,2026-06-02,"Customer, B"`,
      'NO_CODE,10.00,2026-06-03,Invalid',
      `${chain[1].referralCode},-5,2026-06-04,Negative`,
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/v1/admin/sales/import')
      .set('Authorization', `Bearer ${tok}`)
      .send({ csv })
      .expect(200);

    expect(res.body.created).toBe(2);
    expect(res.body.errors).toHaveLength(2);
    expect(await prisma.sale.count({ where: { tenantId: tenant.id, status: SaleStatus.draft } })).toBe(2);
    // Comma inside a quoted field is preserved.
    const b = await prisma.sale.findFirstOrThrow({ where: { customerRef: 'Customer, B' } });
    expect(b.amountCents).toBe(7_500_000n);
    expect(b.currency).toBe('EUR');

    const legacy = await request(app.getHttpServer())
      .post('/v1/admin/sales/import')
      .set('Authorization', `Bearer ${tok}`)
      .send({
        csv: `referral_code,amount_cents,sale_date,customer_ref\n${chain[1].referralCode},12345,2026-06-05,Legacy cents`,
      })
      .expect(200);
    expect(legacy.body.created).toBe(1);
    const legacySale = await prisma.sale.findFirstOrThrow({ where: { customerRef: 'Legacy cents' } });
    expect(legacySale.amountCents).toBe(12_345n);
  });

  it('member dashboard + wallet show correct own-data amounts after approval', async () => {
    const tenant = await createTenant(prisma); // on_approval -> payable
    await prisma.tenant.update({ where: { id: tenant.id }, data: { currency: 'CAD' } });
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

    // Seller (L0) wallet: payable 500,000.
    const sellerTok = tokenFor({ userId: seller.userId, membershipId: seller.id, tenantId: tenant.id, role: Role.member });
    const wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(wallet.body.currency).toBe('CAD');
    expect(wallet.body.balance.payableCents).toBe('500000');
    expect(wallet.body.balance.pendingCents).toBe('0');
    expect(wallet.body.ledger.items).toHaveLength(1);
    expect(wallet.body.ledger.items[0].level).toBe(0);

    const dash = await request(app.getHttpServer())
      .get('/v1/app/dashboard')
      .set('Authorization', `Bearer ${sellerTok}`)
      .expect(200);
    expect(dash.body.currency).toBe('CAD');
    expect(dash.body.totals.payableCents).toBe('500000');
    expect(dash.body.levels[0].level).toBe(0);

    // Direct upline (L1) wallet: payable 200,000, only their own row.
    const up1 = chain[4];
    const up1Tok = tokenFor({ userId: up1.userId, membershipId: up1.id, tenantId: tenant.id, role: Role.member });
    const up1Wallet = await request(app.getHttpServer())
      .get('/v1/app/wallet')
      .set('Authorization', `Bearer ${up1Tok}`)
      .expect(200);
    expect(up1Wallet.body.currency).toBe('CAD');
    expect(up1Wallet.body.balance.payableCents).toBe('200000');
    expect(up1Wallet.body.ledger.items).toHaveLength(1);
    expect(up1Wallet.body.ledger.items[0].level).toBe(1);
  });

  it('team returns aggregate counts by level without names/sales and uses a sliding window', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id); // depth 5 -> relLevel 1..4
    // Wide tree below owner: owner -> a -> b -> c -> d -> e -> f (6 lower levels).
    const trunk = await createChain(prisma, tenant.id, 7);
    const owner = trunk[0];
    // Add a second branch at owner's first level.
    await createChain(prisma, tenant.id, 1, owner);

    const ownerTok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.member });
    const team = await request(app.getHttpServer())
      .get('/v1/app/team')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);

    // Window is limited by plan depth: only relLevel 1..4.
    expect(team.body.levels.map((l: { level: number }) => l.level)).toEqual([1, 2, 3, 4]);
    // L1: trunk[1] plus second branch = 2 people.
    expect(team.body.levels.find((l: { level: number }) => l.level === 1).memberCount).toBe(2);
    // L2: trunk[2] = 1
    expect(team.body.levels.find((l: { level: number }) => l.level === 2).memberCount).toBe(1);
    // Only aggregate fields should be exposed; no names or sales leak.
    const keys = Object.keys(team.body.levels[0]).sort();
    expect(keys).toEqual(['activeCount', 'level', 'memberCount']);
  });

  it('cannot create a sale for an inactive member', async () => {
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

  it('member role cannot access admin sales routes', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [member] = await createChain(prisma, tenant.id, 1);
    const tok = tokenFor({ userId: member.userId, membershipId: member.id, tenantId: tenant.id, role: Role.member });

    await request(app.getHttpServer())
      .get('/v1/admin/sales')
      .set('Authorization', `Bearer ${tok}`)
      .expect(403);
  });

  it('power tools: filters, bulk approve, detail ledger, and import preview', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const chain = await createChain(prisma, tenant.id, 4);
    const owner = chain[0];
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tok}`);

    // Two draft sales with different sellers/amounts.
    const s1 = (await auth(request(app.getHttpServer()).post('/v1/admin/sales')).send({ sellerReferralCode: chain[2].referralCode, amountCents: 5_000_000 }).expect(201)).body;
    const s2 = (await auth(request(app.getHttpServer()).post('/v1/admin/sales')).send({ sellerReferralCode: chain[3].referralCode, amountCents: 20_000_000 }).expect(201)).body;

    // Filter by seller code: only s2.
    const byCode = (await auth(request(app.getHttpServer()).get(`/v1/admin/sales?q=${chain[3].referralCode}`)).expect(200)).body;
    expect(byCode.items).toHaveLength(1);
    expect(byCode.items[0].id).toBe(s2.id);

    // Filter by amount range minCents=10m: only s2.
    const byAmt = (await auth(request(app.getHttpServer()).get('/v1/admin/sales?minCents=10000000')).expect(200)).body;
    expect(byAmt.items.map((x: { id: string }) => x.id).sort()).toEqual([s2.id].sort());

    // Bulk approve both.
    const bulk = (await auth(request(app.getHttpServer()).post('/v1/admin/sales/bulk')).send({ action: 'approve', ids: [s1.id, s2.id] }).expect(200)).body;
    expect(bulk.succeeded).toBe(2);
    expect(bulk.failed).toHaveLength(0);

    // Detail includes commission ledger rows.
    const detail = (await auth(request(app.getHttpServer()).get(`/v1/admin/sales/${s2.id}`)).expect(200)).body;
    expect(detail.status).toBe('approved');
    expect(detail.ledger.length).toBeGreaterThan(0);
    expect(detail.ledger[0]).toHaveProperty('beneficiaryName');

    // Import preview writes nothing.
    const before = await prisma.sale.count({ where: { tenantId: tenant.id } });
    const csv = `seller,amount\n${chain[2].referralCode},10000.00\nNOPE,abc`;
    const prev = (await auth(request(app.getHttpServer()).post('/v1/admin/sales/import'))
      .send({ csv, mapping: { code: 'seller', amount: 'amount' }, preview: true }).expect(200)).body;
    expect(prev.preview).toBe(true);
    expect(prev.currency).toBe('USD');
    expect(prev.okCount).toBe(1);
    expect(prev.errorCount).toBe(1);
    expect(await prisma.sale.count({ where: { tenantId: tenant.id } })).toBe(before);

    // Real import creates one sale.
    const imp = (await auth(request(app.getHttpServer()).post('/v1/admin/sales/import'))
      .send({ csv, mapping: { code: 'seller', amount: 'amount' } }).expect(200)).body;
    expect(imp.created).toBe(1);
    expect(imp.errors).toHaveLength(1);
  });
});
