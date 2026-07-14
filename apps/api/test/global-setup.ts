import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { assertEffectiveTestDatabaseUrl, configuredTestDatabaseUrl } from './test-database-guard';

/** Applies migrations to the test database once before integration tests run. */
export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
  const url = configuredTestDatabaseUrl();
  assertEffectiveTestDatabaseUrl(url, url);
  const prismaBin = path.resolve(
    __dirname,
    '../node_modules/.bin',
    process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
  );

  execSync(`"${prismaBin}" migrate deploy`, {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
