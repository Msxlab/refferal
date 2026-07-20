import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('members tree snapshot route contract', () => {
  const controller = readFileSync(join(__dirname, 'members.admin.controller.ts'), 'utf8');
  const service = readFileSync(join(__dirname, 'members.admin.service.ts'), 'utf8');
  const snapshot = readFileSync(join(__dirname, 'members.tree-snapshot.ts'), 'utf8');
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

  it('keeps the static route before :id and applies the tree authorization contract', () => {
    expect(controller).toMatch(
      /@Roles\(\.\.\.STAFF\)\s+@RequirePermission\(["']network\.view["'], ["']network\.financials\.view["']\)\s+@Get\(["']tree-snapshot["']\)/,
    );
    expect(controller.search(/@Get\(["']tree-snapshot["']\)/)).toBeLessThan(
      controller.search(/@Get\(["']:id["']\)/),
    );
  });

  it('separates count from the bounded selection inside a repeatable-read snapshot', () => {
    expect(snapshot).toMatch(/const TREE_SNAPSHOT_LIMIT = 500/);
    expect(snapshot).not.toMatch(/count\(\*\) OVER/i);
    expect(snapshot).toMatch(/take:\s*TREE_SNAPSHOT_LIMIT/);
    expect(service).toMatch(/Prisma\.TransactionIsolationLevel\.RepeatableRead/);
    expect(snapshot).toMatch(/scope:\s*{\s*complete:[\s\S]{0,120}total[\s\S]{0,120}limit:/);
  });

  it('declares and migrates the tenant snapshot ordering index', () => {
    expect(schema).toMatch(
      /@@index\(\[tenantId, depth, joinedAt, id\], map: "memberships_tenant_depth_joined_id_idx"\)/,
    );
    const migrationPath = join(
      __dirname,
      '../../prisma/migrations/20260720150000_members_tree_snapshot_index/migration.sql',
    );
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration).toMatch(
      /CREATE INDEX(?: CONCURRENTLY)? "memberships_tenant_depth_joined_id_idx"\s+ON "memberships"\("tenant_id", "depth", "joined_at", "id"\)/,
    );
  });
});
