import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { EngineService } from '../src/engine/engine.service';
import { MembersAdminService } from '../src/members/members.admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActorContext } from '../src/common/actor';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

/** Dalga 3.1/3.3 — takim lideri / coklu-kok agac. */
describe('team leaders (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let members: MembersAdminService;
  let engine: EngineService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    members = moduleRef.get(MembersAdminService);
    engine = moduleRef.get(EngineService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  async function ownerCtx() {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id, { poolRateBps: 2000, rates: [1000] });
    const [owner] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    const actor: ActorContext = { userId: owner.userId, tenantId: tenant.id };
    return { tenant, owner, actor };
  }

  it('asLeader: yeni KOK lider olusturur (depth 0, sponsorsuz, isTeamLeader)', async () => {
    const { owner, actor } = await ownerCtx();
    const res = await members.createManual(actor, owner.id, { fullName: 'Lider Bir', email: 'lider1@oppein.test', asLeader: true });
    expect(res.isTeamLeader).toBe(true);
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: res.id } });
    expect(m.sponsorMembershipId).toBeNull();
    expect(m.depth).toBe(0);
    expect(m.isTeamLeader).toBe(true);
  });

  it('lider + alt-agac: leaders() grup ozeti, tree(root) yalniz o agac', async () => {
    const { owner, actor, tenant } = await ownerCtx();
    const lead = await members.createManual(actor, owner.id, { fullName: 'Lider', email: 'lead@oppein.test', asLeader: true });
    const mem = await members.createManual(actor, owner.id, { fullName: 'Ekip Uyesi', email: 'mem@oppein.test', sponsorMembershipId: lead.id });

    // uyenin bir satisi onaylanir -> grup cirosu + komisyon olusur
    const sale = await createSale(prisma, tenant.id, mem.id, 1_000_000n);
    await engine.approveSale(sale.id);

    const { leaders } = await members.leaders(tenant.id);
    const leaderRow = leaders.find((l) => l.id === lead.id)!;
    expect(leaderRow).toBeTruthy();
    expect(leaderRow.teamSize).toBe(1); // alt-agacta 1 kisi (uye)
    expect(BigInt(leaderRow.monthlyGroupVolumeCents)).toBe(1_000_000n);
    expect(BigInt(leaderRow.monthlyGroupCommissionCents)).toBeGreaterThan(0n);
    // owner kendi koku da listede (isOwnerRoot)
    expect(leaders.some((l) => l.isOwnerRoot)).toBe(true);

    // tree(root=lider): yalniz lider + uyesi (2 dugum)
    const sub = await members.tree(tenant.id, lead.id);
    expect(sub).toHaveLength(2);
    expect(sub.map((n) => n.id).sort()).toEqual([lead.id, mem.id].sort());
    expect(sub.find((n) => n.id === lead.id)!.isTeamLeader).toBe(true);
  });

  it('setLeader: mevcut uyeyi lider isaretler/kaldirir (yerlesim degismez)', async () => {
    const { owner, actor, tenant } = await ownerCtx();
    const [, alice] = await createChain(prisma, tenant.id, 2, owner);

    const before = await prisma.membership.findUniqueOrThrow({ where: { id: alice.id } });
    await members.setLeader(actor, alice.id, true);
    let m = await prisma.membership.findUniqueOrThrow({ where: { id: alice.id } });
    expect(m.isTeamLeader).toBe(true);
    expect(m.path).toBe(before.path); // yerlesim AYNI
    expect(m.sponsorMembershipId).toBe(before.sponsorMembershipId);

    const { leaders } = await members.leaders(tenant.id);
    expect(leaders.some((l) => l.id === alice.id && l.isTeamLeader)).toBe(true);

    await members.setLeader(actor, alice.id, false);
    m = await prisma.membership.findUniqueOrThrow({ where: { id: alice.id } });
    expect(m.isTeamLeader).toBe(false);
  });
});
