import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InviteStatus, MembershipStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

/**
 * Auth + davet akisi (SPEC 4 / 13-4) — HTTP seviyesinde, gercek Postgres'e karsi.
 */
describe('auth + davet akisi (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = 'Cok-Gizli-Sifre-42!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  /** Test fikstur: tenant + plan + kok uye + kok uyeden bir davet. */
  async function setupTenantWithInvite() {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [root] = await createChain(prisma, tenant.id, 1);
    const invite = await prisma.invite.create({
      data: {
        tenantId: tenant.id,
        inviterMembershipId: root.id,
        code: `INV${Date.now()}${Math.floor(Math.random() * 1000)}`,
        expiresAt: new Date(Date.now() + authConfig.inviteTtlMs),
      },
    });
    return { tenant, root, invite };
  }

  function registerBody(invite: { code: string }, email = 'yeni@uye.test') {
    return {
      inviteCode: invite.code,
      email,
      password: PASSWORD,
      fullName: 'Yeni Uye',
    };
  }

  it('public davet cozumleme: /v1/invites/:code', async () => {
    const { tenant, invite } = await setupTenantWithInvite();

    const res = await request(app.getHttpServer()).get(`/v1/invites/${invite.code}`).expect(200);
    expect(res.body).toMatchObject({
      code: invite.code,
      valid: true,
      tenantName: tenant.name,
      emailLocked: false,
    });

    await request(app.getHttpServer()).get('/v1/invites/YOKBOYLEKOD').expect(404);
  });

  it('register-by-invite: sponsor altina dogru yerlesim + davet tek kullanimlik', async () => {
    const { root, invite } = await setupTenantWithInvite();

    const res = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.activeMembershipId).toBeDefined();
    expect(res.body.memberships).toHaveLength(1);

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: res.body.activeMembershipId },
    });
    expect(membership.sponsorMembershipId).toBe(root.id);
    expect(membership.depth).toBe(root.depth + 1);
    expect(membership.path.startsWith(`${root.path}.`)).toBe(true);
    expect(membership.status).toBe(MembershipStatus.active);

    const usedInvite = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(usedInvite.status).toBe(InviteStatus.used);
    expect(usedInvite.usedByMembershipId).toBe(membership.id);

    // davet edene outbox bildirimi
    const joined = await prisma.notification.count({
      where: { template: 'team_member_joined', recipientMembershipId: root.id },
    });
    expect(joined).toBe(1);

    // ayni davet ikinci kez kullanilamaz
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite, 'baska@uye.test'))
      .expect(400);
  });

  it('suresi dolmus davet reddedilir ve expired isaretlenir', async () => {
    const { invite } = await setupTenantWithInvite();
    await prisma.invite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(400);

    const updated = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(updated.status).toBe(InviteStatus.expired);
  });

  it('e-postaya kesilmis davet baska e-postayla kullanilamaz', async () => {
    const { invite } = await setupTenantWithInvite();
    await prisma.invite.update({
      where: { id: invite.id },
      data: { email: 'sadece-bu@kisi.test' },
    });

    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite, 'baskasi@kisi.test'))
      .expect(400);

    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite, 'sadece-bu@kisi.test'))
      .expect(201);
  });

  it('login: dogru sifre 200 + claim`ler; yanlis sifre 401', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'yeni@uye.test', password: PASSWORD })
      .expect(200);
    expect(login.body.activeMembershipId).toBe(reg.body.activeMembershipId);

    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe('yeni@uye.test');
    expect(me.body.activeMembershipId).toBe(reg.body.activeMembershipId);

    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'yeni@uye.test', password: 'yanlis-sifre-123' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'olmayan@kisi.test', password: PASSWORD })
      .expect(401);
  });

  it('korumali rotalar tokensiz 401; davet olustur/listele calisir', async () => {
    const { invite } = await setupTenantWithInvite();
    await request(app.getHttpServer()).get('/v1/app/invites').expect(401);
    await request(app.getHttpServer()).get('/v1/me').expect(401);

    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const created = await request(app.getHttpServer())
      .post('/v1/app/invites')
      .set(auth)
      .send({})
      .expect(201);
    expect(created.body.code).toHaveLength(10);

    const list = await request(app.getHttpServer()).get('/v1/app/invites').set(auth).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].code).toBe(created.body.code);
  });

  it('refresh rotasyonu + reuse detection: eski token tum oturumlari dusurur', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);
    const oldRefresh = reg.body.refreshToken;

    // rotasyon: yeni cift verilir
    const r1 = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(200);
    expect(r1.body.refreshToken).toBeDefined();
    expect(r1.body.refreshToken).not.toBe(oldRefresh);

    // eski token yeniden kullanilirsa → reuse: 401 + TUM aktif token'lar iptal
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
  });

  it('logout: refresh token iptal edilir', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({ refreshToken: reg.body.refreshToken })
      .expect(200);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.body.refreshToken })
      .expect(401);
  });

  it('coklu tenant: ayni hesap ikinci tenanta davetle baglanir; switch-tenant calisir', async () => {
    const t1 = await setupTenantWithInvite();
    const reg1 = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(t1.invite))
      .expect(201);

    const t2 = await setupTenantWithInvite();

    // yanlis sifreyle mevcut hesaba uyelik ACILMAZ
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send({ ...registerBody(t2.invite), password: 'yanlis-sifre-42!' })
      .expect(409);

    const reg2 = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(t2.invite))
      .expect(201);

    expect(reg2.body.memberships).toHaveLength(2);
    // tek global hesap
    expect(await prisma.user.count({ where: { email: 'yeni@uye.test' } })).toBe(1);

    // son secim hatirlanir: aktif uyelik = en son kayit olunan
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'yeni@uye.test', password: PASSWORD })
      .expect(200);
    expect(login.body.activeMembershipId).toBe(reg2.body.activeMembershipId);

    // switch-tenant: ilk tenanta gec
    const sw = await request(app.getHttpServer())
      .post('/v1/me/switch-tenant')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ membershipId: reg1.body.activeMembershipId })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${sw.body.accessToken}`)
      .expect(200);
    expect(me.body.activeMembershipId).toBe(reg1.body.activeMembershipId);
    expect(me.body.tenantId).toBe(t1.tenant.id);

    // baskasinin uyeligine gecilemez
    const digerKisi = await prisma.membership.findFirstOrThrow({
      where: { id: { notIn: [reg1.body.activeMembershipId, reg2.body.activeMembershipId] } },
    });
    await request(app.getHttpServer())
      .post('/v1/me/switch-tenant')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ membershipId: digerKisi.id })
      .expect(404);
  });

  it('ayni tenantta ikinci uyelik acilamaz', async () => {
    const { tenant, root, invite } = await setupTenantWithInvite();
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    const invite2 = await prisma.invite.create({
      data: {
        tenantId: tenant.id,
        inviterMembershipId: root.id,
        code: `INV2-${Date.now()}`,
        expiresAt: new Date(Date.now() + authConfig.inviteTtlMs),
      },
    });
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite2))
      .expect(409);
  });

  it('e-posta dogrulama: token outbox`a yazilir ve dogrulama calisir', async () => {
    const { invite } = await setupTenantWithInvite();
    await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    const notif = await prisma.notification.findFirstOrThrow({
      where: { template: 'verify_email' },
    });
    const token = (notif.payload as { token: string }).token;

    await request(app.getHttpServer()).post('/v1/auth/verify-email').send({ token }).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'yeni@uye.test' } });
    expect(user.emailVerifiedAt).not.toBeNull();

    // token tek kullanimlik
    await request(app.getHttpServer()).post('/v1/auth/verify-email').send({ token }).expect(400);
  });

  it('sifre sifirlama: eski oturumlar kapanir, yeni sifreyle giris', async () => {
    const { invite } = await setupTenantWithInvite();
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register-by-invite')
      .send(registerBody(invite))
      .expect(201);

    // istek — olmayan e-posta icin de ayni cevap (enumeration yok)
    await request(app.getHttpServer())
      .post('/v1/auth/password-reset/request')
      .send({ email: 'olmayan@kisi.test' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/password-reset/request')
      .send({ email: 'yeni@uye.test' })
      .expect(200);

    const notif = await prisma.notification.findFirstOrThrow({
      where: { template: 'password_reset' },
    });
    const token = (notif.payload as { token: string }).token;

    const newPassword = 'Yepyeni-Sifre-2026!';
    await request(app.getHttpServer())
      .post('/v1/auth/password-reset/confirm')
      .send({ token, newPassword })
      .expect(200);

    // eski refresh artik gecersiz
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: reg.body.refreshToken })
      .expect(401);

    // eski sifre gecmez, yenisi gecer
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'yeni@uye.test', password: PASSWORD })
      .expect(401);
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'yeni@uye.test', password: newPassword })
      .expect(200);
  });
});
