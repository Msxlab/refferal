import { PrismaClient } from '@prisma/client';
import { truncateAll } from './helpers';

type CatalogColumn = {
  column_name: string;
  is_nullable: 'YES' | 'NO';
  udt_name: string;
};

type CatalogKey = {
  column_names: string[];
};

type CatalogColumnDefault = {
  column_name: string;
  column_default: string | null;
};

type CatalogForeignKey = {
  column_name: string;
  referenced_table: string;
  referenced_column: string;
  delete_action: string;
};

type CatalogIndex = {
  column_names: string[];
  is_primary: boolean;
  is_unique: boolean;
};

describe('test database safety guard (integration)', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalTestDatabaseUrl = process.env.DATABASE_URL_TEST;
  const catalogPrisma = new PrismaClient();

  afterAll(async () => {
    await catalogPrisma.$disconnect();
  });

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

  it('persists invite acceptance consent with the required immutable references and snapshot', async () => {
    const columns = await catalogPrisma.$queryRaw<CatalogColumn[]>`
      SELECT column_name, is_nullable, udt_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invite_acceptance_consents'
      ORDER BY column_name
    `;

    expect(columns).toEqual([
      { column_name: 'accepted_at', is_nullable: 'NO', udt_name: 'timestamp' },
      { column_name: 'created_at', is_nullable: 'NO', udt_name: 'timestamp' },
      { column_name: 'disclaimer_content_hash', is_nullable: 'NO', udt_name: 'text' },
      { column_name: 'disclaimer_version', is_nullable: 'NO', udt_name: 'text' },
      { column_name: 'id', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'invite_id', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'locale', is_nullable: 'NO', udt_name: 'text' },
      { column_name: 'membership_id', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'program_summary', is_nullable: 'NO', udt_name: 'text' },
      { column_name: 'program_summary_hash', is_nullable: 'NO', udt_name: 'text' },
      { column_name: 'tenant_display_name', is_nullable: 'NO', udt_name: 'text' },
      { column_name: 'tenant_id', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'user_id', is_nullable: 'NO', udt_name: 'uuid' },
    ]);

    const defaults = await catalogPrisma.$queryRaw<CatalogColumnDefault[]>`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invite_acceptance_consents'
        AND column_default IS NOT NULL
      ORDER BY column_name
    `;

    expect(defaults).toEqual([
      { column_name: 'accepted_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'created_at', column_default: 'CURRENT_TIMESTAMP' },
      { column_name: 'id', column_default: 'gen_random_uuid()' },
    ]);

    const primaryKeys = await catalogPrisma.$queryRaw<CatalogKey[]>`
      SELECT array_agg(attribute.attname ORDER BY constraint_key.ordinality)::text[] AS column_names
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS table_record ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace AS namespace_record ON namespace_record.oid = table_record.relnamespace
      JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY
        AS constraint_key(attnum, ordinality) ON TRUE
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = table_record.oid
       AND attribute.attnum = constraint_key.attnum
      WHERE namespace_record.nspname = current_schema()
        AND table_record.relname = 'invite_acceptance_consents'
        AND constraint_record.contype = 'p'
      GROUP BY constraint_record.oid
    `;

    expect(primaryKeys).toEqual([{ column_names: ['id'] }]);

    const uniqueKeys = await catalogPrisma.$queryRaw<CatalogKey[]>`
      SELECT array_agg(attribute.attname ORDER BY constraint_key.ordinality)::text[] AS column_names
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS table_record ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace AS namespace_record ON namespace_record.oid = table_record.relnamespace
      JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY
        AS constraint_key(attnum, ordinality) ON TRUE
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = table_record.oid
       AND attribute.attnum = constraint_key.attnum
      WHERE namespace_record.nspname = current_schema()
        AND table_record.relname = 'invite_acceptance_consents'
        AND constraint_record.contype = 'u'
      GROUP BY constraint_record.oid
    `;

    expect(uniqueKeys).toContainEqual({ column_names: ['invite_id', 'user_id'] });

    const foreignKeys = await catalogPrisma.$queryRaw<CatalogForeignKey[]>`
      SELECT
        local_attribute.attname AS column_name,
        referenced_table.relname AS referenced_table,
        referenced_attribute.attname AS referenced_column,
        CASE constraint_record.confdeltype
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'd' THEN 'SET DEFAULT'
          ELSE 'NO ACTION'
        END AS delete_action
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS local_table ON local_table.oid = constraint_record.conrelid
      JOIN pg_namespace AS namespace_record ON namespace_record.oid = local_table.relnamespace
      JOIN pg_class AS referenced_table ON referenced_table.oid = constraint_record.confrelid
      JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY
        AS local_key(attnum, ordinality) ON TRUE
      JOIN LATERAL unnest(constraint_record.confkey) WITH ORDINALITY
        AS referenced_key(attnum, ordinality) ON referenced_key.ordinality = local_key.ordinality
      JOIN pg_attribute AS local_attribute
        ON local_attribute.attrelid = local_table.oid
       AND local_attribute.attnum = local_key.attnum
      JOIN pg_attribute AS referenced_attribute
        ON referenced_attribute.attrelid = referenced_table.oid
       AND referenced_attribute.attnum = referenced_key.attnum
      WHERE namespace_record.nspname = current_schema()
        AND local_table.relname = 'invite_acceptance_consents'
        AND constraint_record.contype = 'f'
      ORDER BY local_attribute.attname
    `;

    expect(foreignKeys).toEqual([
      {
        column_name: 'invite_id',
        referenced_table: 'invites',
        referenced_column: 'id',
        delete_action: 'RESTRICT',
      },
      {
        column_name: 'membership_id',
        referenced_table: 'memberships',
        referenced_column: 'id',
        delete_action: 'RESTRICT',
      },
      {
        column_name: 'tenant_id',
        referenced_table: 'tenants',
        referenced_column: 'id',
        delete_action: 'RESTRICT',
      },
      {
        column_name: 'user_id',
        referenced_table: 'users',
        referenced_column: 'id',
        delete_action: 'RESTRICT',
      },
    ]);

    const indexes = await catalogPrisma.$queryRaw<CatalogIndex[]>`
      SELECT
        array_agg(attribute.attname ORDER BY index_key.ordinality)::text[] AS column_names,
        index_record.indisprimary AS is_primary,
        index_record.indisunique AS is_unique
      FROM pg_index AS index_record
      JOIN pg_class AS table_record ON table_record.oid = index_record.indrelid
      JOIN pg_namespace AS namespace_record ON namespace_record.oid = table_record.relnamespace
      JOIN LATERAL unnest(index_record.indkey) WITH ORDINALITY
        AS index_key(attnum, ordinality) ON TRUE
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = table_record.oid
       AND attribute.attnum = index_key.attnum
      WHERE namespace_record.nspname = current_schema()
        AND table_record.relname = 'invite_acceptance_consents'
      GROUP BY index_record.indexrelid, index_record.indisprimary, index_record.indisunique
    `;

    expect(indexes).toContainEqual({
      column_names: ['tenant_id', 'accepted_at'],
      is_primary: false,
      is_unique: false,
    });
  });

  it('keeps the staged invite acceptance snapshot nullable for existing pending rows', async () => {
    const columns = await catalogPrisma.$queryRaw<CatalogColumn[]>`
      SELECT column_name, is_nullable, udt_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'pending_invite_acceptances'
        AND column_name IN (
          'tenant_id',
          'disclaimer_version',
          'disclaimer_locale',
          'disclaimer_content_hash',
          'tenant_display_name',
          'program_summary',
          'program_summary_hash',
          'consent_accepted_at'
        )
      ORDER BY column_name
    `;

    expect(columns).toEqual([
      { column_name: 'consent_accepted_at', is_nullable: 'YES', udt_name: 'timestamp' },
      { column_name: 'disclaimer_content_hash', is_nullable: 'YES', udt_name: 'text' },
      { column_name: 'disclaimer_locale', is_nullable: 'YES', udt_name: 'text' },
      { column_name: 'disclaimer_version', is_nullable: 'YES', udt_name: 'text' },
      { column_name: 'program_summary', is_nullable: 'YES', udt_name: 'text' },
      { column_name: 'program_summary_hash', is_nullable: 'YES', udt_name: 'text' },
      { column_name: 'tenant_display_name', is_nullable: 'YES', udt_name: 'text' },
      { column_name: 'tenant_id', is_nullable: 'YES', udt_name: 'uuid' },
    ]);

    const defaults = await catalogPrisma.$queryRaw<CatalogColumnDefault[]>`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'pending_invite_acceptances'
        AND column_name IN (
          'tenant_id',
          'disclaimer_version',
          'disclaimer_locale',
          'disclaimer_content_hash',
          'tenant_display_name',
          'program_summary',
          'program_summary_hash',
          'consent_accepted_at'
        )
      ORDER BY column_name
    `;

    expect(defaults).toEqual([
      { column_name: 'consent_accepted_at', column_default: null },
      { column_name: 'disclaimer_content_hash', column_default: null },
      { column_name: 'disclaimer_locale', column_default: null },
      { column_name: 'disclaimer_version', column_default: null },
      { column_name: 'program_summary', column_default: null },
      { column_name: 'program_summary_hash', column_default: null },
      { column_name: 'tenant_display_name', column_default: null },
      { column_name: 'tenant_id', column_default: null },
    ]);
  });
});
