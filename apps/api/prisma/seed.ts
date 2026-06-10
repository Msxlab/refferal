import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { hash } from '@node-rs/argon2';
import { Membership, PrismaClient, Role } from '@prisma/client';
import { DEFAULT_LEVEL_RATES_BPS, DEFAULT_POOL_RATE_BPS } from '@refearn/shared';

const prisma = new PrismaClient();

const ltreeLabel = (id: string) => id.replace(/-/g, '_');

async function createMember(
  tenantId: string,
  email: string,
  fullName: string,
  role: Role,
  passwordHash: string,
  referralCode: string,
  sponsor?: Membership,
): Promise<Membership> {
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, fullName, emailVerifiedAt: new Date() },
    update: {},
  });
  const member = await prisma.membership.create({
    data: {
      tenantId,
      userId: user.id,
      role,
      sponsorMembershipId: sponsor?.id ?? null,
      referralCode,
      depth: sponsor ? sponsor.depth + 1 : 0,
      path: '',
    },
  });
  const ownPath = sponsor ? `${sponsor.path}.${ltreeLabel(member.id)}` : ltreeLabel(member.id);
  return prisma.membership.update({ where: { id: member.id }, data: { path: ownPath } });
}

async function main(): Promise<void> {
  const existing = await prisma.tenant.findUnique({ where: { slug: 'oppein' } });
  if (existing) {
    console.log('Seed zaten uygulanmis (oppein tenant mevcut), atlandi.');
    return;
  }

  // Faz 1 MVP: tek aktif tenant — Oppein (SPEC 12).
  // Axtra varsayilanlari: on_delivery, $1.000 payout esigi, America/New_York.
  const tenant = await prisma.tenant.create({
    data: {
      slug: 'oppein',
      name: 'Oppein',
      currency: 'USD',
      timezone: 'America/New_York',
      maturationRule: 'on_delivery',
      payoutMinCents: 100_000n,
    },
  });

  await prisma.commissionPlan.create({
    data: {
      tenantId: tenant.id,
      name: 'Standart Plan (%10 havuz, 5 kademe)',
      poolRateBps: DEFAULT_POOL_RATE_BPS,
      depth: DEFAULT_LEVEL_RATES_BPS.length,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      levels: {
        create: DEFAULT_LEVEL_RATES_BPS.map((rateBps, level) => ({ level, rateBps })),
      },
    },
  });

  const password = await hash('Refearn-Demo-2026!', {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  // Ornek agac:
  //   owner (kurucu)
  //   └── alice ── bob ── carol ── dave ── erin   (5 seviyelik zincir: T1 manuel dogrulamasi)
  //   └── frank                                    (ikinci kol)
  const owner = await createMember(tenant.id, 'owner@oppein.test', 'Oppein Owner', 'tenant_owner', password, 'OPPEIN');
  const alice = await createMember(tenant.id, 'alice@oppein.test', 'Alice Aydin', 'member', password, 'ALICE1', owner);
  const bob = await createMember(tenant.id, 'bob@oppein.test', 'Bob Berk', 'member', password, 'BOB1', alice);
  const carol = await createMember(tenant.id, 'carol@oppein.test', 'Carol Can', 'member', password, 'CAROL1', bob);
  const dave = await createMember(tenant.id, 'dave@oppein.test', 'Dave Demir', 'member', password, 'DAVE1', carol);
  await createMember(tenant.id, 'erin@oppein.test', 'Erin Efe', 'member', password, 'ERIN1', dave);
  await createMember(tenant.id, 'frank@oppein.test', 'Frank Firat', 'member', password, 'FRANK1', owner);

  console.log('Seed tamam: oppein tenant + standart plan + 7 uyelik ornek agac.');
  console.log('Tum kullanicilarin sifresi: Refearn-Demo-2026!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
