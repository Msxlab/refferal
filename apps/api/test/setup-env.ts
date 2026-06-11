import * as path from 'node:path';
import * as dotenv from 'dotenv';

// Test ortami: throttler/scheduler bunu gorup kapanir (app.module skipIf/conditional)
process.env.NODE_ENV = 'test';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Entegrasyon testleri her zaman ayri test veritabanina kosar
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://refearn:refearn@localhost:5434/refearn_test';
