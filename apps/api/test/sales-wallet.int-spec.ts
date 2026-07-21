import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MembershipStatus, Role, SaleStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { defaultPermissionsForTier } from '../src/common/permissions';
import { EngineService, SaleMutationTransaction } from '../src/engine/engine.service';
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
  let engine: EngineService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    salesService = moduleRef.get(SalesService);
    engine = moduleRef.get(EngineService);
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

  it('previews a selected scope and confirms only its eligible sales after canonical ID normalization', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 125_000n,
        currency: 'USD',
        saleDate: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
    const approved = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 900_000n,
        currency: 'USD',
        saleDate: new Date('2026-07-02T00:00:00.000Z'),
        status: SaleStatus.approved,
      },
    });

    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope: { mode: 'selected', ids: [approved.id, sale.id] } })
      .expect(200);

    expect(preview.body).toMatchObject({
      action: 'approve',
      eligibleCount: 1,
      excludedCount: 1,
      totals: [{ currency: 'USD', amountCents: '125000' }],
    });
    expect(preview.body.previewToken).toEqual(expect.any(String));
    expect(Object.keys(preview.body).sort()).toEqual([
      'action',
      'eligibleCount',
      'excludedCount',
      'expiresAt',
      'previewToken',
      'totals',
    ]);

    const confirmed = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-selected-0001')
      .send({
        scope: { mode: 'selected', ids: [sale.id, approved.id, sale.id] },
        previewToken: preview.body.previewToken,
      })
      .expect(200);

    expect(confirmed.body).toEqual({
      action: 'approve',
      succeeded: 1,
      succeededIds: [sale.id],
      failed: [{
        id: approved.id,
        code: 'not_eligible',
        message: 'sale was excluded by the reviewed eligibility rules',
      }],
      retryScope: { mode: 'selected', ids: [approved.id] },
    });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(SaleStatus.approved);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: approved.id } })).status).toBe(SaleStatus.approved);
  });

  it('rejects invalid bulk contracts and missing idempotency without mutating sales', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    const previewRequest = (body: object) => request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send(body);

    await previewRequest({ action: 'approve' }).expect(400);
    await previewRequest({ action: 'approve', scope: { mode: 'selected', ids: [] } }).expect(400);
    await previewRequest({ action: 'approve', scope: { mode: 'selected', ids: Array(201).fill(sale.id) } }).expect(400);
    await previewRequest({ action: 'approve', scope: { mode: 'all-results', filters: { status: 'pending' } } }).expect(400);
    await previewRequest({
      action: 'approve',
      scope: { mode: 'all-results', filters: { from: '2026-08-02', to: '2026-08-01' } },
    }).expect(400);
    await previewRequest({
      action: 'approve',
      scope: { mode: 'all-results', filters: { minCents: 200, maxCents: 100 } },
    }).expect(400);
    await previewRequest({
      action: 'approve',
      scope: { mode: 'all-results', filters: { maxCents: Number.MAX_SAFE_INTEGER + 1 } },
    }).expect(400);

    const preview = await previewRequest({
      action: 'approve',
      scope: { mode: 'selected', ids: [sale.id] },
    }).expect(200);
    const confirmation = {
      scope: { mode: 'selected', ids: [sale.id] },
      previewToken: preview.body.previewToken,
    };
    await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .send(confirmation)
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'too-short')
      .send(confirmation)
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-old-bypass-01')
      .send({ action: 'approve', ids: [sale.id] })
      .expect(400);

    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(SaleStatus.draft);
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: sale.id } })).toBe(0);
  });

  it('confirms a zero-eligible selected review as a bounded no-op', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const reviewed = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 100_000n,
        saleDate: new Date(),
        status: SaleStatus.approved,
      },
    });
    const outside = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 200_000n, saleDate: new Date() },
    });
    const scope = { mode: 'selected' as const, ids: [reviewed.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);
    expect(preview.body).toMatchObject({ eligibleCount: 0, excludedCount: 1, totals: [] });

    const result = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-zero-eligible-01')
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(200);
    expect(result.body).toEqual({
      action: 'approve',
      succeeded: 0,
      succeededIds: [],
      failed: [{
        id: reviewed.id,
        code: 'not_eligible',
        message: 'sale was excluded by the reviewed eligibility rules',
      }],
      retryScope: { mode: 'selected', ids: [reviewed.id] },
    });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: outside.id } })).status).toBe(SaleStatus.draft);
  });

  it('rejects a mixed local and foreign selected scope without leaking or writing', async () => {
    const localTenant = await createTenant(prisma);
    await createPlan(prisma, localTenant.id);
    const [owner, localSeller] = await createChain(prisma, localTenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: localTenant.id, role: Role.tenant_owner });
    const localSale = await prisma.sale.create({
      data: { tenantId: localTenant.id, sellerMembershipId: localSeller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    const foreignTenant = await createTenant(prisma);
    await createPlan(prisma, foreignTenant.id);
    const [foreignSeller] = await createChain(prisma, foreignTenant.id, 1);
    const foreignSale = await prisma.sale.create({
      data: { tenantId: foreignTenant.id, sellerMembershipId: foreignSeller.id, amountCents: 100_000n, saleDate: new Date() },
    });

    const response = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope: { mode: 'selected', ids: [localSale.id, foreignSale.id] } })
      .expect(404);
    expect(response.body.message).toBe('sale was not found in this business');
    expect(response.body).not.toHaveProperty('previewToken');
    expect(await prisma.sale.count({ where: { id: { in: [localSale.id, foreignSale.id] }, status: SaleStatus.draft } })).toBe(2);
    expect(await prisma.ledgerEntry.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('reviews all filtered results without pagination narrowing and keeps currency totals separate', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const shared = {
      tenantId: tenant.id,
      sellerMembershipId: seller.id,
      saleDate: new Date('2026-07-03T00:00:00.000Z'),
    };
    const usd = await prisma.sale.create({
      data: { ...shared, amountCents: 100_000n, currency: 'USD', customerRef: 'Bulk Target Alpha' },
    });
    const eur = await prisma.sale.create({
      data: { ...shared, amountCents: 200_000n, currency: 'EUR', customerRef: 'Bulk Target Beta' },
    });
    const outside = await prisma.sale.create({
      data: { ...shared, amountCents: 300_000n, currency: 'USD', customerRef: 'Outside Scope' },
    });
    const previewScope = {
      mode: 'all-results' as const,
      filters: {
        q: '  BULK TARGET  ',
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-04T00:00:00.000Z',
        minCents: 50_000,
        maxCents: 250_000,
        page: 1,
        pageSize: 1,
      },
    };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope: previewScope })
      .expect(200);
    expect(preview.body).toMatchObject({
      eligibleCount: 2,
      excludedCount: 0,
      totals: [
        { currency: 'EUR', amountCents: '200000' },
        { currency: 'USD', amountCents: '100000' },
      ],
    });

    const confirmScope = {
      ...previewScope,
      filters: { ...previewScope.filters, q: 'bulk target', page: 99, pageSize: 100 },
    };
    const confirmed = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-all-results-0001')
      .send({ scope: confirmScope, previewToken: preview.body.previewToken })
      .expect(200);
    expect(confirmed.body.succeeded).toBe(2);
    expect(confirmed.body.succeededIds.sort()).toEqual([eur.id, usd.id].sort());
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: outside.id } })).status).toBe(SaleStatus.draft);
  });

  it('requires narrower filters when an all-results bulk scope exceeds 200 sales', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    await prisma.sale.createMany({
      data: Array.from({ length: 201 }, (_, index) => ({
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 100_000n + BigInt(index),
        saleDate: new Date('2026-07-01T00:00:00.000Z'),
        customerRef: 'Too Broad',
      })),
    });

    const response = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope: { mode: 'all-results', filters: { q: 'Too Broad' } } })
      .expect(400);
    expect(response.body.message).toContain('narrow the filters');
    expect(await prisma.sale.count({ where: { tenantId: tenant.id, status: SaleStatus.draft } })).toBe(201);
  });

  it('rejects tampered, expired, wrong-actor, and wrong-tenant preview tokens without writes', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    const [otherAdmin] = await createChain(prisma, tenant.id, 1);
    await setRole(owner.id, Role.tenant_owner);
    await setRole(otherAdmin.id, Role.tenant_admin);
    const ownerToken = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const otherActorToken = tokenFor({
      userId: otherAdmin.userId,
      membershipId: otherAdmin.id,
      tenantId: tenant.id,
      role: Role.tenant_admin,
    });
    const sale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    const scope = { mode: 'selected' as const, ids: [sale.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'approve', scope })
      .expect(200);
    const confirm = (accessToken: string, previewToken: string, key: string) => request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', key)
      .send({ scope, previewToken });
    const last = preview.body.previewToken.slice(-1);
    const tampered = `${preview.body.previewToken.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    const tamperedResponse = await confirm(ownerToken, tampered, 'sales-bulk-token-tamper-01').expect(400);
    expect(tamperedResponse.body.message).toBe('invalid sales bulk preview token');
    const paddedResponse = await confirm(ownerToken, `${preview.body.previewToken}=`, 'sales-bulk-token-padded-001').expect(400);
    expect(paddedResponse.body.message).toBe('invalid sales bulk preview token');
    await confirm(ownerToken, 'a'.repeat(4097), 'sales-bulk-token-overlong-01').expect(400);
    const actorResponse = await confirm(otherActorToken, preview.body.previewToken, 'sales-bulk-token-actor-001').expect(400);
    expect(actorResponse.body.message).toBe('invalid sales bulk preview token');

    const otherTenant = await createTenant(prisma);
    const [otherTenantAdmin] = await createChain(prisma, otherTenant.id, 1);
    await setRole(otherTenantAdmin.id, Role.tenant_owner);
    const otherTenantToken = tokenFor({
      userId: otherTenantAdmin.userId,
      membershipId: otherTenantAdmin.id,
      tenantId: otherTenant.id,
      role: Role.tenant_owner,
    });
    const tenantResponse = await confirm(otherTenantToken, preview.body.previewToken, 'sales-bulk-token-tenant-01').expect(400);
    expect(tenantResponse.body.message).toBe('invalid sales bulk preview token');

    const now = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now + (5 * 60 * 1000) + 1);
    try {
      const expiredResponse = await confirm(ownerToken, preview.body.previewToken, 'sales-bulk-token-expired-1').expect(400);
      expect(expiredResponse.body.message).toBe('invalid sales bulk preview token');
    } finally {
      nowSpy.mockRestore();
    }

    await request(app.getHttpServer())
      .get('/v1/admin/sales')
      .set('Authorization', `Bearer ${preview.body.previewToken}`)
      .expect(401);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(SaleStatus.draft);
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: sale.id } })).toBe(0);
  });

  it('returns a fresh review on selected scope mismatch and performs no mutation', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const first = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    const second = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 200_000n, saleDate: new Date() },
    });
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope: { mode: 'selected', ids: [first.id] } })
      .expect(200);

    const mismatch = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-scope-mismatch-1')
      .send({
        scope: { mode: 'selected', ids: [second.id] },
        previewToken: preview.body.previewToken,
      })
      .expect(409);
    expect(mismatch.body).toMatchObject({
      message: 'review_required',
      code: 'review_required',
      preview: { action: 'approve', eligibleCount: 1, totals: [{ currency: 'USD', amountCents: '200000' }] },
    });
    expect(await prisma.sale.count({ where: { id: { in: [first.id, second.id] }, status: SaleStatus.draft } })).toBe(2);
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('detects matching inserts and amount or currency drift inside all-results confirmation', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const first = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 100_000n,
        currency: 'USD',
        customerRef: 'Drift Match',
        saleDate: new Date(),
      },
    });
    const scope = { mode: 'all-results' as const, filters: { q: 'Drift Match' } };
    const initial = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);
    const inserted = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 200_000n,
        currency: 'USD',
        customerRef: 'Drift Match Two',
        saleDate: new Date(),
      },
    });
    const insertDrift = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-insert-drift-01')
      .send({ scope, previewToken: initial.body.previewToken })
      .expect(409);
    expect(insertDrift.body.preview).toMatchObject({ eligibleCount: 2, excludedCount: 0 });

    await prisma.sale.update({ where: { id: first.id }, data: { amountCents: 150_000n, currency: 'EUR' } });
    const valueDrift = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-value-drift-001')
      .send({ scope, previewToken: insertDrift.body.preview.previewToken })
      .expect(409);
    expect(valueDrift.body.preview.totals).toEqual([
      { currency: 'EUR', amountCents: '150000' },
      { currency: 'USD', amountCents: '200000' },
    ]);
    expect(await prisma.sale.count({ where: { id: { in: [first.id, inserted.id] }, status: SaleStatus.draft } })).toBe(2);
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('detects a same-count and same-total all-results selection swap', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const selected = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 100_000n,
        customerRef: 'Selection Swap Target',
        saleDate: new Date(),
      },
    });
    const replacement = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 100_000n,
        customerRef: 'Outside Before Swap',
        saleDate: new Date(),
      },
    });
    const scope = { mode: 'all-results' as const, filters: { q: 'Selection Swap Target' } };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);
    await prisma.$transaction([
      prisma.sale.update({ where: { id: selected.id }, data: { customerRef: 'Outside After Swap' } }),
      prisma.sale.update({ where: { id: replacement.id }, data: { customerRef: 'Selection Swap Target' } }),
    ]);

    const response = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-selection-swap-1')
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(409);
    expect(response.body.preview).toMatchObject({
      eligibleCount: 1,
      excludedCount: 0,
      totals: [{ currency: 'USD', amountCents: '100000' }],
    });
    expect(await prisma.sale.count({ where: { id: { in: [selected.id, replacement.id] }, status: SaleStatus.draft } })).toBe(2);
  });

  it('requires a fresh approval review when the effective plan version changes', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 100_000n,
        saleDate: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
    const scope = { mode: 'selected' as const, ids: [sale.id] };
    const initial = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);

    await createPlan(prisma, tenant.id, {
      name: 'Replacement plan',
      effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
      rates: [600, 300],
    });
    const planDrift = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-plan-replaced-01')
      .send({ scope, previewToken: initial.body.previewToken })
      .expect(409);
    expect(planDrift.body).toMatchObject({
      message: 'review_required',
      code: 'review_required',
      preview: { action: 'approve', eligibleCount: 1 },
    });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(SaleStatus.draft);
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: sale.id } })).toBe(0);

    await createPlan(prisma, tenant.id, {
      name: 'Replacement plan with adjusted levels',
      effectiveFrom: new Date('2026-06-02T00:00:00.000Z'),
      rates: [599, 301],
    });
    const levelDrift = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-plan-level-drift-1')
      .send({ scope, previewToken: planDrift.body.preview.previewToken })
      .expect(409);
    expect(levelDrift.body).toMatchObject({
      message: 'review_required',
      code: 'review_required',
      preview: { action: 'approve', eligibleCount: 1 },
    });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(SaleStatus.draft);
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: sale.id } })).toBe(0);
  });

  it('requires a fresh approval review when commission ledger state appears after preview', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    const scope = { mode: 'selected' as const, ids: [sale.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);
    const injected = await prisma.ledgerEntry.create({
      data: {
        tenantId: tenant.id,
        saleId: sale.id,
        beneficiaryMembershipId: seller.id,
        level: 0,
        rateBpsUsed: 1,
        amountCents: 1n,
        type: 'commission',
        status: 'pending',
      },
    });

    const response = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-ledger-insert-01')
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(409);
    expect(response.body).toMatchObject({ message: 'review_required', code: 'review_required' });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(SaleStatus.draft);
    expect(await prisma.ledgerEntry.findMany({ where: { saleId: sale.id }, select: { id: true } })).toEqual([
      { id: injected.id },
    ]);
    expect(await prisma.auditLog.count({ where: { entityId: sale.id } })).toBe(0);
    expect(await prisma.monthlySummary.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { tenantId: tenant.id } })).toBe(0);
  });

  it('requires a fresh void review when only a commission beneficiary changes', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller, alternateBeneficiary] = await createChain(prisma, tenant.id, 3);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    await salesService.approve({ userId: owner.userId, tenantId: tenant.id }, sale.id);
    const scope = { mode: 'selected' as const, ids: [sale.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'void', scope })
      .expect(200);
    const changed = await prisma.ledgerEntry.findFirstOrThrow({
      where: { saleId: sale.id, type: 'commission' },
      orderBy: { level: 'asc' },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE ledger_entries DISABLE TRIGGER trg_guard_ledger_update');
      try {
        await tx.$executeRaw`
          UPDATE ledger_entries
          SET beneficiary_membership_id = ${alternateBeneficiary.id}::uuid
          WHERE id = ${changed.id}::uuid`;
      } finally {
        await tx.$executeRawUnsafe('ALTER TABLE ledger_entries ENABLE TRIGGER trg_guard_ledger_update');
      }
    });
    const [trigger] = await prisma.$queryRaw<Array<{ enabled: string }>>`
      SELECT tgenabled AS enabled
      FROM pg_trigger
      WHERE tgrelid = 'ledger_entries'::regclass
        AND tgname = 'trg_guard_ledger_update'`;
    expect(trigger.enabled).toBe('O');
    const summariesBefore = await prisma.monthlySummary.findMany({
      where: { tenantId: tenant.id },
      orderBy: { id: 'asc' },
    });
    const auditCountBefore = await prisma.auditLog.count({ where: { entityId: sale.id } });

    const response = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-beneficiary-drift')
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(409);
    expect(response.body).toMatchObject({ message: 'review_required', code: 'review_required' });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(SaleStatus.approved);
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id, type: 'reversal' } })).toBe(0);
    expect(await prisma.monthlySummary.findMany({ where: { tenantId: tenant.id }, orderBy: { id: 'asc' } })).toEqual(
      summariesBefore,
    );
    expect(await prisma.auditLog.count({ where: { entityId: sale.id } })).toBe(auditCountBefore);
  });

  it('enforces live bulk permissions for a restricted admin at preview and confirmation', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [admin, seller] = await createChain(prisma, tenant.id, 2);
    const approveOnlyRole = await prisma.tenantRole.create({
      data: {
        tenantId: tenant.id,
        key: 'bulk-approve-only',
        name: 'Bulk approve only',
        permissions: ['sales.approve'],
      },
    });
    await prisma.membership.update({
      where: { id: admin.id },
      data: { role: Role.tenant_admin, roleId: approveOnlyRole.id },
    });
    const tok = tokenFor({ userId: admin.userId, membershipId: admin.id, tenantId: tenant.id, role: Role.tenant_admin });
    const sale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    const scope = { mode: 'selected' as const, ids: [sale.id] };

    await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'void', scope })
      .expect(403);
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);

    await prisma.tenantRole.update({ where: { id: approveOnlyRole.id }, data: { permissions: [] } });
    await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-permission-revoke')
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(403);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(SaleStatus.draft);
    expect(await prisma.ledgerEntry.count({ where: { saleId: sale.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: sale.id } })).toBe(0);
  });

  it('excludes actor-created approvals when maker-checker is required', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { requireSeparateApprover: true } });
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const actorCreated = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 100_000n,
        saleDate: new Date(),
        createdBy: owner.userId,
      },
    });
    const independentlyCreated = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 200_000n, saleDate: new Date() },
    });
    const scope = { mode: 'selected' as const, ids: [actorCreated.id, independentlyCreated.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);
    expect(preview.body).toMatchObject({
      eligibleCount: 1,
      excludedCount: 1,
      totals: [{ currency: 'USD', amountCents: '200000' }],
    });
    await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-maker-checker-01')
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(200);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: actorCreated.id } })).status).toBe(SaleStatus.draft);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: independentlyCreated.id } })).status).toBe(SaleStatus.approved);
  });

  it('excludes a void candidate with processing commission ledger rows', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const processingSale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    await salesService.approve({ userId: owner.userId, tenantId: tenant.id }, processingSale.id);
    const commission = await prisma.ledgerEntry.findFirstOrThrow({ where: { saleId: processingSale.id } });
    await prisma.ledgerEntry.update({ where: { id: commission.id }, data: { status: 'processing' } });
    const eligibleDraft = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 200_000n, saleDate: new Date() },
    });
    const scope = { mode: 'selected' as const, ids: [processingSale.id, eligibleDraft.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'void', scope })
      .expect(200);
    expect(preview.body).toMatchObject({
      action: 'void',
      eligibleCount: 1,
      excludedCount: 1,
      totals: [{ currency: 'USD', amountCents: '200000' }],
    });
    await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-processing-void-1')
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(200);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: processingSale.id } })).status).toBe(SaleStatus.approved);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: eligibleDraft.id } })).status).toBe(SaleStatus.void);
  });

  it('durably replays a canonical-equivalent bulk request without duplicating financial effects', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const first = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    const second = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 200_000n, saleDate: new Date() },
    });
    const previewScope = { mode: 'selected' as const, ids: [first.id, second.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope: previewScope })
      .expect(200);
    const key = 'sales-bulk-durable-replay-0001';
    const execute = (scope: typeof previewScope) => request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', key)
      .send({ scope, previewToken: preview.body.previewToken });

    const initial = await execute({ mode: 'selected', ids: [second.id, first.id, second.id] }).expect(200);
    const effectsAfterInitial = {
      ledger: await prisma.ledgerEntry.count({ where: { saleId: { in: [first.id, second.id] } } }),
      audit: await prisma.auditLog.count({ where: { entityId: { in: [first.id, second.id] } } }),
      notifications: await prisma.notification.count({ where: { tenantId: tenant.id } }),
    };
    const replay = await execute({ mode: 'selected', ids: [first.id, second.id] }).expect(200);

    expect(replay.body).toEqual(initial.body);
    expect({
      ledger: await prisma.ledgerEntry.count({ where: { saleId: { in: [first.id, second.id] } } }),
      audit: await prisma.auditLog.count({ where: { entityId: { in: [first.id, second.id] } } }),
      notifications: await prisma.notification.count({ where: { tenantId: tenant.id } }),
    }).toEqual(effectsAfterInitial);
    const executions = await prisma.$queryRaw<Array<{
      status: string;
      response: unknown;
      idempotencyKeyHash: string;
      requestHash: string;
    }>>`
      SELECT status,
             response,
             idempotency_key_hash AS "idempotencyKeyHash",
             request_hash AS "requestHash"
      FROM bulk_action_executions
      WHERE tenant_id = ${tenant.id}::uuid
        AND actor_user_id = ${owner.userId}::uuid`;
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({ status: 'completed', response: initial.body });
    expect(executions[0].idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(executions[0].requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(executions[0])).not.toContain(key);
    expect(JSON.parse(JSON.stringify(executions[0].response))).toEqual(initial.body);
  });

  it('serializes concurrent confirmations with the same key into one execution and one effect', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    const scope = { mode: 'selected' as const, ids: [sale.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);
    const confirm = () => request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-concurrent-replay-01')
      .send({ scope, previewToken: preview.body.previewToken });

    const [first, second] = await Promise.all([confirm(), confirm()]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body).toEqual(first.body);
    expect(await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM bulk_action_executions`).toEqual([{ count: 1n }]);
    expect(await prisma.auditLog.count({ where: { action: 'sale.approve', entityId: sale.id } })).toBe(1);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(SaleStatus.approved);
  });

  it('conflicts changed requests while isolating the same raw key across actors and tenants', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, secondAdmin, seller] = await createChain(prisma, tenant.id, 3);
    await setRole(owner.id, Role.tenant_owner);
    await setRole(secondAdmin.id, Role.tenant_admin);
    const ownerToken = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const secondToken = tokenFor({
      userId: secondAdmin.userId,
      membershipId: secondAdmin.id,
      tenantId: tenant.id,
      role: Role.tenant_admin,
    });
    const ownerSale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    const secondSale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 200_000n, saleDate: new Date() },
    });
    const previewFor = async (accessToken: string, saleId: string) => (await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ action: 'approve', scope: { mode: 'selected', ids: [saleId] } })
      .expect(200)).body;
    const ownerPreview = await previewFor(ownerToken, ownerSale.id);
    const ownerChangedPreview = await previewFor(ownerToken, secondSale.id);
    const secondPreview = await previewFor(secondToken, secondSale.id);
    const sharedKey = 'sales-bulk-shared-actor-key-01';
    const confirmFor = (accessToken: string, saleId: string, previewToken: string) => request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', sharedKey)
      .send({ scope: { mode: 'selected', ids: [saleId] }, previewToken });

    await confirmFor(ownerToken, ownerSale.id, ownerPreview.previewToken).expect(200);
    const changed = await confirmFor(ownerToken, secondSale.id, ownerChangedPreview.previewToken).expect(409);
    expect(changed.body).toMatchObject({
      message: 'idempotency_key_conflict',
      code: 'idempotency_key_conflict',
    });
    await confirmFor(secondToken, secondSale.id, secondPreview.previewToken).expect(200);

    const otherTenant = await createTenant(prisma);
    await createPlan(prisma, otherTenant.id);
    const [otherOwner, otherSeller] = await createChain(prisma, otherTenant.id, 2);
    await setRole(otherOwner.id, Role.tenant_owner);
    const otherToken = tokenFor({
      userId: otherOwner.userId,
      membershipId: otherOwner.id,
      tenantId: otherTenant.id,
      role: Role.tenant_owner,
    });
    const otherSale = await prisma.sale.create({
      data: { tenantId: otherTenant.id, sellerMembershipId: otherSeller.id, amountCents: 300_000n, saleDate: new Date() },
    });
    const otherPreview = await previewFor(otherToken, otherSale.id);
    await confirmFor(otherToken, otherSale.id, otherPreview.previewToken).expect(200);

    const executions = await prisma.$queryRaw<Array<{
      tenantId: string;
      actorUserId: string;
      idempotencyKeyHash: string;
    }>>`
      SELECT tenant_id AS "tenantId",
             actor_user_id AS "actorUserId",
             idempotency_key_hash AS "idempotencyKeyHash"
      FROM bulk_action_executions
      ORDER BY tenant_id, actor_user_id`;
    expect(executions).toHaveLength(3);
    expect(new Set(executions.map((row) => row.idempotencyKeyHash)).size).toBe(1);
    expect(new Set(executions.map((row) => `${row.tenantId}:${row.actorUserId}`)).size).toBe(3);
    expect(JSON.stringify(executions)).not.toContain(sharedKey);
  });

  it('replays a completed execution after preview expiry but rejects an expired first execution', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const completedSale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    const expiredFirstSale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 200_000n, saleDate: new Date() },
    });
    const previewFor = async (saleId: string) => (await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope: { mode: 'selected', ids: [saleId] } })
      .expect(200)).body;
    const completedPreview = await previewFor(completedSale.id);
    const unusedPreview = await previewFor(expiredFirstSale.id);
    const completedScope = { mode: 'selected' as const, ids: [completedSale.id] };
    const initial = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-expiry-completed-01')
      .send({ scope: completedScope, previewToken: completedPreview.previewToken })
      .expect(200);

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + (5 * 60 * 1000) + 1);
    try {
      const replay = await request(app.getHttpServer())
        .post('/v1/admin/sales/bulk')
        .set('Authorization', `Bearer ${tok}`)
        .set('Idempotency-Key', 'sales-bulk-expiry-completed-01')
        .send({ scope: completedScope, previewToken: completedPreview.previewToken })
        .expect(200);
      expect(replay.body).toEqual(initial.body);
      const expired = await request(app.getHttpServer())
        .post('/v1/admin/sales/bulk')
        .set('Authorization', `Bearer ${tok}`)
        .set('Idempotency-Key', 'sales-bulk-expiry-first-new-01')
        .send({ scope: { mode: 'selected', ids: [expiredFirstSale.id] }, previewToken: unusedPreview.previewToken })
        .expect(400);
      expect(expired.body.message).toBe('invalid sales bulk preview token');
    } finally {
      nowSpy.mockRestore();
    }
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: expiredFirstSale.id } })).status).toBe(SaleStatus.draft);
    expect(await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM bulk_action_executions`).toEqual([{ count: 1n }]);
  });

  it('does not persist invalid or drifted execution attempts', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sale = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 100_000n, saleDate: new Date() },
    });
    const scope = { mode: 'selected' as const, ids: [sale.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);
    const last = preview.body.previewToken.slice(-1);
    const tampered = `${preview.body.previewToken.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-invalid-no-record-1')
      .send({ scope, previewToken: tampered })
      .expect(400);
    await prisma.sale.update({ where: { id: sale.id }, data: { amountCents: 101_000n } });
    const drift = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-drift-no-record-001')
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(409);
    expect(drift.body).toMatchObject({ message: 'review_required', code: 'review_required' });
    expect(await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM bulk_action_executions`).toEqual([{ count: 0n }]);
  });

  it('fails closed for a committed processing execution or malformed completed response', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const excluded = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 100_000n,
        status: SaleStatus.approved,
        saleDate: new Date(),
      },
    });
    const unrelated = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 200_000n, saleDate: new Date() },
    });
    const scope = { mode: 'selected' as const, ids: [excluded.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);
    const key = 'sales-bulk-recovery-required-1';
    const confirm = () => request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', key)
      .send({ scope, previewToken: preview.body.previewToken });
    await confirm().expect(200);
    const [execution] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bulk_action_executions`;
    await prisma.$executeRaw`
      UPDATE bulk_action_executions
      SET status = 'processing', response = NULL
      WHERE id = ${execution.id}::uuid`;
    const processing = await confirm().expect(409);
    expect(processing.body).toMatchObject({
      message: 'execution_recovery_required',
      code: 'execution_recovery_required',
    });
    await prisma.$executeRaw`
      UPDATE bulk_action_executions
      SET status = 'completed', response = ${JSON.stringify({ unexpected: true })}::jsonb
      WHERE id = ${execution.id}::uuid`;
    const malformed = await confirm().expect(409);
    expect(malformed.body).toMatchObject({
      message: 'execution_recovery_required',
      code: 'execution_recovery_required',
    });
    await prisma.$executeRaw`
      UPDATE bulk_action_executions
      SET status = 'completed', response = ${JSON.stringify({
        action: 'approve',
        succeeded: 0,
        succeededIds: [],
        failed: [],
      })}::jsonb
      WHERE id = ${execution.id}::uuid`;
    const wrongCounts = await confirm().expect(409);
    expect(wrongCounts.body).toMatchObject({
      message: 'execution_recovery_required',
      code: 'execution_recovery_required',
    });
    await prisma.$executeRaw`
      UPDATE bulk_action_executions
      SET status = 'completed', response = ${JSON.stringify({
        action: 'approve',
        succeeded: 0,
        succeededIds: [],
        failed: [{
          id: unrelated.id,
          code: 'not_eligible',
          message: 'sale was excluded by the reviewed eligibility rules',
        }],
        retryScope: { mode: 'selected', ids: [unrelated.id] },
      })}::jsonb
      WHERE id = ${execution.id}::uuid`;
    const unrelatedIds = await confirm().expect(409);
    expect(unrelatedIds.body).toMatchObject({
      message: 'execution_recovery_required',
      code: 'execution_recovery_required',
    });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: excluded.id } })).status).toBe(SaleStatus.approved);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: unrelated.id } })).status).toBe(SaleStatus.draft);
  });

  it('returns deterministic excluded failures and requires a new preview and key for their retry', async () => {
    const tenant = await createTenant(prisma);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { requireSeparateApprover: true } });
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const excluded = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 100_000n,
        saleDate: new Date(),
        createdBy: owner.userId,
      },
    });
    const eligible = await prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents: 200_000n, saleDate: new Date() },
    });
    const scope = { mode: 'selected' as const, ids: [excluded.id, eligible.id] };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);
    const originalKey = 'sales-bulk-partial-retry-old-01';
    const initial = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', originalKey)
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(200);
    expect(initial.body.failed).toEqual([{
      id: excluded.id,
      code: 'not_eligible',
      message: 'sale was excluded by the reviewed eligibility rules',
    }]);
    expect(initial.body.retryScope).toEqual({ mode: 'selected', ids: [excluded.id] });

    await prisma.tenant.update({ where: { id: tenant.id }, data: { requireSeparateApprover: false } });
    const retryScope = { mode: 'selected' as const, ids: [excluded.id] };
    const retryPreview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope: retryScope })
      .expect(200);
    const oldKey = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', originalKey)
      .send({ scope: retryScope, previewToken: retryPreview.body.previewToken })
      .expect(409);
    expect(oldKey.body).toMatchObject({ message: 'idempotency_key_conflict', code: 'idempotency_key_conflict' });
    await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-partial-retry-new-01')
      .send({ scope: retryScope, previewToken: retryPreview.body.previewToken })
      .expect(200);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: excluded.id } })).status).toBe(SaleStatus.approved);
  });

  it('detects an all-results swap that changes only the excluded sale identity', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const eligible = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 100_000n,
        customerRef: 'Excluded Identity Group',
        saleDate: new Date(),
      },
    });
    const reviewedExcluded = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 200_000n,
        customerRef: 'Excluded Identity Group',
        status: SaleStatus.approved,
        saleDate: new Date(),
      },
    });
    const replacementExcluded = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        sellerMembershipId: seller.id,
        amountCents: 200_000n,
        customerRef: 'Outside Excluded Group',
        status: SaleStatus.approved,
        saleDate: new Date(),
      },
    });
    const scope = { mode: 'all-results' as const, filters: { q: 'Excluded Identity Group' } };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);
    expect(preview.body).toMatchObject({ eligibleCount: 1, excludedCount: 1 });
    await prisma.$transaction([
      prisma.sale.update({ where: { id: reviewedExcluded.id }, data: { customerRef: 'Outside After Review' } }),
      prisma.sale.update({ where: { id: replacementExcluded.id }, data: { customerRef: 'Excluded Identity Group' } }),
    ]);
    const drift = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', 'sales-bulk-excluded-swap-0001')
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(409);
    expect(drift.body).toMatchObject({
      message: 'review_required',
      code: 'review_required',
      preview: { eligibleCount: 1, excludedCount: 1 },
    });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: eligible.id } })).status).toBe(SaleStatus.draft);
    expect(await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM bulk_action_executions`).toEqual([{ count: 0n }]);
  });

  it('rolls back the first mutation and execution when a later engine mutation fails', async () => {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner, seller] = await createChain(prisma, tenant.id, 2);
    await setRole(owner.id, Role.tenant_owner);
    const tok = tokenFor({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const sales = await Promise.all([100_000n, 200_000n].map((amountCents) => prisma.sale.create({
      data: { tenantId: tenant.id, sellerMembershipId: seller.id, amountCents, saleDate: new Date() },
    })));
    const scope = { mode: 'selected' as const, ids: sales.map((sale) => sale.id) };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/sales/bulk/preview')
      .set('Authorization', `Bearer ${tok}`)
      .send({ action: 'approve', scope })
      .expect(200);
    const originalRun = engine.runSaleMutationTransaction.bind(engine);
    let mutations = 0;
    const runSpy = jest.spyOn(engine, 'runSaleMutationTransaction').mockImplementation(async (tenantId, work) =>
      originalRun(tenantId, (transaction) => {
        const wrapped: SaleMutationTransaction = {
          ...transaction,
          approveSale: async (saleId, actorUserId) => {
            mutations += 1;
            if (mutations === 2) throw new Error('injected second-item engine failure');
            return transaction.approveSale(saleId, actorUserId);
          },
        };
        return work(wrapped);
      }));
    try {
      await request(app.getHttpServer())
        .post('/v1/admin/sales/bulk')
        .set('Authorization', `Bearer ${tok}`)
        .set('Idempotency-Key', 'sales-bulk-rollback-injected-1')
        .send({ scope, previewToken: preview.body.previewToken })
        .expect(500);
    } finally {
      runSpy.mockRestore();
    }
    expect(mutations).toBe(2);
    expect(await prisma.sale.count({ where: { id: { in: sales.map((sale) => sale.id) }, status: SaleStatus.draft } })).toBe(2);
    expect(await prisma.ledgerEntry.count({ where: { saleId: { in: sales.map((sale) => sale.id) } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: { in: sales.map((sale) => sale.id) } } })).toBe(0);
    expect(await prisma.notification.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.monthlySummary.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM bulk_action_executions`).toEqual([{ count: 0n }]);
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

    // Bulk approve both through the reviewed scope contract.
    const bulkScope = { mode: 'selected' as const, ids: [s1.id, s2.id] };
    const bulkPreview = (await auth(request(app.getHttpServer()).post('/v1/admin/sales/bulk/preview'))
      .send({ action: 'approve', scope: bulkScope })
      .expect(200)).body;
    const bulk = (await auth(request(app.getHttpServer()).post('/v1/admin/sales/bulk'))
      .set('Idempotency-Key', 'sales-power-tools-bulk-0001')
      .send({ scope: bulkScope, previewToken: bulkPreview.previewToken })
      .expect(200)).body;
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
