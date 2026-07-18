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

/** Kayitli gorunumler (Dalga 2 #3): kisisel + ekip paylasimi, sahip-bazli yetki. */
describe('saved views (entegrasyon)', () => {
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

  async function twoStaff() {
    const tenant = await createTenant(prisma);
    const [owner] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const [staff] = await createChain(prisma, tenant.id, 1, owner);
    await prisma.membership.update({ where: { id: staff.id }, data: { role: Role.tenant_staff } });
    return {
      tenant,
      a: token({ userId: owner.userId, membershipId: owner.id, tenantId: tenant.id, role: Role.tenant_owner }),
      b: token({ userId: staff.userId, membershipId: staff.id, tenantId: tenant.id, role: Role.tenant_staff }),
    };
  }

  const srv = () => app.getHttpServer();

  it('kisisel gorunum yalniz sahibine gorunur; paylasilan herkese', async () => {
    const { a, b } = await twoStaff();
    // A: bir kisisel, bir paylasilan
    await request(srv()).post('/v1/admin/views').set('Authorization', `Bearer ${a}`)
      .send({ target: 'sales', name: 'My drafts', shared: false, config: { status: 'draft' } }).expect(201);
    const shared = await request(srv()).post('/v1/admin/views').set('Authorization', `Bearer ${a}`)
      .send({ target: 'sales', name: 'Awaiting approval', shared: true, config: { status: 'draft', sort: 'saleDate' } }).expect(201);

    // A iki gorunumu de gorur
    const aList = await request(srv()).get('/v1/admin/views?target=sales').set('Authorization', `Bearer ${a}`).expect(200);
    expect(aList.body).toHaveLength(2);

    // B yalniz paylasilani gorur, mine:false + ownerName dolu
    const bList = await request(srv()).get('/v1/admin/views?target=sales').set('Authorization', `Bearer ${b}`).expect(200);
    expect(bList.body).toHaveLength(1);
    expect(bList.body[0].id).toBe(shared.body.id);
    expect(bList.body[0].mine).toBe(false);
    expect(bList.body[0].ownerName).toBeTruthy();

    // baska hedef sizmaz
    const other = await request(srv()).get('/v1/admin/views?target=members').set('Authorization', `Bearer ${a}`).expect(200);
    expect(other.body).toHaveLength(0);
  });

  it('yalniz sahibi paylasilan gorunumu siler/duzenler', async () => {
    const { a, b } = await twoStaff();
    const shared = await request(srv()).post('/v1/admin/views').set('Authorization', `Bearer ${a}`)
      .send({ target: 'sales', name: 'Team view', shared: true, config: {} }).expect(201);

    // B (sahip degil) silemez
    await request(srv()).delete(`/v1/admin/views/${shared.body.id}`).set('Authorization', `Bearer ${b}`).expect(403);
    // A duzenler (yeniden adlandir)
    const upd = await request(srv()).patch(`/v1/admin/views/${shared.body.id}`).set('Authorization', `Bearer ${a}`).send({ name: 'Renamed' }).expect(200);
    expect(upd.body.name).toBe('Renamed');
    // A siler
    await request(srv()).delete(`/v1/admin/views/${shared.body.id}`).set('Authorization', `Bearer ${a}`).expect(200);
    const aList = await request(srv()).get('/v1/admin/views?target=sales').set('Authorization', `Bearer ${a}`).expect(200);
    expect(aList.body).toHaveLength(0);
  });
});
