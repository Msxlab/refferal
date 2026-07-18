import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { assertEffectiveTestDatabaseUrl, configuredTestDatabaseUrl } from './test-database-guard';

// Test environment: throttler and scheduler check this and stay disabled.
process.env.NODE_ENV = 'test';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Integration tests always run against the configured, clearly named test database.
process.env.DATABASE_URL = configuredTestDatabaseUrl();
assertEffectiveTestDatabaseUrl(process.env.DATABASE_URL);
