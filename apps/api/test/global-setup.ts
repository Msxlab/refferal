import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

/** Test DB'sine migration'lari uygular (testler kosmadan once bir kez). */
export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
  const url =
    process.env.DATABASE_URL_TEST ?? 'postgresql://refearn:refearn@localhost:5434/refearn_test';

  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
