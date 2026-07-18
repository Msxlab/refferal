import { PrismaClient } from '@prisma/client';

const DEFAULT_TEST_DATABASE_URL = 'postgresql://refearn:refearn@localhost:5434/refearn_test';
const TEST_DATABASE_NAME = /(^|[_-])test([_-]|$)/i;
const SAFETY_PREFIX = 'Refusing destructive test operation';

type DatabaseProbe = Pick<PrismaClient, '$queryRawUnsafe'>;
type DatabaseTarget = { name: string; canonicalUrl: string };

const verifiedClients = new WeakMap<object, Promise<void>>();

function fail(detail: string): never {
  throw new Error(`${SAFETY_PREFIX}: ${detail}`);
}

function databaseTarget(url: string | undefined, variableName: string): DatabaseTarget {
  if (!url?.trim()) fail(`${variableName} is required.`);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    fail(`${variableName} must use a PostgreSQL URL.`);
  }

  let name: string;
  try {
    name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch {
    fail(`${variableName} has an invalid database name.`);
  }

  if (!name || name.includes('/') || !TEST_DATABASE_NAME.test(name)) {
    fail(`${variableName} must target a clearly named test database.`);
  }

  // `postgres:` and `postgresql:` are equivalent schemes. Everything else in
  // the canonical URL (host, port, credentials, database, and connection options)
  // must remain stable for destructive test work.
  if (parsed.protocol === 'postgres:') parsed.protocol = 'postgresql:';
  parsed.hash = '';
  return { name, canonicalUrl: parsed.toString() };
}

/** Returns the only database URL integration tests may ever target. */
export function configuredTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST?.trim() || DEFAULT_TEST_DATABASE_URL;
  databaseTarget(url, 'DATABASE_URL_TEST');
  return url;
}

/**
 * Validates the process-level target before test setup, migrations, fixtures, or resets.
 * It deliberately checks the full configured URL target rather than trusting NODE_ENV.
 */
export function assertEffectiveTestDatabaseUrl(
  effectiveUrl = process.env.DATABASE_URL,
  configuredUrl = configuredTestDatabaseUrl(),
): string {
  const expected = databaseTarget(configuredUrl, 'DATABASE_URL_TEST');
  const actual = databaseTarget(effectiveUrl, 'DATABASE_URL');
  if (actual.name !== expected.name) {
    fail(`DATABASE_URL targets "${actual.name}", not configured test database "${expected.name}".`);
  }
  if (actual.canonicalUrl !== expected.canonicalUrl) {
    fail('DATABASE_URL must exactly match the configured test database target.');
  }
  return expected.name;
}

/**
 * Checks the database Prisma is actually connected to before destructive test helpers run.
 * The result is cached per client to keep normal integration tests inexpensive.
 */
export async function assertPrismaTargetsConfiguredTestDatabase(prisma: DatabaseProbe): Promise<void> {
  const known = verifiedClients.get(prisma);
  if (known) return known;

  const check = (async () => {
    const expected = assertEffectiveTestDatabaseUrl();
    const rows = await prisma.$queryRawUnsafe<Array<{ database?: unknown }>>(
      'SELECT current_database() AS database',
    );
    const actual = typeof rows[0]?.database === 'string' ? rows[0].database : '';
    if (actual !== expected) {
      fail(`Prisma is connected to "${actual || 'unknown'}", not configured test database "${expected}".`);
    }
  })();

  verifiedClients.set(prisma, check);
  try {
    await check;
  } catch (error) {
    verifiedClients.delete(prisma);
    throw error;
  }
}
