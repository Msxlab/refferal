/* Platform admin (Axtra) hesabini idempotent ekler/gunceller — uyelik tasimaz. */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const ARGON2_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const EMAIL = (process.env.PLATFORM_ADMIN_EMAIL ?? 'platform@refearn.test').trim().toLowerCase();
const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD ?? 'Refearn-Demo-2026!';
const FULL_NAME = process.env.PLATFORM_ADMIN_NAME ?? 'Platform Admin';

async function main() {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await hash(PASSWORD, ARGON2_OPTS);
    const user = await prisma.user.upsert({
      where: { email: EMAIL },
      update: { fullName: FULL_NAME, isPlatformAdmin: true },
      create: {
        email: EMAIL,
        passwordHash,
        fullName: FULL_NAME,
        isPlatformAdmin: true,
        emailVerifiedAt: new Date(),
      },
      select: { id: true, email: true, isPlatformAdmin: true },
    });
    // eslint-disable-next-line no-console
    console.log('platform admin hazir:', user.email, '(isPlatformAdmin =', user.isPlatformAdmin, ')');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
