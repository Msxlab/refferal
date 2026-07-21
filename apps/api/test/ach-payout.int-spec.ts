import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PayoutMethod, PayoutStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { decryptSecret, encryptSecret } from '../src/common/crypto';
import { buildNachaFile } from '../src/payouts/nacha';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

const ROUTING = '021000021';
const BANK_TEST_KEY = 'bank-integration-refearn-encryption-key-0001';
const LEGACY_ACCOUNT = '000111222333';
const LEGACY_ACCOUNT_FIXTURE = 'DAsKCQgHBgUEAwIB.DgGIUJ3JwcMQ1aczkuD5hQ==.Z3XSfNOZq36BK8E3';

/** Dalga 3 — SELF-HOSTED odeme: AES-256-GCM sifreleme + NACHA ACH dosyasi (dis servis YOK). */
describe('self-hosted ACH payout (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const originalEncryptionKey = process.env.REFEARN_ENC_KEY;
  const originalWriteVersion = process.env.REFEARN_SECRET_WRITE_VERSION;

  beforeAll(async () => {
    process.env.REFEARN_ENC_KEY = BANK_TEST_KEY;
    process.env.REFEARN_SECRET_WRITE_VERSION = 'v1';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
  });
  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.REFEARN_ENC_KEY;
      else process.env.REFEARN_ENC_KEY = originalEncryptionKey;
      if (originalWriteVersion === undefined) delete process.env.REFEARN_SECRET_WRITE_VERSION;
      else process.env.REFEARN_SECRET_WRITE_VERSION = originalWriteVersion;
    }
  });
  beforeEach(async () => { await truncateAll(prisma); });

  it('AES-256-GCM gidip-gelir', () => {
    const enc = encryptSecret('000123456789');
    expect(enc).not.toContain('000123456789');
    expect(decryptSecret(enc)).toBe('000123456789');
  });

  it('NACHA dosyasi yapisi: 94 char satir, 10-blok, kontrol toplamlari', () => {
    const file = buildNachaFile(
      [
        { routingNumber: ROUTING, accountNumber: '111111', accountType: 'checking', amountCents: 50000, name: 'Jane Doe', id: 'm1' },
        { routingNumber: ROUTING, accountNumber: '222222', accountType: 'savings', amountCents: 25000, name: 'John Roe', id: 'm2' },
      ],
      { odfiRouting: ROUTING, destRouting: ROUTING, companyId: '1234567890', companyName: 'Acme' },
      new Date('2026-06-13T10:00:00Z'),
    );
    const lines = file.trimEnd().split('\n');
    expect(lines.length % 10).toBe(0);
    expect(lines.every((l) => l.length === 94)).toBe(true);
    expect(lines[0][0]).toBe('1'); // file header
    expect(lines[1][0]).toBe('5'); // batch header
    expect(lines.filter((l) => l[0] === '6')).toHaveLength(2); // 2 entry
    // batch control total credit = 75000
    const batchCtrl = lines.find((l) => l[0] === '8')!;
    expect(batchCtrl).toContain('000000075000');
  });

  it('odenmis payout → ACH dosyasi entry icerir (sifreli hesap decrypt)', async () => {
    const tenant = await createTenant(prisma);
    const [owner, member] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const memTok = jwt.sign({ sub: member.userId, mid: member.id, tid: tenant.id, role: Role.member, authGeneration: 1 } as AccessTokenPayload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
    const ownerTok = jwt.sign({ sub: owner.userId, mid: owner.id, tid: tenant.id, role: Role.tenant_owner, authGeneration: 1 } as AccessTokenPayload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });

    // uye banka profilini girer (tam hesap sifreli saklanir)
    await request(app.getHttpServer()).put('/v1/app/payout-profile').set('Authorization', `Bearer ${memTok}`)
      .send({ legalName: 'Jane Doe', country: 'US', taxIdType: 'ssn', taxId: '123456789', routingNumber: ROUTING, accountType: 'checking', accountNumber: '000987654321' }).expect(200);
    const profile = await prisma.payoutProfile.findUniqueOrThrow({ where: { membershipId: member.id } });
    expect(profile.accountEnc).toMatch(/^v1\./);
    // odenmis payout
    await prisma.payout.create({ data: { tenantId: tenant.id, membershipId: member.id, totalCents: 150000n, method: PayoutMethod.manual, status: PayoutStatus.paid, period: '2026-06', paidAt: new Date() } });

    const res = await request(app.getHttpServer()).get('/v1/admin/payouts/ach.txt').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    const text = res.text;
    expect(text).toContain('JANE DOE');
    expect(text).toContain('000000150000'); // tutar entry/control'de
    const entryLine = text.split('\n').find((l) => l[0] === '6');
    expect(entryLine).toBeTruthy();
    expect(entryLine).toContain('000987654321'); // decrypt edilmis hesap dosyada
  });

  it('ACH endpoint mevcut statik uc-parcali legacy hesap fixture kaydini okumaya devam eder', async () => {
    const tenant = await createTenant(prisma);
    const [owner, member] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const ownerTok = jwt.sign(
      { sub: owner.userId, mid: owner.id, tid: tenant.id, role: Role.tenant_owner, authGeneration: 1 } as AccessTokenPayload,
      { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds },
    );
    expect(LEGACY_ACCOUNT_FIXTURE).not.toMatch(/^v1\./);

    await prisma.payoutProfile.create({
      data: {
        tenantId: tenant.id,
        membershipId: member.id,
        legalName: 'Legacy Member',
        country: 'US',
        taxIdType: 'ssn',
        taxIdLast4: '6789',
        routingNumber: ROUTING,
        accountType: 'checking',
        accountLast4: LEGACY_ACCOUNT.slice(-4),
        accountEnc: LEGACY_ACCOUNT_FIXTURE,
        status: 'verified',
        lastChangedAt: new Date(),
      },
    });
    await prisma.payout.create({
      data: {
        tenantId: tenant.id,
        membershipId: member.id,
        totalCents: 250000n,
        method: PayoutMethod.manual,
        status: PayoutStatus.paid,
        period: '2026-06',
        paidAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get('/v1/admin/payouts/ach.txt')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    const entryLine = res.text.split('\n').find((line: string) => line[0] === '6');
    expect(entryLine).toContain(LEGACY_ACCOUNT);
  });
});
