import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MembershipStatus, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { MembersAdminService } from '../src/members/members.admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActorContext } from '../src/common/actor';
import { createChain, createTenant, truncateAll } from './helpers';

/** Dalga 2 — manuel uye olusturma (davet beklemeden). */
describe('manual member create (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let members: MembersAdminService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    members = moduleRef.get(MembersAdminService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  async function ownerCtx() {
    const tenant = await createTenant(prisma);
    const [owner] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const actor: ActorContext = { userId: owner.userId, tenantId: tenant.id };
    return { tenant, owner, actor };
  }

  it('User + Membership olusturur, owner altina yerlesir, gecici sifre doner', async () => {
    const { owner, actor, tenant } = await ownerCtx();
    const res = await members.createManual(actor, owner.id, { fullName: 'Jane Smith', email: 'jane@oppein.test', role: Role.member });

    expect(res.referralCode).toBeTruthy();
    expect(res.newUser).toBe(true);
    expect(res.tempPassword).toBeTruthy();
    expect(res.tempPassword!.length).toBeGreaterThanOrEqual(10);

    const m = await prisma.membership.findUnique({ where: { id: res.id }, include: { user: true } });
    expect(m).toBeTruthy();
    expect(m!.tenantId).toBe(tenant.id);
    expect(m!.sponsorMembershipId).toBe(owner.id);
    expect(m!.depth).toBe(owner.depth + 1);
    expect(m!.status).toBe(MembershipStatus.active);
    expect(m!.user.email).toBe('jane@oppein.test');
    expect(m!.user.emailVerifiedAt).not.toBeNull();
  });

  it('belirtilen sponsor altina yerlesir', async () => {
    const { owner, actor, tenant } = await ownerCtx();
    const [, alice] = await createChain(prisma, tenant.id, 2, owner);
    const res = await members.createManual(actor, owner.id, { fullName: 'Bob New', email: 'bobnew@oppein.test', sponsorMembershipId: alice.id });
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: res.id } });
    expect(m.sponsorMembershipId).toBe(alice.id);
    expect(m.depth).toBe(alice.depth + 1);
  });

  it('ayni e-posta ayni isletmede ikinci kez eklenemez', async () => {
    const { owner, actor } = await ownerCtx();
    await members.createManual(actor, owner.id, { fullName: 'Jane Smith', email: 'dup@oppein.test' });
    await expect(members.createManual(actor, owner.id, { fullName: 'Jane Again', email: 'dup@oppein.test' }))
      .rejects.toThrow(ConflictException);
  });

  it('audit kaydi yazilir (membership.create_manual)', async () => {
    const { owner, actor, tenant } = await ownerCtx();
    await members.createManual(actor, owner.id, { fullName: 'Audit Test', email: 'audit@oppein.test' });
    const log = await prisma.auditLog.findFirst({ where: { tenantId: tenant.id, action: 'membership.create_manual' } });
    expect(log).toBeTruthy();
  });

  it('updateProfile: ad/e-posta degisir, e-posta degisince emailVerifiedAt sifirlanir', async () => {
    const { owner, actor } = await ownerCtx();
    const created = await members.createManual(actor, owner.id, { fullName: 'Eski Ad', email: 'eski@oppein.test' });
    await members.updateProfile(actor, created.id, { fullName: 'Yeni Ad', email: 'yeni@oppein.test' });
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: created.id }, include: { user: true } });
    expect(m.user.fullName).toBe('Yeni Ad');
    expect(m.user.email).toBe('yeni@oppein.test');
    expect(m.user.emailVerifiedAt).toBeNull(); // yeniden dogrulama gerekir
  });

  it('updateProfile: baska hesabin e-postasi alinamaz', async () => {
    const { owner, actor } = await ownerCtx();
    await members.createManual(actor, owner.id, { fullName: 'Bir', email: 'bir@oppein.test' });
    const ikinci = await members.createManual(actor, owner.id, { fullName: 'Iki', email: 'iki@oppein.test' });
    await expect(members.updateProfile(actor, ikinci.id, { email: 'bir@oppein.test' })).rejects.toThrow(ConflictException);
  });
});
