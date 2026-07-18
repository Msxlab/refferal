import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { MaturationRule, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { createChain, createTenant, truncateAll } from './helpers';

describe('admin settings (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let settings: SettingsService;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    settings = moduleRef.get(SettingsService);
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => await app.close());
  beforeEach(async () => await truncateAll(prisma));

  function token(o: { userId: string; membershipId: string; tenantId: string; role: Role }): string {
    const p: AccessTokenPayload = { sub: o.userId, mid: o.membershipId, tid: o.tenantId, role: o.role };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  it('get + patch ayarlar; audit yazilir; staff patch edemez', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_approval });
    const [owner, staff] = await createChain(prisma, tenant.id, 2);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: staff.id }, data: { role: Role.tenant_staff } });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const staffTok = token({ userId: staff.userId, membershipId: staff.id, tenantId: tenant.id, role: Role.tenant_staff });

    const got = await request(app.getHttpServer()).get('/v1/admin/settings').set('Authorization', `Bearer ${ownerTok}`).expect(200);
    expect(got.body.maturationRule).toBe('on_approval');

    // staff okuyabilir ama patch edemez
    await request(app.getHttpServer()).get('/v1/admin/settings').set('Authorization', `Bearer ${staffTok}`).expect(200);
    await request(app.getHttpServer()).patch('/v1/admin/settings').set('Authorization', `Bearer ${staffTok}`).send({ payoutMinCents: 5000 }).expect(403);

    const patched = await request(app.getHttpServer())
      .patch('/v1/admin/settings')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ maturationRule: 'on_delivery', payoutMinCents: 250000, notifyNewMemberName: false })
      .expect(200);
    expect(patched.body.maturationRule).toBe('on_delivery');
    expect(patched.body.payoutMinCents).toBe('250000');
    expect(patched.body.notifyNewMemberName).toBe(false);

    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(t.payoutMinCents).toBe(250000n);

    const audit = await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'tenant.update_settings' } });
    expect(audit).toBe(1);
  });

  it('persists every mutable setting in exact before and after audit snapshots', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_approval });
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        payoutMinCents: 100000n,
        notifyNewMemberName: true,
        compressionEnabled: false,
        inactiveMembersEarn: true,
        requireSeparateApprover: false,
        requireKycForPayout: false,
        requirePayoutApproval: false,
        autoRequestPayouts: true,
        branding: { tagline: 'Before', accentColor: '#222222' },
      },
    });
    const [owner] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    await request(app.getHttpServer())
      .patch('/v1/admin/settings')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({
        maturationRule: 'days_after_approval',
        maturationDays: 14,
        payoutMinCents: 250000,
        timezone: 'Europe/Istanbul',
        notifyNewMemberName: false,
        compressionEnabled: true,
        inactiveMembersEarn: false,
        requireSeparateApprover: true,
        requireKycForPayout: true,
        requirePayoutApproval: true,
        autoRequestPayouts: false,
        branding: { logoText: 'Ledger', primaryColor: '#ABCDEF' },
      })
      .expect(200);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: tenant.id, action: 'tenant.update_settings' },
    });
    expect(audit.before).toEqual({
      maturationRule: 'on_approval',
      maturationDays: null,
      payoutMinCents: '100000',
      timezone: 'America/New_York',
      notifyNewMemberName: true,
      compressionEnabled: false,
      inactiveMembersEarn: true,
      requireSeparateApprover: false,
      requireKycForPayout: false,
      requirePayoutApproval: false,
      autoRequestPayouts: true,
      branding: { tagline: 'Before', accentColor: '#222222' },
    });
    expect(audit.after).toEqual({
      maturationRule: 'days_after_approval',
      maturationDays: 14,
      payoutMinCents: '250000',
      timezone: 'Europe/Istanbul',
      notifyNewMemberName: false,
      compressionEnabled: true,
      inactiveMembersEarn: false,
      requireSeparateApprover: true,
      requireKycForPayout: true,
      requirePayoutApproval: true,
      autoRequestPayouts: false,
      branding: {
        tagline: 'Before',
        accentColor: '#222222',
        logoText: 'Ledger',
        primaryColor: '#ABCDEF',
      },
    });
  });

  it('rolls back the tenant mutation when the database rejects the audit row', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_approval });

    await expect(
      settings.update(
        { tenantId: tenant.id, userId: 'not-a-uuid' },
        { payoutMinCents: 999999n, requireKycForPayout: true, autoRequestPayouts: false },
      ),
    ).rejects.toThrow();

    const persisted = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect({
      payoutMinCents: persisted.payoutMinCents,
      requireKycForPayout: persisted.requireKycForPayout,
      autoRequestPayouts: persisted.autoRequestPayouts,
    }).toEqual({
      payoutMinCents: 100000n,
      requireKycForPayout: false,
      autoRequestPayouts: true,
    });
    await expect(
      prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'tenant.update_settings' } }),
    ).resolves.toBe(0);
  });
});
