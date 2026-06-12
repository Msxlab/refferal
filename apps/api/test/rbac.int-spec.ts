import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

/**
 * RBAC yetki-yukseltme korumasi (adversarial review tur-1 — critical+high bulgular):
 * bir aktor SAHIP OLMADIGI izni role yazamaz/atayamaz; kendi rolunu degistiremez.
 */
describe('RBAC escalation guards (entegrasyon)', () => {
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
      ...(o.perms ? { perms: o.perms } : {}),
    };
    return jwt.sign(p, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  // settings.roles tasiyan ama settings.data tasimayan gercekci bir admin
  const ADMIN_PERMS = ['dashboard.view', 'sales.view', 'settings.view', 'settings.roles'];

  async function setup() {
    const tenant = await createTenant(prisma);
    const [owner, admin, member] = await createChain(prisma, tenant.id, 3);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    await prisma.membership.update({ where: { id: admin.id }, data: { role: Role.tenant_admin } });
    return { tenant, owner, admin, member };
  }

  it('admin sahip olmadigi izinle (settings.data) rol OLUSTURAMAZ; sahip olduguyla olusturur', async () => {
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

  it('owner her izinle rol olusturabilir (god-mode, perms claim olmadan)', async () => {
    const { tenant, owner } = await setup();
    const ownerTok = token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner });

    await request(app.getHttpServer())
      .post('/v1/admin/roles')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ name: 'Superuser', permissions: ['settings.data', 'payouts.process'] })
      .expect(201);
  });

  it('admin KENDI rolunu bu ekrandan degistiremez (self-target)', async () => {
    const { tenant, admin } = await setup();
    const adminTok = token({ userId: admin.userId, membershipId: admin.id, tenantId: tenant.id, role: Role.tenant_admin, perms: ADMIN_PERMS });

    await request(app.getHttpServer())
      .patch(`/v1/admin/people/${admin.id}/role`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ tier: 'tenant_staff' })
      .expect(403);
  });

  it('admin, sahip olmadigi izni tasiyan bir rolu baska uyeye ATAYAMAZ', async () => {
    const { tenant, admin, member } = await setup();
    const adminTok = token({ userId: admin.userId, membershipId: admin.id, tenantId: tenant.id, role: Role.tenant_admin, perms: ADMIN_PERMS });

    // owner-seviyesi guclu bir rol (settings.data) dogrudan DB'de
    const strong = await prisma.tenantRole.create({
      data: { tenantId: tenant.id, key: 'strong', name: 'Strong', permissions: ['settings.data'] },
    });

    await request(app.getHttpServer())
      .patch(`/v1/admin/people/${member.id}/role`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ roleId: strong.id })
      .expect(403);
  });
});
