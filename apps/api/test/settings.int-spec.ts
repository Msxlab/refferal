import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { MaturationRule, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { defaultPermissionsForTier } from '../src/common/permissions';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

describe('admin settings (entegrasyon)', () => {
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

  function token(o: { userId: string; membershipId: string; tenantId: string; role: Role; perms?: string[] }): string {
    const p: AccessTokenPayload = {
      sub: o.userId,
      mid: o.membershipId,
      tid: o.tenantId,
      role: o.role,
      perms: o.perms ?? defaultPermissionsForTier(o.role),
    };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  it('get + patch ayarlar; audit yazilir; staff patch edemez', async () => {
    const tenant = await createTenant(prisma, { maturationRule: MaturationRule.on_approval });
    const [owner, staff] = await createChain(prisma, tenant.id, 2);
    const settingsViewer = await prisma.tenantRole.create({
      data: { tenantId: tenant.id, key: 'settings_viewer', name: 'Settings viewer', permissions: ['settings.view'] },
    });
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: staff.id }, data: { role: Role.tenant_staff, roleId: settingsViewer.id } });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const staffTok = token({
      userId: staff.userId,
      membershipId: staff.id,
      tenantId: tenant.id,
      role: Role.tenant_staff,
      perms: ['settings.view'],
    });

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
});
