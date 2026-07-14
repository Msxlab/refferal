import { PrismaClient } from '@prisma/client';
import { truncateAll } from './helpers';

describe('test database safety guard (integration)', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalTestDatabaseUrl = process.env.DATABASE_URL_TEST;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;

    if (originalTestDatabaseUrl === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = originalTestDatabaseUrl;
  });

  it('refuses to truncate when the effective URL targets a non-test database', async () => {
    process.env.DATABASE_URL_TEST = 'postgresql://user:pass@localhost:5434/refearn_test';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5434/refearn_production';
    const execute = jest.fn<Promise<number>, [string]>().mockResolvedValue(0);
    const query = jest.fn<Promise<Array<{ database: string }>>, [string]>().mockResolvedValue([
      { database: 'refearn_production' },
    ]);
    const prisma = { $executeRawUnsafe: execute, $queryRawUnsafe: query } as unknown as PrismaClient;

    await expect(truncateAll(prisma)).rejects.toThrow(/refusing destructive test operation/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a same-named database on a different server', async () => {
    process.env.DATABASE_URL_TEST = 'postgresql://user:pass@localhost:5434/refearn_test';
    process.env.DATABASE_URL = 'postgresql://user:pass@production-db:5432/refearn_test';
    const execute = jest.fn<Promise<number>, [string]>().mockResolvedValue(0);
    const query = jest.fn<Promise<Array<{ database: string }>>, [string]>().mockResolvedValue([
      { database: 'refearn_test' },
    ]);
    const prisma = { $executeRawUnsafe: execute, $queryRawUnsafe: query } as unknown as PrismaClient;

    await expect(truncateAll(prisma)).rejects.toThrow(/must exactly match/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a configured URL without an unmistakable test database name', async () => {
    process.env.DATABASE_URL_TEST = 'postgresql://user:pass@localhost:5434/refearn_production';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    const execute = jest.fn<Promise<number>, [string]>().mockResolvedValue(0);
    const query = jest.fn<Promise<Array<{ database: string }>>, [string]>().mockResolvedValue([
      { database: 'refearn_production' },
    ]);
    const prisma = { $executeRawUnsafe: execute, $queryRawUnsafe: query } as unknown as PrismaClient;

    await expect(truncateAll(prisma)).rejects.toThrow(/clearly named test database/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses to truncate when Prisma is connected to a different database than its effective URL', async () => {
    process.env.DATABASE_URL_TEST = 'postgresql://user:pass@localhost:5434/refearn_test';
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    const execute = jest.fn<Promise<number>, [string]>().mockResolvedValue(0);
    const query = jest.fn<Promise<Array<{ database: string }>>, [string]>().mockResolvedValue([
      { database: 'refearn_production' },
    ]);
    const prisma = { $executeRawUnsafe: execute, $queryRawUnsafe: query } as unknown as PrismaClient;

    await expect(truncateAll(prisma)).rejects.toThrow(/Prisma is connected/i);
    expect(execute).not.toHaveBeenCalled();
  });
});
