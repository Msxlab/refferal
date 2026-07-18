import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { MaturationRule, NotificationChannel, NotificationStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { defaultPermissionsForTier } from '../src/common/permissions';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

describe('admin settings (integration)', () => {
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
      authGeneration: 1,
    };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  it('gets and updates settings, writes audit, and rejects staff updates', async () => {
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

  it('allows branding-only admins to update public brand identity', async () => {
    const tenant = await createTenant(prisma);
    const [owner, admin] = await createChain(prisma, tenant.id, 2);
    const brandRole = await prisma.tenantRole.create({
      data: {
        tenantId: tenant.id,
        key: 'brand_manager',
        name: 'Brand manager',
        permissions: ['settings.view', 'settings.branding'],
      },
    });
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: admin.id }, data: { role: Role.tenant_admin, roleId: brandRole.id } });
    const brandTok = token({
      userId: admin.userId,
      membershipId: admin.id,
      tenantId: tenant.id,
      role: Role.tenant_admin,
      perms: ['settings.view', 'settings.branding'],
    });

    const patched = await request(app.getHttpServer())
      .patch('/v1/admin/settings')
      .set('Authorization', `Bearer ${brandTok}`)
      .send({
        name: 'Americana Partners',
        branding: {
          logoText: ' ap ',
          tagline: 'Premium referrals, clean payouts.',
          primaryColor: '#d4af37',
          accentColor: '#5b7cfa',
        },
      })
      .expect(200);

    expect(patched.body.name).toBe('Americana Partners');
    expect(patched.body.branding).toMatchObject({
      logoText: 'AP',
      tagline: 'Premium referrals, clean payouts.',
      primaryColor: '#D4AF37',
      accentColor: '#5B7CFA',
    });

    const saved = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(saved.name).toBe('Americana Partners');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: tenant.id, action: 'tenant.update_settings' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.before).toMatchObject({ name: tenant.name });
    expect(audit.after).toMatchObject({ name: 'Americana Partners' });
  });

  it('rejects business name updates without branding permission', async () => {
    const tenant = await createTenant(prisma);
    const [admin] = await createChain(prisma, tenant.id, 1);
    const viewerRole = await prisma.tenantRole.create({
      data: {
        tenantId: tenant.id,
        key: 'settings_viewer_admin',
        name: 'Settings viewer admin',
        permissions: ['settings.view'],
      },
    });
    await prisma.membership.update({ where: { id: admin.id }, data: { role: Role.tenant_admin, roleId: viewerRole.id } });
    const viewerTok = token({
      userId: admin.userId,
      membershipId: admin.id,
      tenantId: tenant.id,
      role: Role.tenant_admin,
      perms: ['settings.view'],
    });

    await request(app.getHttpServer())
      .patch('/v1/admin/settings')
      .set('Authorization', `Bearer ${viewerTok}`)
      .send({ name: 'Unauthorized Brand' })
      .expect(403);
  });

  it('scopes data-status database and notification counts to the current tenant', async () => {
    const tenant = await createTenant(prisma);
    const otherTenant = await createTenant(prisma);
    const [owner] = await createChain(prisma, tenant.id, 1);
    const [otherMember] = await createChain(prisma, otherTenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.notification.create({
      data: {
        tenantId: tenant.id,
        recipientMembershipId: owner.id,
        channel: NotificationChannel.in_app,
        template: 'settings_data_status_test',
        status: NotificationStatus.pending,
      },
    });
    await prisma.notification.create({
      data: {
        tenantId: otherTenant.id,
        recipientMembershipId: otherMember.id,
        channel: NotificationChannel.in_app,
        template: 'settings_data_status_other_tenant',
        status: NotificationStatus.failed,
      },
    });
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    const res = await request(app.getHttpServer())
      .get('/v1/admin/settings/data-status')
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);

    expect(res.body.database.activeTenants).toBe(1);
    expect(res.body.notifications.pending).toBe(1);
    expect(res.body.notifications.failed).toBe(0);
  });
});
