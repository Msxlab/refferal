import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { defaultPermissionsForTier } from '../src/common/permissions';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/**
 * RBAC escalation protection (adversarial review round 1 - critical/high findings):
 * an actor cannot write or assign permissions they do not hold, and cannot change their own role.
 */
describe('RBAC escalation guards (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let roleSeq = 0;

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
      ...(o.perms ? { perms: o.perms } : {}),
      authGeneration: 1,
    };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  // Realistic admin that has settings.roles but not settings.data.
  const ADMIN_PERMS = ['dashboard.view', 'sales.view', 'settings.view', 'settings.roles'];

  async function setup() {
    const tenant = await createTenant(prisma);
    const [owner, admin, member] = await createChain(prisma, tenant.id, 3);
    const limitedAdminRole = await prisma.tenantRole.create({
      data: { tenantId: tenant.id, key: 'limited_admin', name: 'Limited admin', permissions: ADMIN_PERMS },
    });
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: admin.id }, data: { role: Role.tenant_admin, roleId: limitedAdminRole.id } });
    return { tenant, owner, admin, member };
  }

  async function actorWithPerms(
    tenantId: string,
    membership: { id: string; userId: string },
    tier: Role,
    permissions: string[],
  ): Promise<string> {
    const roleRef = await prisma.tenantRole.create({
      data: {
        tenantId,
        key: `matrix_${++roleSeq}`,
        name: `Matrix ${roleSeq}`,
        permissions,
      },
    });
    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: tier, roleId: roleRef.id },
    });
    return token({ userId: membership.userId, membershipId: membership.id, tenantId, role: tier });
  }

  async function matrixSetup(count = 12) {
    const tenant = await createTenant(prisma);
    const chain = await createChain(prisma, tenant.id, count);
    const owner = chain[0];
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    return { tenant, owner, actors: chain.slice(1), seller: chain[count - 1] };
  }

  it('admin cannot create a role with permissions they do not hold, but can create one with held permissions', async () => {
    const { tenant, admin } = await setup();
    const adminTok = token({ userId: admin.userId, membershipId: admin.id, tenantId: tenant.id, role: Role.tenant_admin, perms: ADMIN_PERMS });

    await request(app.getHttpServer())
      .post('/v1/admin/roles')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Helper', permissions: ['sales.view'] })
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/admin/roles')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Sneaky', permissions: ['settings.data'] })
      .expect(403);

    const roles = await prisma.tenantRole.findMany({ where: { tenantId: tenant.id } });
    expect(roles.map((r) => r.name)).toContain('Helper');
    expect(roles.map((r) => r.name)).not.toContain('Sneaky');
  });

  it('owner can create roles with any permission without a perms claim', async () => {
    const { tenant, owner } = await setup();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    await request(app.getHttpServer())
      .post('/v1/admin/roles')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ name: 'Superuser', permissions: ['settings.data', 'payouts.process'] })
      .expect(201);
  });

  it('admin cannot change their own role from this surface', async () => {
    const { tenant, admin } = await setup();
    const adminTok = token({ userId: admin.userId, membershipId: admin.id, tenantId: tenant.id, role: Role.tenant_admin, perms: ADMIN_PERMS });

    await request(app.getHttpServer())
      .patch(`/v1/admin/people/${admin.id}/role`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ tier: 'tenant_staff' })
      .expect(403);
  });

  it('admin cannot assign another member a role containing permissions the admin does not hold', async () => {
    const { tenant, admin, member } = await setup();
    const adminTok = token({ userId: admin.userId, membershipId: admin.id, tenantId: tenant.id, role: Role.tenant_admin, perms: ADMIN_PERMS });

    // Strong owner-level role created directly in the database.
    const strong = await prisma.tenantRole.create({
      data: { tenantId: tenant.id, key: 'strong', name: 'Strong', permissions: ['settings.data'] },
    });

    await request(app.getHttpServer())
      .patch(`/v1/admin/people/${member.id}/role`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ roleId: strong.id })
      .expect(403);
  });

  it('demoting a user to member clears the old roleId', async () => {
    const { tenant, owner, member } = await setup();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    const strong = await prisma.tenantRole.create({
      data: { tenantId: tenant.id, key: 'strong', name: 'Strong', permissions: ['settings.data'] },
    });
    await prisma.membership.update({
      where: { id: member.id },
      data: { role: Role.tenant_admin, roleId: strong.id },
    });

    await request(app.getHttpServer())
      .patch(`/v1/admin/people/${member.id}/role`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ tier: 'member' })
      .expect(200);

    const updated = await prisma.membership.findUniqueOrThrow({ where: { id: member.id } });
    expect(updated.role).toBe(Role.member);
    expect(updated.roleId).toBeNull();
  });

  it('member token ignores stale roleRef permissions', async () => {
    const tenant = await createTenant(prisma);
    const user = await prisma.user.create({
      data: {
        email: 'stale-role@test.refearn.local',
        passwordHash: await hash('Very-Secret-Password-42!'),
        fullName: 'Stale Role',
      },
    });
    const strong = await prisma.tenantRole.create({
      data: { tenantId: tenant.id, key: 'strong', name: 'Strong', permissions: ['settings.data'] },
    });
    const membership = await prisma.membership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        role: Role.member,
        roleId: strong.id,
        referralCode: 'STALE1',
        depth: 0,
        path: '',
      },
    });
    await prisma.membership.update({
      where: { id: membership.id },
      data: { path: membership.id.replace(/-/g, '_') },
    });
    await prisma.user.update({ where: { id: user.id }, data: { lastMembershipId: membership.id } });

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: user.email, password: 'Very-Secret-Password-42!' })
      .expect(200);
    const payload = jwt.decode(login.body.accessToken) as AccessTokenPayload;
    expect(payload.role).toBe(Role.member);
    expect(payload.perms).toEqual([]);
    expect(typeof payload.mver).toBe('number');
    expect(payload.rver).toBeUndefined();
  });

  it('admin access token carries membership and role version hints', async () => {
    const tenant = await createTenant(prisma);
    const [admin] = await createChain(prisma, tenant.id, 1);
    const roleRef = await prisma.tenantRole.create({
      data: { tenantId: tenant.id, key: 'versioned', name: 'Versioned', permissions: ['settings.view'] },
    });
    await prisma.membership.update({ where: { id: admin.id }, data: { role: Role.tenant_admin, roleId: roleRef.id } });

    const adminTok = token({ userId: admin.userId, membershipId: admin.id, tenantId: tenant.id, role: Role.tenant_admin });
    await request(app.getHttpServer()).get('/v1/admin/settings').set('Authorization', `Bearer ${adminTok}`).expect(200);

    const loginPayload = jwt.decode(adminTok) as AccessTokenPayload;
    expect(loginPayload.mver).toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: admin.userId },
      include: {
        memberships: {
          include: { tenant: { select: { id: true, slug: true, name: true } }, roleRef: { select: { permissions: true, updatedAt: true } } },
        },
      },
    });
    const { AuthService } = await import('../src/auth/auth.service');
    const auth = app.get(AuthService);
    const switched = await auth.switchTenant(
      {
        sub: user.id,
        mid: admin.id,
        tid: tenant.id,
        role: Role.tenant_admin,
        authGeneration: user.authGeneration,
        iat: 0,
        exp: Number.MAX_SAFE_INTEGER,
      },
      admin.id,
    );
    const payload = jwt.decode(switched.accessToken) as AccessTokenPayload;
    expect(typeof payload.mver).toBe('number');
    expect(typeof payload.rver).toBe('number');
  });

  it('limited tenant admin cannot assign a default admin tier through legacy or canonical role paths', async () => {
    const { tenant, owner, admin, member } = await setup();
    const adminTok = token({ userId: admin.userId, membershipId: admin.id, tenantId: tenant.id, role: Role.tenant_admin, perms: ADMIN_PERMS });

    const legacy = await request(app.getHttpServer())
      .post(`/v1/admin/members/${member.id}/role`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ role: 'tenant_admin' });
    const canonical = await request(app.getHttpServer())
      .patch(`/v1/admin/people/${member.id}/role`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ tier: 'tenant_admin' });

    expect(legacy.status).toBe(403);
    expect(canonical.status).toBe(403);
    const updated = await prisma.membership.findUniqueOrThrow({ where: { id: member.id } });
    expect(updated.role).toBe(Role.member);

    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });
    await request(app.getHttpServer())
      .patch(`/v1/admin/people/${member.id}/role`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ tier: 'tenant_admin' })
      .expect(200);
    await expect(prisma.membership.findUniqueOrThrow({ where: { id: member.id } })).resolves.toMatchObject({
      role: Role.tenant_admin,
    });
  });

  it('legacy tier assignment replaces a stale custom role reference with the selected system tier', async () => {
    const tenant = await createTenant(prisma);
    const [owner, admin, member] = await createChain(prisma, tenant.id, 3);
    const systemAdmin = await prisma.tenantRole.create({
      data: {
        tenantId: tenant.id,
        key: 'admin',
        name: 'Administrator',
        isSystem: true,
        permissions: defaultPermissionsForTier(Role.tenant_admin),
      },
    });
    const staleStrongRole = await prisma.tenantRole.create({
      data: {
        tenantId: tenant.id,
        key: 'stale_strong',
        name: 'Stale strong role',
        permissions: ['settings.data'],
      },
    });
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: admin.id }, data: { role: Role.tenant_admin, roleId: null } });
    await prisma.membership.update({ where: { id: member.id }, data: { role: Role.member, roleId: staleStrongRole.id } });
    const adminTok = token({ userId: admin.userId, membershipId: admin.id, tenantId: tenant.id, role: Role.tenant_admin });

    await request(app.getHttpServer())
      .post(`/v1/admin/members/${member.id}/role`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ role: 'tenant_admin' })
      .expect(200);

    const updated = await prisma.membership.findUniqueOrThrow({ where: { id: member.id } });
    expect(updated.role).toBe(Role.tenant_admin);
    expect(updated.roleId).toBe(systemAdmin.id);
  });

  it('legacy tier assignment respects the current system-role permissions, not only static defaults', async () => {
    const tenant = await createTenant(prisma);
    const [owner, admin, member] = await createChain(prisma, tenant.id, 3);
    await prisma.tenantRole.create({
      data: {
        tenantId: tenant.id,
        key: 'admin',
        name: 'Administrator',
        isSystem: true,
        permissions: [...defaultPermissionsForTier(Role.tenant_admin), 'settings.data'],
      },
    });
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: admin.id }, data: { role: Role.tenant_admin, roleId: null } });
    const adminTok = token({ userId: admin.userId, membershipId: admin.id, tenantId: tenant.id, role: Role.tenant_admin });

    const legacy = await request(app.getHttpServer())
      .post(`/v1/admin/members/${member.id}/role`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ role: 'tenant_admin' });
    const canonical = await request(app.getHttpServer())
      .patch(`/v1/admin/people/${member.id}/role`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ tier: 'tenant_admin' });

    expect(legacy.status).toBe(403);
    expect(canonical.status).toBe(403);

    await expect(prisma.membership.findUniqueOrThrow({ where: { id: member.id } })).resolves.toMatchObject({ role: Role.member });
  });

  it('canonical assignment cannot clear a custom role into a default tier the actor cannot grant', async () => {
    const { tenant, admin, member } = await setup();
    const limitedRole = await prisma.tenantRole.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: tenant.id, key: 'limited_admin' } },
    });
    await prisma.membership.update({
      where: { id: member.id },
      data: { role: Role.tenant_admin, roleId: limitedRole.id },
    });
    const adminTok = token({ userId: admin.userId, membershipId: admin.id, tenantId: tenant.id, role: Role.tenant_admin });

    await request(app.getHttpServer())
      .patch(`/v1/admin/people/${member.id}/role`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ roleId: null })
      .expect(403);

    await expect(prisma.membership.findUniqueOrThrow({ where: { id: member.id } })).resolves.toMatchObject({
      role: Role.tenant_admin,
      roleId: limitedRole.id,
    });
  });

  it('stale access token cannot pass permission checks after a database role downgrade', async () => {
    const { tenant, admin } = await setup();
    const staleAdminTok = token({
      userId: admin.userId,
      membershipId: admin.id,
      tenantId: tenant.id,
      role: Role.tenant_admin,
      perms: ADMIN_PERMS,
    });

    await prisma.membership.update({
      where: { id: admin.id },
      data: { role: Role.member, roleId: null },
    });

    await request(app.getHttpServer())
      .get('/v1/admin/roles')
      .set('Authorization', `Bearer ${staleAdminTok}`)
      .expect(403);
  });

  it('permission matrix: sales endpoints enforce resource and action permissions', async () => {
    const { tenant, actors, seller } = await matrixSetup();
    await createPlan(prisma, tenant.id);

    const noSales = await actorWithPerms(tenant.id, actors[0], Role.tenant_staff, ['dashboard.view']);
    await request(app.getHttpServer()).get('/v1/admin/sales').set('Authorization', `Bearer ${noSales}`).expect(403);

    const viewOnly = await actorWithPerms(tenant.id, actors[1], Role.tenant_staff, ['sales.view']);
    await request(app.getHttpServer()).get('/v1/admin/sales').set('Authorization', `Bearer ${viewOnly}`).expect(200);

    const createOnly = await actorWithPerms(tenant.id, actors[2], Role.tenant_staff, ['sales.create']);
    await request(app.getHttpServer())
      .post('/v1/admin/sales')
      .set('Authorization', `Bearer ${createOnly}`)
      .send({ sellerReferralCode: seller.referralCode, amountCents: 100_000 })
      .expect(201);

    const sale = await createSale(prisma, tenant.id, seller.id, 10_000_000n);
    const adminWithoutApprove = await actorWithPerms(tenant.id, actors[3], Role.tenant_admin, ['sales.view']);
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${sale.id}/approve`)
      .set('Authorization', `Bearer ${adminWithoutApprove}`)
      .expect(403);

    const adminWithApprove = await actorWithPerms(tenant.id, actors[4], Role.tenant_admin, ['sales.approve']);
    await request(app.getHttpServer())
      .post(`/v1/admin/sales/${sale.id}/approve`)
      .set('Authorization', `Bearer ${adminWithApprove}`)
      .expect(200);
  });

  it('permission matrix: payout endpoints require both role and permission checks', async () => {
    const { tenant, actors } = await matrixSetup();

    const staffWithPayouts = await actorWithPerms(tenant.id, actors[0], Role.tenant_staff, ['payouts.view', 'payouts.process', 'payouts.export']);
    await request(app.getHttpServer()).get('/v1/admin/payouts/payable').set('Authorization', `Bearer ${staffWithPayouts}`).expect(403);

    const adminNoPayouts = await actorWithPerms(tenant.id, actors[1], Role.tenant_admin, ['sales.view']);
    await request(app.getHttpServer()).get('/v1/admin/payouts/payable').set('Authorization', `Bearer ${adminNoPayouts}`).expect(403);

    const adminView = await actorWithPerms(tenant.id, actors[2], Role.tenant_admin, ['payouts.view']);
    await request(app.getHttpServer()).get('/v1/admin/payouts/payable').set('Authorization', `Bearer ${adminView}`).expect(200);

    const adminProcess = await actorWithPerms(tenant.id, actors[3], Role.tenant_admin, ['payouts.process']);
    const scope = { mode: 'all_eligible' as const, filters: { method: 'manual' as const } };
    const preview = await request(app.getHttpServer())
      .post('/v1/admin/payouts/batches/preview')
      .set('Authorization', `Bearer ${adminProcess}`)
      .send({ scope })
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/admin/payouts/run')
      .set('Authorization', `Bearer ${adminProcess}`)
      .send({ scope, previewToken: preview.body.previewToken })
      .expect(200);

    const adminExport = await actorWithPerms(tenant.id, actors[4], Role.tenant_admin, ['payouts.export']);
    await request(app.getHttpServer())
      .get('/v1/admin/payouts/export.csv?period=2026-07')
      .set('Authorization', `Bearer ${adminExport}`)
      .expect(200);
  });

  it('permission matrix: members and reports endpoints are protected by separate permissions', async () => {
    const { tenant, actors, seller } = await matrixSetup();

    const membersView = await actorWithPerms(tenant.id, actors[0], Role.tenant_staff, ['members.view']);
    await request(app.getHttpServer()).get('/v1/admin/members').set('Authorization', `Bearer ${membersView}`).expect(200);
    await request(app.getHttpServer()).get('/v1/admin/members/tree').set('Authorization', `Bearer ${membersView}`).expect(403);

    const networkView = await actorWithPerms(tenant.id, actors[1], Role.tenant_staff, ['network.view']);
    await request(app.getHttpServer()).get('/v1/admin/members/tree').set('Authorization', `Bearer ${networkView}`).expect(403);
    await request(app.getHttpServer()).get('/v1/admin/members/tree-snapshot').set('Authorization', `Bearer ${networkView}`).expect(403);
    await request(app.getHttpServer()).get('/v1/admin/members/leaders').set('Authorization', `Bearer ${networkView}`).expect(403);

    const financialOnly = await actorWithPerms(tenant.id, actors[2], Role.tenant_staff, ['network.financials.view']);
    await request(app.getHttpServer()).get('/v1/admin/members/tree').set('Authorization', `Bearer ${financialOnly}`).expect(403);
    await request(app.getHttpServer()).get('/v1/admin/members/leaders').set('Authorization', `Bearer ${financialOnly}`).expect(403);

    const financialNetwork = await actorWithPerms(
      tenant.id,
      actors[3],
      Role.tenant_staff,
      ['network.view', 'network.financials.view'],
    );
    await request(app.getHttpServer()).get('/v1/admin/members/tree').set('Authorization', `Bearer ${financialNetwork}`).expect(200);
    await request(app.getHttpServer()).get('/v1/admin/members/tree-snapshot').set('Authorization', `Bearer ${financialNetwork}`).expect(200);
    await request(app.getHttpServer()).get('/v1/admin/members/leaders').set('Authorization', `Bearer ${financialNetwork}`).expect(200);

    const adminInvite = await actorWithPerms(tenant.id, actors[4], Role.tenant_admin, ['invites.create']);
    await request(app.getHttpServer()).post('/v1/admin/members/invite').set('Authorization', `Bearer ${adminInvite}`).send({}).expect(200);

    const adminSuspend = await actorWithPerms(tenant.id, actors[5], Role.tenant_admin, ['members.suspend']);
    await request(app.getHttpServer()).post(`/v1/admin/members/${seller.id}/deactivate`).set('Authorization', `Bearer ${adminSuspend}`).expect(200);

    const dash = await actorWithPerms(tenant.id, actors[6], Role.tenant_staff, ['dashboard.view']);
    await request(app.getHttpServer()).get('/v1/admin/dashboard').set('Authorization', `Bearer ${dash}`).expect(200);
    await request(app.getHttpServer()).get('/v1/admin/analytics').set('Authorization', `Bearer ${dash}`).expect(403);

    const reports = await actorWithPerms(tenant.id, actors[7], Role.tenant_staff, ['reports.view']);
    await request(app.getHttpServer()).get('/v1/admin/analytics').set('Authorization', `Bearer ${reports}`).expect(200);

    const auditStaff = await actorWithPerms(tenant.id, actors[8], Role.tenant_staff, ['audit.view']);
    await request(app.getHttpServer()).get('/v1/admin/audit').set('Authorization', `Bearer ${auditStaff}`).expect(403);

    const auditAdmin = await actorWithPerms(tenant.id, actors[9], Role.tenant_admin, ['audit.view']);
    await request(app.getHttpServer()).get('/v1/admin/audit').set('Authorization', `Bearer ${auditAdmin}`).expect(200);
  });

  it('permission matrix: settings PATCH requires field-specific edit permissions', async () => {
    const { tenant, actors } = await matrixSetup();

    const viewer = await actorWithPerms(tenant.id, actors[0], Role.tenant_staff, ['settings.view']);
    await request(app.getHttpServer()).get('/v1/admin/settings').set('Authorization', `Bearer ${viewer}`).expect(200);

    const general = await actorWithPerms(tenant.id, actors[1], Role.tenant_admin, ['settings.view', 'settings.general']);
    await request(app.getHttpServer())
      .patch('/v1/admin/settings')
      .set('Authorization', `Bearer ${general}`)
      .send({ timezone: 'America/Chicago' })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/v1/admin/settings')
      .set('Authorization', `Bearer ${general}`)
      .send({ payoutMinCents: 250_000 })
      .expect(403);

    const payments = await actorWithPerms(tenant.id, actors[2], Role.tenant_admin, ['settings.view', 'settings.payments']);
    await request(app.getHttpServer())
      .patch('/v1/admin/settings')
      .set('Authorization', `Bearer ${payments}`)
      .send({ payoutMinCents: 250_000 })
      .expect(200);
  });
});
