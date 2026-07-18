import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

const VALID_ROUTING = '021000021'; // gecerli ABA checksum

/** Dalga 2 #5 — KYC/odeme profili: yasam dongusu + payout kapisi + soguma suresi. */
describe('kyc / payout profile (entegrasyon)', () => {
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
    const payload: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }
  const srv = () => app.getHttpServer();
  const PROFILE = { legalName: 'Jane Doe', country: 'US', taxIdType: 'ssn', taxId: '123456789', routingNumber: VALID_ROUTING, accountType: 'checking', accountNumber: '000123456789' };

  async function setup() {
    const tenant = await createTenant(prisma); // on_approval, payout min 100000
    const [owner, member] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    return {
      tenant,
      owner: token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner }),
      member, memberTok: token({ userId: member.userId, membershipId: member.id, tenantId: tenant.id, role: Role.member }),
    };
  }

  it('profil yalniz son-4 saklar; tam TIN/hesap no donmez', async () => {
    const { memberTok } = await setup();
    const res = await request(srv()).put('/v1/app/payout-profile').set('Authorization', `Bearer ${memberTok}`).send(PROFILE).expect(200);
    expect(res.body.status).toBe('pending_review');
    expect(res.body.taxIdLast4).toBe('6789');
    expect(res.body.accountLast4).toBe('6789');
    expect(JSON.stringify(res.body)).not.toContain('123456789'); // tam TIN sizmaz
    expect(JSON.stringify(res.body)).not.toContain('000123456789'); // tam hesap sizmaz
  });

  it('admin pending kuyrugunu gorur ve verify eder', async () => {
    const { owner, memberTok, member } = await setup();
    await request(srv()).put('/v1/app/payout-profile').set('Authorization', `Bearer ${memberTok}`).send(PROFILE).expect(200);

    const queue = await request(srv()).get('/v1/admin/payout-profiles?status=pending_review').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0].membershipId).toBe(member.id);

    const dec = await request(srv()).post(`/v1/admin/payout-profiles/${member.id}/decide`).set('Authorization', `Bearer ${owner}`).send({ action: 'verify' }).expect(200);
    expect(dec.body.status).toBe('verified');
  });

  it('KYC kapisi: yok→blok, pending→blok, verified+soguma→blok, soguma gecince→acilir', async () => {
    const { tenant, owner, memberTok, member } = await setup();
    await prisma.tenant.update({ where: { id: tenant.id }, data: { requireKycForPayout: true } });
    // odenebilir bakiye (dogrudan adjustment payable)
    await prisma.ledgerEntry.create({
      data: { tenantId: tenant.id, saleId: null, beneficiaryMembershipId: member.id, level: 0, rateBpsUsed: 0, amountCents: 2_000_000n, type: LedgerType.adjustment, status: LedgerStatus.payable, summaryMonth: '2026-06' },
    });

    // profil yok → blok
    await request(srv()).post('/v1/app/payout-requests').set('Authorization', `Bearer ${memberTok}`).expect(400);
    // pending → blok
    await request(srv()).put('/v1/app/payout-profile').set('Authorization', `Bearer ${memberTok}`).send(PROFILE).expect(200);
    await request(srv()).post('/v1/app/payout-requests').set('Authorization', `Bearer ${memberTok}`).expect(400);
    // verify → ama yeni degisti (soguma) → hala blok
    await request(srv()).post(`/v1/admin/payout-profiles/${member.id}/decide`).set('Authorization', `Bearer ${owner}`).send({ action: 'verify' }).expect(200);
    await request(srv()).post('/v1/app/payout-requests').set('Authorization', `Bearer ${memberTok}`).expect(400);
    // soguma penceresini geriye al → talep acilir
    await prisma.payoutProfile.update({ where: { membershipId: member.id }, data: { lastChangedAt: new Date(Date.now() - 10 * 86_400_000) } });
    const ok = await request(srv()).post('/v1/app/payout-requests').set('Authorization', `Bearer ${memberTok}`).expect(200);
    expect(ok.body.status).toBe('requested');
  });

  it('gecersiz ABA routing reddedilir', async () => {
    const { memberTok } = await setup();
    await request(srv()).put('/v1/app/payout-profile').set('Authorization', `Bearer ${memberTok}`).send({ ...PROFILE, routingNumber: '123456789' }).expect(400);
  });
});
