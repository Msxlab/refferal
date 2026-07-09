# Tenant-Isolation & Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a defense-in-depth structural tenant-isolation backstop (Postgres RLS + a `@CurrentActor` choke point), migrate web sessions to httpOnly cookies with CSRF, land the first Playwright web E2E smoke suite + CI, move rate-limiting to Redis, and add a shared BigInt→string serializer — without weakening the existing DB triggers or the hand-written `where: { tenantId }` contract.

**Architecture:** The load-bearing isolation guarantee is **Postgres Row-Level Security** enforced in the DB (same trust boundary as the existing immutability triggers), threaded per-request via `SET LOCAL app.tenant_id` inside a transaction opened by a new `PrismaService.forActor(actor)` helper; platform reads run under a `SET LOCAL app.bypass_rls = 'on'` path gated by the existing `@PlatformAdmin()` guard. A second, dev-only Prisma `$extends` query hook throws on any un-scoped query so CI surfaces missing-`where` bugs loudly. A validated `@CurrentActor()` param-decorator replaces the 116 `user.tid as string` casts with a single fail-closed assertion. Session hardening moves the refresh token to an httpOnly cookie with a double-submit CSRF token; the access token becomes memory-only on the web client.

**Tech Stack:** NestJS 11 + Prisma 6 (`@prisma/client`) on Postgres 17; Jest (unit `test`, integration `test:int` via supertest, `runInBand`) + `tsc --noEmit` lint; Next.js 15 web (React 19); Playwright (new); Redis 7 (`ioredis` + `@nest-lab/throttler-storage-redis`, new); pnpm workspaces + turbo.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/api/src/common/actor.ts` | **Modify.** Extend `ActorContext` to the full validated shape `{ userId, tenantId, membershipId, role, perms, isPlatform }`. |
| `apps/api/src/auth/auth.guard.ts` | **Modify.** Add the `CurrentActor` param-decorator that validates `req.user` and throws if `tid`/`mid` null. |
| `apps/api/src/prisma/prisma.service.ts` | **Modify.** Add `forActor(actor)` (RLS `SET LOCAL` transaction helper), `forPlatform(work)` (bypass path), the dev-guard `$extends`, and the `MissingTenantScopeError` class. |
| `apps/api/src/prisma/tenant-scoped-models.ts` | **Create.** Single source of truth: the 25 tenant-scoped Prisma model names + their table names. |
| `apps/api/prisma/migrations/<ts>_rls_tenant_isolation/migration.sql` | **Create.** Enable + FORCE RLS and add SELECT/INSERT/UPDATE/DELETE policies for the 25 tables. |
| `apps/api/src/common/serialize.ts` | **Create.** `serializeCents` + `serializeMoney` shared helpers. |
| `apps/api/src/common/bigint-serializer.interceptor.ts` | **Create.** Global interceptor stringifying stray BigInts in responses (safety net). |
| `apps/api/src/app.module.ts` | **Modify.** Wire `ThrottlerModule.forRootAsync` to a Redis store (fallback in-memory when `REDIS_URL` unset); register the BigInt interceptor. |
| `apps/api/src/common/redis.ts` | **Create.** Lazy `ioredis` client factory (returns `null` when `REDIS_URL` unset). |
| `apps/api/src/payouts/payouts.controller.ts` | **Modify.** Migrate `private actor(user)` + `user.tid as string` reads to `@CurrentActor()`. |
| `apps/api/src/sales/sales.controller.ts` | **Modify.** Same migration as payouts. |
| `apps/api/src/auth/auth.controller.ts` | **Modify.** Set/clear the refresh + csrf cookies server-side on login/2fa/refresh/logout. |
| `apps/api/src/auth/csrf.guard.ts` | **Create.** Double-submit CSRF guard for non-GET requests. |
| `apps/api/src/main.ts` | **Modify.** Add `cookie-parser`; keep `credentials: true`. |
| `apps/web/src/lib/auth.ts` | **Modify.** Access token in a module variable; drop `localStorage` for tokens; csrf helper. |
| `apps/web/src/lib/api.ts` | **Modify.** `credentials: 'include'` + `X-CSRF-Token`; cookie-based refresh. |
| `apps/web/playwright.config.ts` | **Create.** Playwright config pointing at built web + seeded API. |
| `apps/web/tests/*.spec.ts` | **Create.** Four smoke specs: login, switch-tenant, sale-approve, payout-approve. |
| `apps/web/package.json` | **Modify.** Add `@playwright/test` + `test:e2e` script. |
| `.github/workflows/ci.yml` | **Create.** CI: API int specs (with RLS migration) → web build → Playwright. |
| `apps/api/test/rls-isolation.int-spec.ts` | **Create.** Integration tests proving cross-tenant reads/writes are blocked. |
| `apps/api/test/current-actor.int-spec.ts` | **Create.** Integration tests for `@CurrentActor` fail-closed behavior. |
| `apps/api/test/throttler-redis.int-spec.ts` | **Create.** Integration test for the Redis throttler store. |
| `apps/api/src/common/serialize.spec.ts` | **Create.** Unit test for `serializeCents` losslessness. |

---

## Tasks

> **Sequencing (from spec §Sequencing):** Task 1 (`@CurrentActor`) → Task 2–4 (RLS backstop) → Task 5 (BigInt serializer, low-risk, parallelizable) → Task 6 (Redis throttler) → Task 7 (Playwright + CI) → Task 8 (httpOnly cookies, after tests exist). Do them in this file order.

---

### Task 1: `@CurrentActor` decorator + widened `ActorContext`

**Files:**
- Modify: `apps/api/src/common/actor.ts`
- Modify: `apps/api/src/auth/auth.guard.ts:43` (add `CurrentActor` next to `CurrentUser`)
- Test: `apps/api/test/current-actor.int-spec.ts`

- [ ] **Step 1: Write the failing test.** Create `apps/api/test/current-actor.int-spec.ts`. It mounts the real `AppModule` (same bootstrap as `payouts.int-spec.ts`), then hits a tenant-scoped controller with (a) a valid token → 200, (b) a token with `mid=null`/`tid=null` → 403 `aktif uyelik gerekli`.

```typescript
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { authConfig } from '../src/auth/auth.config';
import { AccessTokenPayload } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlan, createTenant, truncateAll } from './helpers';

describe('@CurrentActor fail-closed (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  function token(p: Partial<AccessTokenPayload> & { sub: string }): string {
    const payload: AccessTokenPayload = { mid: null, tid: null, role: null, ...p };
    return jwt.sign(payload, { secret: authConfig.accessSecret(), expiresIn: authConfig.accessTtlSeconds });
  }

  async function ownerScenario() {
    const tenant = await createTenant(prisma);
    await createPlan(prisma, tenant.id);
    const [owner] = await createChain(prisma, tenant.id, 1);
    await prisma.membership.update({ where: { id: owner.id }, data: { role: Role.tenant_owner } });
    return { tenant, owner };
  }

  it('valid actor -> 200 on a tenant-scoped route', async () => {
    const { tenant, owner } = await ownerScenario();
    const tok = token({ sub: owner.userId, mid: owner.id, tid: tenant.id, role: Role.tenant_owner });
    await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);
  });

  it('null mid/tid on a @RequireMembership route -> 403 (fail-closed before any query)', async () => {
    const { owner } = await ownerScenario();
    // role present but no active membership selected: @RequireMembership guard already 403s,
    // and @CurrentActor would too. Assert the 403 contract.
    const tok = token({ sub: owner.userId, mid: null, tid: null, role: Role.tenant_owner });
    await request(app.getHttpServer())
      .get('/v1/admin/payouts/payable')
      .set('Authorization', `Bearer ${tok}`)
      .expect(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** From repo root:
```
pnpm --filter @refearn/api test:int -- current-actor
```
Expected: the first test currently passes, but this file also imports the not-yet-exported `CurrentActor` only in Task 1 Step 3's controller edits — at this point the file compiles (it does not import `CurrentActor`). Both tests should PASS against current code (the `@RequireMembership` guard already 403s on null `mid`). This test locks in the contract before we refactor controllers; run it to confirm the harness is wired: expected output `Tests: 2 passed`.

- [ ] **Step 3: Write minimal implementation.** Widen `ActorContext` and add the decorator.

Replace the body of `apps/api/src/common/actor.ts` with:
```typescript
import { Role } from '@prisma/client';

/**
 * Istek sahibi (actor) baglami: JWT claim'lerinden TUM alanlar dogrulanmis olarak
 * turetilir (bkz. @CurrentActor). tenantId/membershipId non-null GARANTIsi vardir —
 * `user.tid as string` yalanini tek noktada gercek bir assertion'a cevirir.
 */
export interface ActorContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: Role;
  perms: string[];
  isPlatform: boolean;
}
```

In `apps/api/src/auth/auth.guard.ts`, add the decorator directly after `CurrentUser` (after line 46). Also add `Role` to the existing `@prisma/client` import (it is already imported on line 14) and import `ActorContext`:
```typescript
import { ActorContext } from '../common/actor';
```
Then append:
```typescript
/**
 * Tenant-scoped rotalar icin dogrulanmis actor baglami. tid/mid null ise ForbiddenException
 * atar (fail-closed) — `user.tid as string` cast'lerini TEK yerde gercek assertion yapar.
 * Platform (@PlatformAdmin, tenant-siz) rotalari @CurrentUser kullanmaya devam eder.
 */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): ActorContext => {
  const req = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();
  const u = req.user;
  if (!u.tid || !u.mid || !u.role) {
    throw new ForbiddenException('aktif uyelik gerekli');
  }
  return {
    userId: u.sub,
    tenantId: u.tid,
    membershipId: u.mid,
    role: u.role,
    perms: u.perms ?? [],
    isPlatform: u.plat === true,
  };
});
```

Now migrate `apps/api/src/payouts/payouts.controller.ts` and `apps/api/src/sales/sales.controller.ts` to use it. In `payouts.controller.ts`:
- Change the import on line 4 to `import { CurrentActor, CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';`
- Delete the `private actor(user: RequestUser): ActorContext { ... }` method (lines 31-33).
- Replace each `@CurrentUser() user: RequestUser` + `this.actor(user)` / `user.tid as string` pair with `@CurrentActor() actor: ActorContext` and pass `actor` / `actor.tenantId`. Concretely:
  - `payable`: `payable(@CurrentActor() actor: ActorContext) { return this.payouts.payable(actor.tenantId); }`
  - `run`: `run(@CurrentActor() actor: ActorContext, @Body(...) body: RunPayoutInput) { return this.payouts.run(actor, body); }`
  - `list`: `list(@CurrentActor() actor: ActorContext, @Query(...) q: ListPayoutsInput) { return this.payouts.list(actor.tenantId, { ...q, status: q.status as PayoutStatus | undefined }); }`
  - `export`: use `actor.tenantId` in place of `user.tid as string`.
  - `ach`: use `actor.tenantId`.
  - `reconcile`: `this.payouts.reconcile(actor, body.rows)`.
  - `batches`: `this.payouts.listBatches(actor.tenantId)`.
  - `approveBatch`/`rejectBatch`: `this.payouts.approveBatch(actor, id)` / `rejectBatch(actor, id)`.
  - `detail`: `this.payouts.detail(actor.tenantId, id)`.
  - `decide`/`retry`: `this.payouts.decide(actor, id, body)` / `retry(actor, id)`.
  - The `AppPayoutsController` methods use `user.mid`/`user.tid`; migrate `request` to `@CurrentActor() actor: ActorContext` → `this.payouts.requestPayout(actor.membershipId, actor.tenantId)`, and `mine` → `this.payouts.listMine(actor.membershipId)`.

In `sales.controller.ts`: change the import on line 16 to add `CurrentActor`, delete `private actor(user)` (lines 49-51), and replace `@CurrentUser() user: RequestUser` + `this.actor(user)` / `user.tid as string` with `@CurrentActor() actor: ActorContext` throughout, passing `actor` / `actor.tenantId`.

> Because service signatures already accept the old two-field `ActorContext` (`{ userId, tenantId }`), the widened interface is a superset — no service changes are required for compilation; services simply ignore the extra fields.

- [ ] **Step 4: Run test to verify it passes.**
```
pnpm --filter @refearn/api test:int -- current-actor
pnpm --filter @refearn/api lint
```
Expected: `Tests: 2 passed`, and `lint` (tsc `--noEmit`) exits 0 with no errors.

- [ ] **Step 5: Commit.**
```
git add -A && git commit -m "feat(api): @CurrentActor choke point replacing user.tid as string casts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Tenant-scoped model registry

**Files:**
- Create: `apps/api/src/prisma/tenant-scoped-models.ts`
- Test: (compile-checked; exercised by Task 3/4 tests)

- [ ] **Step 1: Write the registry** (no separate test — it is a data table consumed by later tasks; correctness is proven by Task 4's RLS tests). Create `apps/api/src/prisma/tenant-scoped-models.ts`:
```typescript
/**
 * 25 tenant-scoped model — RLS politikalari ve dev-guard extension'in TEK dogruluk kaynagi.
 * `Tenant` root'tur, `User` globaldir; ikisi de burada YOK. Tablo adlari schema.prisma @@map ile birebir.
 */
export const TENANT_SCOPED_MODELS = [
  'TenantBilling', 'Invoice', 'TenantRole', 'Membership', 'Invite', 'InviteEvent',
  'CommissionPlan', 'Sale', 'LedgerEntry', 'MonthlySummary', 'TeamStat', 'Payout',
  'Notification', 'AuditLog', 'Campaign', 'SavedView', 'PayoutProfile', 'FraudFlag',
  'SurveyResponse', 'RankTier', 'PayoutBatch', 'Announcement', 'PeriodLock', 'ApiKey',
  'ReportSubscription',
] as const;

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

/** Prisma model adi -> Postgres tablo adi (schema.prisma @@map). RLS migration ile birebir. */
export const TENANT_SCOPED_TABLES: Record<TenantScopedModel, string> = {
  TenantBilling: 'tenant_billing',
  Invoice: 'invoices',
  TenantRole: 'roles',
  Membership: 'memberships',
  Invite: 'invites',
  InviteEvent: 'invite_events',
  CommissionPlan: 'commission_plans',
  Sale: 'sales',
  LedgerEntry: 'ledger_entries',
  MonthlySummary: 'monthly_summaries',
  TeamStat: 'team_stats',
  Payout: 'payouts',
  Notification: 'notifications',
  AuditLog: 'audit_logs',
  Campaign: 'campaigns',
  SavedView: 'saved_views',
  PayoutProfile: 'payout_profiles',
  FraudFlag: 'fraud_flags',
  SurveyResponse: 'survey_responses',
  RankTier: 'rank_tiers',
  PayoutBatch: 'payout_batches',
  Announcement: 'announcements',
  PeriodLock: 'period_locks',
  ApiKey: 'api_keys',
  ReportSubscription: 'report_subscriptions',
};

const MODEL_SET: ReadonlySet<string> = new Set(TENANT_SCOPED_MODELS);
export function isTenantScopedModel(model: string | undefined): model is TenantScopedModel {
  return model !== undefined && MODEL_SET.has(model);
}
```

- [ ] **Step 2: Verify it compiles.**
```
pnpm --filter @refearn/api lint
```
Expected: exits 0.

- [ ] **Step 3: Commit.**
```
git add -A && git commit -m "chore(api): tenant-scoped model+table registry for RLS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: RLS migration (enable + FORCE + policies)

**Files:**
- Create: `apps/api/prisma/migrations/20260709120000_rls_tenant_isolation/migration.sql`
- Test: exercised in Task 4.

> **Decision gate: assumes Postgres RLS (spec's recommended option b).** If a Prisma `$extends` runtime query-hook is chosen instead of RLS, Tasks 3–4 change as follows: delete this SQL migration; move the isolation guarantee into `prisma.service.ts` as a runtime (not dev-only) `$extends` hook that injects `tenantId` into `args.where` for the 25 models and hard-errors on cross-tenant intent; Task 4's tests then assert the extension blocks the read/write (the DB itself would still return rows, so tests must go through the Prisma client, not `$queryRawUnsafe`). RLS is retained here because it also covers the raw-SQL CSV/report paths a query-hook cannot intercept.

- [ ] **Step 1: Write the migration.** Create `apps/api/prisma/migrations/20260709120000_rls_tenant_isolation/migration.sql`. It enables + FORCEs RLS on the 25 tables and adds a permissive policy keyed on `app.tenant_id` with a `bypass_rls` escape. Uses a DO-loop so the 25 tables share one policy definition:
```sql
-- RLS tenant izolasyonu (SPEC item 1b). Defense-in-depth: el yazimi where:{tenantId} BIRINCIL
-- sozlesme olarak kalir; bu katman KACIRILAN filtreyi DB'de yakalar (fail-closed: politika yok -> satir yok).
-- app.tenant_id GUC'u PrismaService.forActor icinde SET LOCAL ile aktarilir; platform app.bypass_rls='on' kullanir.
-- Mevcut immutability trigger'lariyla ORTOGONAL (politika gorunurluk filtreler, trigger degismezlik zorlar).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'tenant_billing','invoices','roles','memberships','invites','invite_events',
    'commission_plans','sales','ledger_entries','monthly_summaries','team_stats','payouts',
    'notifications','audit_logs','campaigns','saved_views','payout_profiles','fraud_flags',
    'survey_responses','rank_tiers','payout_batches','announcements','period_locks','api_keys',
    'report_subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    -- FORCE: tablo sahibi (migration/uygulama rolu) da politikalara TABI olur.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);

    -- Okuma/silme/guncelleme gorunurlugu: satirin tenant_id'si aktif GUC ile eslesmeli VEYA bypass acik.
    EXECUTE format($f$
      CREATE POLICY rls_tenant_isolation ON %I
      USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = current_setting('app.tenant_id', true)::uuid
      )
      WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = current_setting('app.tenant_id', true)::uuid
      );
    $f$, t);
  END LOOP;
END $$;
```

> **`current_setting(..., true)` returns NULL/'' when the GUC is unset** → the `::uuid` cast of `''` would error, but because the `USING`/`WITH CHECK` predicate is `tenant_id = ''::uuid` only when `bypass_rls <> 'on'` AND the setting is present, we must guard the empty case. Postgres short-circuits `OR`, but the right-hand cast still evaluates. To make "no GUC set → zero rows" (fail-closed) instead of an error, the policy below uses `NULLIF(current_setting('app.tenant_id', true), '')::uuid`, which yields SQL `NULL` (no match) rather than a cast error. Replace both predicate bodies accordingly:

```sql
      USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      )
      WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      )
```

Use the `NULLIF` form in the final file.

- [ ] **Step 2: Verify the migration applies to the test DB.** From `apps/api`:
```
pnpm --filter @refearn/api exec prisma migrate deploy
```
against the test DB URL (the harness's `global-setup.ts` runs this automatically; run it once manually to confirm it applies cleanly):
```
DATABASE_URL="postgresql://refearn:refearn@localhost:5434/refearn_test" pnpm --filter @refearn/api exec prisma migrate deploy
```
Expected output includes `Applying migration 20260709120000_rls_tenant_isolation` and `All migrations have been successfully applied.`

- [ ] **Step 3: Verify existing suite is still green under RLS** (before threading — proves policies don't break the app because the app currently connects as the table-owning role and *no* `app.tenant_id` is set, so FORCE RLS would return zero rows and break everything). **This step is expected to FAIL** and demonstrates why Task 4's `SET LOCAL` threading is mandatory:
```
pnpm --filter @refearn/api test:int -- payouts
```
Expected: failures (queries return zero rows). Do NOT commit yet — proceed to Task 4 which adds the threading that makes the app work under RLS. If you must keep CI green between tasks, gate the migration behind the roll-out flag described in Task 4 Step 3 (the `SET LOCAL app.bypass_rls='on'` default for un-threaded connections). **Recommended: implement Task 4 before running the full suite.**

- [ ] **Step 4: Commit** (migration + Task 4 together is acceptable; if committing alone, note it is not yet wired):
```
git add apps/api/prisma/migrations && git commit -m "feat(db): RLS policies on 25 tenant-scoped tables (not yet threaded)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `SET LOCAL` threading (`forActor`/`forPlatform`) + dev-guard extension

**Files:**
- Modify: `apps/api/src/prisma/prisma.service.ts`
- Test: `apps/api/test/rls-isolation.int-spec.ts`

- [ ] **Step 1: Write the failing test.** Create `apps/api/test/rls-isolation.int-spec.ts`. It seeds two tenants, then proves via `forActor` that tenant A's session sees zero of tenant B's rows even with a bare (no-`where`) query, that a cross-tenant INSERT is rejected, that `forPlatform` sees both, and that the dev-guard throws on an un-scoped query.
```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActorContext } from '../src/common/actor';
import { createChain, createPlan, createSale, createTenant, truncateAll } from './helpers';

describe('RLS tenant izolasyonu (entegrasyon)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await truncateAll(prisma); });

  async function twoTenants() {
    const tA = await createTenant(prisma);
    const tB = await createTenant(prisma);
    await createPlan(prisma, tA.id);
    await createPlan(prisma, tB.id);
    const [aOwner] = await createChain(prisma, tA.id, 1);
    const [bOwner] = await createChain(prisma, tB.id, 1);
    const saleA = await createSale(prisma, tA.id, aOwner.id, 5_000n);
    const saleB = await createSale(prisma, tB.id, bOwner.id, 7_000n);
    return { tA, tB, aOwner, bOwner, saleA, saleB };
  }

  function actorFor(tenantId: string, membershipId: string, userId: string): ActorContext {
    return { tenantId, membershipId, userId, role: Role.tenant_owner, perms: [], isPlatform: false };
  }

  it('(a) tenant A session cannot read tenant B sales even with no where-clause', async () => {
    const { tA, aOwner, saleB } = await twoTenants();
    const rows = await prisma.forActor(actorFor(tA.id, aOwner.id, aOwner.userId), (tx) =>
      // deliberately UN-scoped findMany: RLS must still hide tenant B
      tx.sale.findMany(),
    );
    expect(rows.every((r) => r.tenantId === tA.id)).toBe(true);
    expect(rows.find((r) => r.id === saleB.id)).toBeUndefined();
  });

  it('(b) INSERT with another tenant\'s tenant_id under session A is rejected by WITH CHECK', async () => {
    const { tA, tB, aOwner } = await twoTenants();
    await expect(
      prisma.forActor(actorFor(tA.id, aOwner.id, aOwner.userId), (tx) =>
        tx.sale.create({
          data: { tenantId: tB.id, sellerMembershipId: aOwner.id, amountCents: 1_000n, saleDate: new Date() },
        }),
      ),
    ).rejects.toThrow();
  });

  it('(d) platform bypass reads all tenants; actor path reads only its own', async () => {
    const { tA, aOwner, saleA, saleB } = await twoTenants();
    const all = await prisma.forPlatform((tx) => tx.sale.findMany());
    expect(all.find((r) => r.id === saleA.id)).toBeDefined();
    expect(all.find((r) => r.id === saleB.id)).toBeDefined();

    const scoped = await prisma.forActor(actorFor(tA.id, aOwner.id, aOwner.userId), (tx) => tx.sale.findMany());
    expect(scoped.find((r) => r.id === saleB.id)).toBeUndefined();
  });

  it('(e) dev-guard extension throws on an un-scoped findMany outside a forActor tx', async () => {
    await twoTenants();
    // Direct client access to a tenant-scoped model with no tenantId in where and no allowCrossTenant -> throws.
    await expect(prisma.sale.findMany({})).rejects.toThrow(/MissingTenantScope|tenant/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**
```
pnpm --filter @refearn/api test:int -- rls-isolation
```
Expected: fails with `prisma.forActor is not a function` (method not yet added).

- [ ] **Step 3: Write minimal implementation.** Replace `apps/api/src/prisma/prisma.service.ts` with:
```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { isTenantScopedModel } from './tenant-scoped-models';

/** Dev/test'te: tenant-scoped bir model'e tenantId (veya allowCrossTenant) olmadan sorgu atilirsa firlatilir. */
export class MissingTenantScopeError extends Error {
  constructor(model: string, op: string) {
    super(`MissingTenantScope: ${model}.${op} tenantId filtresi (veya allowCrossTenant) olmadan cagrildi`);
    this.name = 'MissingTenantScopeError';
  }
}

// forActor/forPlatform icindeki tx'lerde dev-guard'i atlamak icin async-local bayrak.
let insideScopedTx = false;

// Prisma tx client tipi (extension'lardan bagimsiz cekirdek istemci).
type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const DEV = process.env.NODE_ENV !== 'production';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    if (DEV) {
      // Layer (a): dev-time assist. tenant-scoped model'e scope'suz sorgu -> LOUD hata (CI'da yakalanir).
      // RLS (layer b) runtime GARANTIsidir; bu yalniz eksik-where bug'unu testte yuzeye cikarir.
      return this.$extends({
        query: {
          $allModels: {
            $allOperations({ model, operation, args, query }) {
              if (insideScopedTx || !isTenantScopedModel(model)) return query(args);
              const READ_WRITE = ['findFirst', 'findMany', 'findFirstOrThrow', 'updateMany', 'deleteMany', 'aggregate', 'groupBy', 'count'];
              if (!READ_WRITE.includes(operation)) return query(args); // create/upsert/findUnique(id) vs. — RLS zaten zorlar
              const a = (args ?? {}) as { where?: Record<string, unknown>; allowCrossTenant?: boolean };
              const w = a.where ?? {};
              const scoped = 'tenantId' in w || a.allowCrossTenant === true;
              if (!scoped) throw new MissingTenantScopeError(model as string, operation);
              // allowCrossTenant bir sorgu argumani DEGIL — Prisma'ya sizmadan once ayikla.
              if ('allowCrossTenant' in a) delete (a as Record<string, unknown>).allowCrossTenant;
              return query(a);
            },
          },
        },
      }) as unknown as this;
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Tenant-scoped is: SET LOCAL app.tenant_id ile bir transaction acar, RLS o tx boyunca aktiftir.
   * SET LOCAL yalniz bu tx'te yasar — pooled connection'a sizmaz (bkz. SPEC pgbouncer notu).
   */
  async forActor<T>(actor: ActorContext, work: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      // $executeRawUnsafe: SET LOCAL parametrelestirilemez; uuid'yi guvenli sekilde quote et.
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${escapeUuid(actor.tenantId)}'`);
      insideScopedTx = true;
      try {
        return await work(tx as unknown as TxClient);
      } finally {
        insideScopedTx = false;
      }
    });
  }

  /** Platform (kiracci-ustu) is: app.bypass_rls='on' — @PlatformAdmin ile yetki-kapili, ambient DEGIL. */
  async forPlatform<T>(work: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'on'`);
      insideScopedTx = true;
      try {
        return await work(tx as unknown as TxClient);
      } finally {
        insideScopedTx = false;
      }
    });
  }
}

/** uuid whitelisting: yalniz [0-9a-f-] kabul et; aksi halde fail-closed. SQL injection'a kapali. */
function escapeUuid(id: string): string {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    throw new MissingTenantScopeError('forActor', 'invalid-uuid');
  }
  return id;
}
```

> **Trigger compatibility (spec §"Keeping DB triggers compatible"):** `forActor` opens exactly one `$transaction`; the `DEFERRABLE INITIALLY DEFERRED` plan-level-rate constraint triggers fire at COMMIT of that same tx, after `SET LOCAL app.tenant_id`. No trigger reads `tenant_id` via RLS, so none regress. `SET LOCAL` is scoped to the tx and cannot leak across pooled connections.

Test-env note: the `beforeEach` `truncateAll` uses `prisma.$executeRawUnsafe(TRUNCATE ...)` directly on the base client — TRUNCATE is not a tenant-scoped model op, so the dev-guard ignores it. `createTenant`/`createChain`/`createSale` helpers use `findUnique`/`create` (not in the guard's `READ_WRITE` list), so seeding is unaffected.

- [ ] **Step 4: Run test to verify it passes, then the full suite.**
```
pnpm --filter @refearn/api test:int -- rls-isolation
pnpm --filter @refearn/api test:int
pnpm --filter @refearn/api lint
```
Expected: `rls-isolation` → 4 passed. **Full suite:** if any existing spec fails with `MissingTenantScopeError`, that spec has an un-scoped `findMany` on a tenant-scoped model in TEST-side assertions (e.g. `helpers.ts` `netLedger`/`summaryTotals` use `beneficiaryMembershipId`/`membershipId`, not `tenantId`). For those helper reads that are legitimately membership-scoped (not tenant-scoped where-clauses), pass `allowCrossTenant: true` — but ONLY in test helpers, and document why. Update `apps/api/test/helpers.ts`:
  - `netLedger`: `prisma.ledgerEntry.findMany({ where: { beneficiaryMembershipId: membershipId }, allowCrossTenant: true })`
  - `summaryTotals`: `prisma.monthlySummary.findMany({ where: { membershipId }, allowCrossTenant: true })`
  Re-run until the full suite is green (spec test (f): "Full existing 43-spec suite is green").

> If any *production* service query trips the guard, that is a real missing-`where` bug the guard was designed to catch — fix the service by adding `where: { tenantId }`, do NOT add `allowCrossTenant`. Platform service cross-tenant `groupBy`/`aggregate` (`platform.service.ts:21-40`) must be wrapped in `allowCrossTenant: true` on each such call (they are legitimately cross-tenant and `@PlatformAdmin`-gated at the controller).

- [ ] **Step 5: Commit.**
```
git add -A && git commit -m "feat(api): SET LOCAL RLS threading (forActor/forPlatform) + dev-guard extension

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: BigInt/JSON serialization discipline

**Files:**
- Create: `apps/api/src/common/serialize.ts`
- Create: `apps/api/src/common/bigint-serializer.interceptor.ts`
- Modify: `apps/api/src/app.module.ts` (register interceptor)
- Test: `apps/api/src/common/serialize.spec.ts`

- [ ] **Step 1: Write the failing unit test.** Create `apps/api/src/common/serialize.spec.ts`:
```typescript
import { serializeCents, serializeMoney } from './serialize';

describe('serializeCents / serializeMoney', () => {
  it('round-trips a value above 2^53 losslessly as a string', () => {
    const v = 9007199254740993n; // 2^53 + 1 — Number() would lose precision
    expect(serializeCents(v)).toBe('9007199254740993');
    expect(BigInt(serializeCents(v))).toBe(v);
  });

  it('serializeMoney stringifies only the named bigint keys', () => {
    const row = { id: 'x', amountCents: 500n, count: 3, note: 'ok' as string };
    const out = serializeMoney(row, ['amountCents']);
    expect(out).toEqual({ id: 'x', amountCents: '500', count: 3, note: 'ok' });
  });

  it('serializeMoney leaves null bigint keys as null', () => {
    const row = { totalCents: null as bigint | null };
    expect(serializeMoney(row, ['totalCents'])).toEqual({ totalCents: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**
```
pnpm --filter @refearn/api test -- serialize
```
Expected: fails — `Cannot find module './serialize'`.

- [ ] **Step 3: Write minimal implementation.** Create `apps/api/src/common/serialize.ts`:
```typescript
/** Cents (BigInt) -> string. API sinirinda para HER ZAMAN string (frontend format.ts Number()-parse eder). */
export function serializeCents(v: bigint): string {
  return v.toString();
}

/**
 * Objedeki belirtilen bigint alanlari (cents) string'e cevirir; digerlerine dokunmaz.
 * null degerler null kalir. Yeni obje doner (mutasyon yok).
 */
export function serializeMoney<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): { [P in keyof T]: P extends K ? (T[P] extends bigint ? string : T[P]) : T[P] } {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'bigint') out[k as string] = val.toString();
  }
  return out as { [P in keyof T]: P extends K ? (T[P] extends bigint ? string : T[P]) : T[P] };
}
```

Create `apps/api/src/common/bigint-serializer.interceptor.ts` (global safety net — a *forgotten* `.toString()` degrades to a correct string, not a 500):
```typescript
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Yanit govdesindeki serbest BigInt'leri string'e cevirir (unutulan .toString() 500 yerine string olur). */
function deepStringifyBigInt(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(deepStringifyBigInt);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepStringifyBigInt(v);
    return out;
  }
  return value;
}

@Injectable()
export class BigIntSerializerInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => deepStringifyBigInt(body)));
  }
}
```

In `apps/api/src/app.module.ts`, add the import and register it as a global interceptor. Add to imports:
```typescript
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BigIntSerializerInterceptor } from './common/bigint-serializer.interceptor';
```
(replace the existing `import { APP_FILTER, APP_GUARD } from '@nestjs/core';` line). Then in `providers` add:
```typescript
    { provide: APP_INTERCEPTOR, useClass: BigIntSerializerInterceptor },
```

- [ ] **Step 4: Run tests to verify they pass.**
```
pnpm --filter @refearn/api test -- serialize
pnpm --filter @refearn/api test:int -- payouts
pnpm --filter @refearn/api lint
```
Expected: unit `3 passed`; `payouts` int spec still green (interceptor must not alter already-stringified money — the existing assertions like `.toBe('1000000')` still hold because those are already strings and the interceptor leaves strings untouched).

- [ ] **Step 5: Commit.**
```
git add -A && git commit -m "feat(api): shared serializeCents/serializeMoney + global BigInt response interceptor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Throttler → Redis store (fallback in-memory)

**Files:**
- Create: `apps/api/src/common/redis.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json` (add `ioredis`, `@nest-lab/throttler-storage-redis`)
- Test: `apps/api/test/throttler-redis.int-spec.ts`

- [ ] **Step 1: Add dependencies.** From repo root:
```
pnpm --filter @refearn/api add ioredis @nest-lab/throttler-storage-redis
```
Expected: both appear under `apps/api/package.json` dependencies.

- [ ] **Step 2: Write the failing test.** Create `apps/api/test/throttler-redis.int-spec.ts`. Because the test env sets `skipIf: () => isTest`, this test verifies the *store wiring* (that a Redis store is constructed when `REDIS_URL` is set and falls back otherwise), not live limiting. It asserts the factory returns a Redis-backed storage object when `REDIS_URL` is present and `null` otherwise:
```typescript
import { makeThrottlerStorage } from '../src/app.module';

describe('throttler redis store secimi', () => {
  const orig = process.env.REDIS_URL;
  afterEach(() => { if (orig === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = orig; });

  it('REDIS_URL yoksa null (in-memory fallback)', () => {
    delete process.env.REDIS_URL;
    expect(makeThrottlerStorage()).toBeNull();
  });

  it('REDIS_URL varsa bir storage nesnesi doner', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const s = makeThrottlerStorage();
    expect(s).not.toBeNull();
    // ioredis lazy connect — baglanti acmadan nesne olusur
    expect(typeof (s as { increment?: unknown }).increment).toBe('function');
  });
});
```

- [ ] **Step 3: Run test to verify it fails.**
```
pnpm --filter @refearn/api test:int -- throttler-redis
```
Expected: fails — `makeThrottlerStorage` is not exported.

- [ ] **Step 4: Write minimal implementation.** Create `apps/api/src/common/redis.ts`:
```typescript
import Redis from 'ioredis';

/** REDIS_URL varsa lazy (bagli-olmayan) ioredis istemcisi; yoksa null (in-memory fallback). */
export function makeRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  // lazyConnect: modul yuklenirken TCP acilmaz; ilk komutta baglanir (test/import guvenli).
  // maxRetriesPerRequest null + fail-open: Redis blip auth'u dusurmesin (SPEC edge case).
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null, enableOfflineQueue: true });
}
```

In `apps/api/src/app.module.ts`, replace the static `ThrottlerModule.forRoot(...)` with an exported storage factory + async config. Add imports:
```typescript
import { ThrottlerGuard, ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { makeRedis } from './common/redis';
```
Add, above the `@Module`:
```typescript
/** Redis-backed throttler storage (cluster-wide limit) veya null (tek-instance in-memory). */
export function makeThrottlerStorage(): ThrottlerStorage | null {
  const redis = makeRedis();
  return redis ? new ThrottlerStorageRedisService(redis) : null;
}
```
Replace the `ThrottlerModule.forRoot({...})` entry in `imports` with:
```typescript
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const storage = makeThrottlerStorage();
        return {
          throttlers: [{ ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMIT }],
          skipIf: () => isTest, // mevcut 43 spec'i tetiklemesin (korunuyor)
          ...(storage ? { storage } : {}), // REDIS_URL yoksa in-memory'ye duser
        };
      },
    }),
```

> `THROTTLE_TTL_MS`/`THROTTLE_LIMIT` values are unchanged (spec constraint). `X-Forwarded-For` is already trusted (`main.ts:15`) so per-IP keys stay correct behind Caddy. Redis-down fail-open: `enableOfflineQueue: true` + the store's own error handling serves rather than rejecting (spec: "fail-open with alert").

- [ ] **Step 5: Run test + suite to verify.**
```
pnpm --filter @refearn/api test:int -- throttler-redis
pnpm --filter @refearn/api test:int
pnpm --filter @refearn/api lint
```
Expected: `throttler-redis` → 2 passed; full suite green (throttler still `skipIf` in tests); lint 0.

- [ ] **Step 6: Commit.**
```
git add -A && git commit -m "feat(api): Redis-backed throttler store with in-memory fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Playwright smoke suite + CI

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/tests/login.spec.ts`, `switch-tenant.spec.ts`, `sale-approve.spec.ts`, `payout-approve.spec.ts`
- Create: `apps/web/tests/seed.ts` (invokes the API seed path)
- Modify: `apps/web/package.json` (add `@playwright/test`, `test:e2e`)
- Create: `.github/workflows/ci.yml`

> **Web has zero tests and no runner today** (spec §3). Playwright is introduced here. There is no web unit-test runner; web-only verification elsewhere in this plan uses `pnpm --filter @refearn/web lint` (`tsc --noEmit`) + manual steps.

- [ ] **Step 1: Add Playwright.** From repo root:
```
pnpm --filter @refearn/web add -D @playwright/test
pnpm --filter @refearn/web exec playwright install --with-deps chromium
```
Add to `apps/web/package.json` scripts:
```json
    "test:e2e": "playwright test"
```

- [ ] **Step 2: Write the config and seed helper.** Create `apps/web/playwright.config.ts`:
```typescript
import { defineConfig, devices } from '@playwright/test';

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false, // seed shares one DB; keep deterministic (smoke suite)
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: WEB,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // In CI the web server + API are started by the workflow; locally assume both already running.
});
```

Create `apps/web/tests/seed.ts` — it seeds deterministic fixtures by calling the API's seed script over a child process (reusing the existing seed path referenced by `apps/api/prisma/seed.ts`), and exposes the known credentials:
```typescript
import { execSync } from 'node:child_process';
import * as path from 'node:path';

/** E2E fixtures: API seed script'ini calistirir (idempotent). Bilinen kimlikler asagida. */
export function seedE2E(): void {
  const apiDir = path.resolve(__dirname, '../../api');
  execSync('pnpm exec ts-node prisma/seed.ts', {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_E2E ?? process.env.DATABASE_URL },
    stdio: 'inherit',
  });
}

// seed.ts'in urettigi bilinen hesaplar — seed script'iyle SENKRON tutulmali.
export const E2E = {
  owner: { email: 'owner@acme.test', password: 'password1234' },
  multiTenant: { email: 'multi@acme.test', password: 'password1234' },
};
```

> **Verification note:** before writing the specs, READ `apps/api/prisma/seed.ts` to confirm the exact seeded emails/passwords and multi-membership user, and update the `E2E` constants + the assertions below to match. If the seed does not create a multi-tenant user or an approvable sale/payout, extend `seed.ts` (the API seed) minimally to do so — the four smoke flows require: one admin/owner, one multi-membership user, one draft sale, one payable payout. This is the only place web tests depend on seed shape.

- [ ] **Step 3: Write the four smoke specs.** These are greenfield; the interfaces below define the behavior to verify. READ the actual login page + dashboard route markup under `apps/web/src/app/` to get exact selectors, then fill them in. Each spec's *contract*:

`apps/web/tests/login.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';
import { seedE2E, E2E } from './seed';

test.beforeAll(() => seedE2E());

test('login lands on dashboard and (post-cookie-migration) stores no tokens in localStorage', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(E2E.owner.email);
  await page.getByLabel(/password/i).fill(E2E.owner.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/admin|\/app|\/platform/);
  // Post-item-8: access token is memory-only, refresh token is httpOnly cookie.
  const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(stored).not.toContain('refreshToken');
});
```

`apps/web/tests/switch-tenant.spec.ts` (isolation smoke):
```typescript
import { test, expect } from '@playwright/test';
import { seedE2E, E2E } from './seed';

test.beforeAll(() => seedE2E());

test('switching tenant shows the new tenant data and hides the previous tenant data', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(E2E.multiTenant.email);
  await page.getByLabel(/password/i).fill(E2E.multiTenant.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/admin|\/app/);

  // Open the tenant switcher and pick the second membership. (Selector: read the real switcher component.)
  await page.getByRole('button', { name: /switch|tenant|company/i }).click();
  const before = await page.textContent('body');
  await page.getByRole('menuitem', { name: /second|beta/i }).click();
  await expect
    .poll(async () => page.textContent('body'))
    .not.toBe(before); // data changed → isolation smoke (prev tenant's rows gone)
});
```

`apps/web/tests/sale-approve.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';
import { seedE2E, E2E } from './seed';

test.beforeAll(() => seedE2E());

test('admin approves a draft sale and a commission is credited', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(E2E.owner.email);
  await page.getByLabel(/password/i).fill(E2E.owner.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  await page.goto('/admin/sales');
  await page.getByRole('row', { name: /draft/i }).first().getByRole('button', { name: /approve/i }).click();
  await expect(page.getByText(/approved/i)).toBeVisible();
});
```

`apps/web/tests/payout-approve.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';
import { seedE2E, E2E } from './seed';

test.beforeAll(() => seedE2E());

test('admin approves a payable payout and status transitions', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(E2E.owner.email);
  await page.getByLabel(/password/i).fill(E2E.owner.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  await page.goto('/admin/payouts');
  await page.getByRole('button', { name: /run|approve|pay/i }).first().click();
  await expect(page.getByText(/paid|approved|processed/i)).toBeVisible();
});
```

- [ ] **Step 4: Run the suite locally.** Start Postgres+Redis, migrate, seed, run API + web, then Playwright:
```
docker compose up -d postgres redis
pnpm --filter @refearn/api db:deploy
pnpm --filter @refearn/api build && pnpm --filter @refearn/web build
# in separate shells (or backgrounded): pnpm dev:api ; pnpm --filter @refearn/web start
pnpm --filter @refearn/web test:e2e
```
Expected: `4 passed`. If selectors mismatch, fix them against the real markup (do not weaken assertions). If a flow's UI does not exist yet, that is a real gap — note it and align the spec to the actual admin routes under `apps/web/src/app/admin/`.

- [ ] **Step 5: Write CI.** Create `.github/workflows/ci.yml`:
```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]

jobs:
  api:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: refearn
          POSTGRES_PASSWORD: refearn
          POSTGRES_DB: refearn_test
        ports: ['5434:5432']
        options: >-
          --health-cmd "pg_isready -U refearn" --health-interval 5s
          --health-timeout 5s --health-retries 10
      redis:
        image: redis:7
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping" --health-interval 5s
          --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL_TEST: postgresql://refearn:refearn@localhost:5434/refearn_test
      REDIS_URL: redis://localhost:6379
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.29.2 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @refearn/api exec prisma generate
      # RLS migration is applied here so item 1's policies are exercised in CI.
      - run: pnpm --filter @refearn/api test:int
      - run: pnpm --filter @refearn/api test
      - run: pnpm lint

  web-e2e:
    runs-on: ubuntu-latest
    needs: api
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: refearn
          POSTGRES_PASSWORD: refearn
          POSTGRES_DB: refearn_e2e
        ports: ['5434:5432']
        options: >-
          --health-cmd "pg_isready -U refearn" --health-interval 5s
          --health-timeout 5s --health-retries 10
      redis:
        image: redis:7
        ports: ['6379:6379']
    env:
      DATABASE_URL: postgresql://refearn:refearn@localhost:5434/refearn_e2e
      DATABASE_URL_E2E: postgresql://refearn:refearn@localhost:5434/refearn_e2e
      REDIS_URL: redis://localhost:6379
      NEXT_PUBLIC_API_URL: http://localhost:3001/v1
      CORS_ORIGINS: http://localhost:3000
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.29.2 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @refearn/api exec prisma generate
      - run: pnpm --filter @refearn/api exec prisma migrate deploy
      - run: pnpm --filter @refearn/api build && pnpm --filter @refearn/web build
      - run: pnpm --filter @refearn/web exec playwright install --with-deps chromium
      - run: node apps/api/dist/main.js &
      - run: pnpm --filter @refearn/web start &
      - run: npx wait-on http://localhost:3001/healthz http://localhost:3000
      - run: pnpm --filter @refearn/web test:e2e
```

- [ ] **Step 6: Commit.**
```
git add -A && git commit -m "test(web): Playwright smoke suite (login/switch-tenant/sale/payout) + CI with RLS migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: httpOnly cookie session migration + CSRF

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/csrf.guard.ts`
- Modify: `apps/api/src/main.ts` (cookie-parser)
- Modify: `apps/api/package.json` (add `cookie-parser`, `@types/cookie-parser`)
- Modify: `apps/api/src/app.module.ts` (register CSRF guard globally after AccessTokenGuard)
- Modify: `apps/web/src/lib/auth.ts`, `apps/web/src/lib/api.ts`
- Test: extend `apps/api/test/auth.int-spec.ts`; Playwright specs from Task 7 assert cookie behavior.

> **Done after tests exist (spec §Sequencing step 4)** so the Task 7 Playwright suite catches auth-plumbing regressions.

- [ ] **Step 1: Add deps + write the failing backend test.** From repo root:
```
pnpm --filter @refearn/api add cookie-parser && pnpm --filter @refearn/api add -D @types/cookie-parser
```
Add to `apps/api/test/auth.int-spec.ts` a test asserting login sets an httpOnly refresh cookie and a non-GET without `X-CSRF-Token` is 403. Append inside the existing top-level `describe`:
```typescript
  it('login sets httpOnly refresh cookie + non-httpOnly csrf cookie; body has no refreshToken', async () => {
    // (reuse this file's existing user-creation helper; see the file's other tests for the pattern)
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: seededEmail, password: seededPassword })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => /refresh=/.test(c) && /HttpOnly/i.test(c))).toBe(true);
    expect(cookies.some((c) => /csrf=/.test(c) && !/HttpOnly/i.test(c))).toBe(true);
    expect(res.body.refreshToken).toBeUndefined();
    expect(typeof res.body.accessToken).toBe('string');
  });
```

> READ `apps/api/test/auth.int-spec.ts` first to reuse its exact user-seeding pattern and bind `seededEmail`/`seededPassword`.

- [ ] **Step 2: Run test to verify it fails.**
```
pnpm --filter @refearn/api test:int -- auth
```
Expected: fails — no `set-cookie` for refresh; `res.body.refreshToken` still defined.

- [ ] **Step 3: Write minimal implementation.**

`apps/api/src/main.ts` — add cookie parsing (after `app.use(helmet())`):
```typescript
import cookieParser from 'cookie-parser';
```
```typescript
  app.use(cookieParser());
```

Create `apps/api/src/auth/csrf.guard.ts` (double-submit: non-GET must carry `X-CSRF-Token` matching the `csrf` cookie; `@Public()` login/register are exempt because no session exists yet):
```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from './auth.guard';

/** CSRF double-submit: cookie'ler artik ambient; GET-disi isteklerde X-CSRF-Token = csrf cookie olmali. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { cookies?: Record<string, string> }>();
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
    // Public uclar (login/register/refresh) oturum-oncesi: refresh cookie'yi kendi dogrular; login csrf uretir.
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    // API-key entegrasyonlari cookie kullanmaz — X-Api-Key varsa CSRF gerekmez (bearer/keys CSRF-muaf).
    if (req.headers['x-api-key']) return true;
    if (req.headers.authorization?.startsWith('Bearer ') && !req.cookies?.refresh) return true;
    const header = req.headers['x-csrf-token'];
    const cookie = req.cookies?.csrf;
    if (!cookie || !header || header !== cookie) {
      throw new ForbiddenException('gecersiz csrf tokeni');
    }
    return true;
  }
}
```

Register it in `app.module.ts` providers (after the AccessTokenGuard is registered — note: the AccessTokenGuard is registered in `AuthModule`; add CsrfGuard as a second global guard in `app.module.ts`):
```typescript
import { CsrfGuard } from './auth/csrf.guard';
```
```typescript
    { provide: APP_GUARD, useClass: CsrfGuard },
```

`apps/api/src/auth/auth.controller.ts` — set/clear cookies. Import and use `Res({ passthrough: true })`, generate a csrf token, and strip `refreshToken` from the JSON body. Add imports:
```typescript
import { Res } from '@nestjs/common';
import { Response } from 'express';
import { randomBytes } from 'node:crypto';
```
Add a helper inside the controller class:
```typescript
  private issueCookies(res: Response, refreshToken: string): void {
    const secure = process.env.NODE_ENV === 'production';
    res.cookie('refresh', refreshToken, {
      httpOnly: true, secure, sameSite: 'strict', path: '/v1/auth', maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.cookie('csrf', randomBytes(24).toString('hex'), {
      httpOnly: false, secure, sameSite: 'strict', path: '/',
    });
  }
  private clearCookies(res: Response): void {
    res.clearCookie('refresh', { path: '/v1/auth' });
    res.clearCookie('csrf', { path: '/' });
  }
  private stripRefresh<T extends { refreshToken?: string }>(session: T): Omit<T, 'refreshToken'> {
    const { refreshToken, ...rest } = session;
    void refreshToken;
    return rest;
  }
```
Rewrite `login`, `loginTwoFactor`, `refresh`, `logout` to thread cookies. For `login`:
```typescript
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body, meta(req));
    if ('refreshToken' in result) {
      this.issueCookies(res, result.refreshToken);
      return this.stripRefresh(result);
    }
    return result; // MfaChallenge — no session yet
  }
```
Apply the same pattern to `loginTwoFactor` (always a full session → issue cookies + strip). For `refresh`, read the token from the cookie instead of the body:
```typescript
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request & { cookies?: Record<string, string> }, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.refresh;
    if (!token) throw new ForbiddenException('refresh cookie yok');
    const result = await this.auth.refresh(token, meta(req));
    this.issueCookies(res, result.refreshToken); // rotation: new refresh cookie
    return this.stripRefresh(result);
  }
```
(add `ForbiddenException` to the `@nestjs/common` import). For `logout`, clear cookies and revoke server-side using the cookie value:
```typescript
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request & { cookies?: Record<string, string> }, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.refresh;
    this.clearCookies(res);
    if (token) await this.auth.logout(token);
    return { ok: true };
  }
```
The `switch-tenant` endpoint in `me.controller.ts` returns only `{ accessToken, activeMembershipId }` (no refresh token) — no cookie change needed there.

Frontend `apps/web/src/lib/auth.ts` — access token in a module variable, drop token persistence:
```typescript
let accessToken: string | null = null;
export function getAccessToken(): string | null { return accessToken; }
export function setAccessToken(t: string | null): void { accessToken = t; }
```
Keep non-sensitive metadata (`activeMembershipId`, `memberships`, `user`) in `localStorage` but remove `accessToken`/`refreshToken` from the persisted `Session` shape. Refactor `getSession`/`setSession` to persist only metadata and merge the in-memory access token on read; `applyTenantSwitch` updates the module var + metadata; `startImpersonation`/`stopImpersonation` store metadata only (no tokens). Read the current file and adjust the `Session` type so `accessToken`/`refreshToken` are optional/derived.

Frontend `apps/web/src/lib/api.ts` — `rawFetch` sends credentials + CSRF:
```typescript
function readCsrf(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function rawFetch(path: string, init: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    const csrf = readCsrf();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  return fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
}
```
`refresh()` no longer sends a body (the cookie carries the token):
```typescript
const res = await rawFetch('/auth/refresh', { method: 'POST' });
```
and on success sets the new access token via `setAccessToken(next.accessToken)` and metadata via `setSession`. `request<T>` reads the access token from `getAccessToken()` rather than `session.accessToken`.

- [ ] **Step 4: Run tests to verify they pass.**
```
pnpm --filter @refearn/api test:int -- auth
pnpm --filter @refearn/api test:int
pnpm --filter @refearn/api lint
pnpm --filter @refearn/web lint
```
Expected: auth spec green (cookie assertions pass, refresh-cookie rotation still triggers reuse-detection on replay — verify the existing reuse-detection test still passes since only transport changed); full API suite green; both lints 0. Then re-run the Playwright suite (Task 7) — the `login.spec.ts` `localStorage` assertion and any non-GET-without-CSRF check now exercise the real cookie flow:
```
pnpm --filter @refearn/web test:e2e
```

- [ ] **Step 5: Commit.**
```
git add -A && git commit -m "feat(auth): httpOnly refresh cookie + double-submit CSRF; access token memory-only on web

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review

Spec coverage confirmed item-by-item:

- **Item 1 — Structural backstop + `@CurrentActor` (🔴/⚠️):** ✅ Ships the spec's **recommended** layer (b) Postgres RLS (Tasks 3–4) as the runtime guarantee, threaded via `SET LOCAL app.tenant_id` inside a `forActor` transaction (spec's exact mechanism), with the `bypass_rls` GUC path for platform (`forPlatform`, authorization-gated by the existing `@PlatformAdmin()` guard). Layer (a) is the **dev-only** `$extends` throwing `MissingTenantScopeError` (Task 4), matching the spec's "lint/dev-time assist, not the guarantee, does not auto-inject." The `@CurrentActor` decorator (Task 1) validates and throws `ForbiddenException` on null `tid`/`mid`, replacing the `user.tid as string` casts. All 25 tenant-scoped tables enumerated and mapped to exact `@@map` names (verified against `schema.prisma`). Trigger compatibility addressed: `DEFERRABLE` constraint triggers fire at COMMIT of the same tx; no trigger reads `tenant_id`; RLS is additive (spec §"Keeping DB triggers compatible"). Integration tests cover spec tests (a) zero cross-tenant rows even without `where`, (b) `WITH CHECK` INSERT rejection, (c) `@CurrentActor` 403, (d) platform bypass vs scoped, (e) dev-guard throws, (f) full 43-spec suite green (via `allowCrossTenant` in membership-scoped test helpers only). pgbouncer/`SET LOCAL` note preserved. Decision gate documented on Task 3.
- **Item 2 — httpOnly cookie + CSRF (🔴):** ✅ Task 8 moves the refresh token to an httpOnly `Secure` `SameSite=Strict` cookie, keeps the access token memory-only (module variable, no `localStorage`), adds double-submit CSRF (non-httpOnly `csrf` cookie + `X-CSRF-Token` header + `CsrfGuard`). Rotation/reuse-detection untouched (transport-only change). Frontend `auth.ts`/`api.ts` refactored per spec; `credentials: 'include'`; silent refresh on boot via cookie; logout clears cookie server-side. Done after tests exist (sequencing).
- **Item 3 — Playwright smoke + CI (🟠):** ✅ Task 7 adds `@playwright/test`, `playwright.config.ts`, the four required specs (login, switch-tenant isolation, sale approve, payout approve), `test:e2e` script, seed reuse, and `.github/workflows/ci.yml` running API int specs **with the RLS migration applied** + web build + Playwright, gating merges. Respects "web has zero test runner today; Playwright arrives here."
- **Item 4 — Throttler → Redis (🟡):** ✅ Task 6 swaps to `@nest-lab/throttler-storage-redis` via `forRootAsync`, preserves `THROTTLE_TTL_MS`/`THROTTLE_LIMIT` and the `skipIf` test carve-out, falls back to in-memory when `REDIS_URL` unset, fail-open on Redis blip, trusts existing `X-Forwarded-For`.
- **Item 5 — BigInt/JSON serializer (🟡):** ✅ Task 5 adds `common/serialize.ts` (`serializeCents`/`serializeMoney`) + a global interceptor safety net; unit test proves `9007199254740993n` round-trips losslessly as a string; cents-as-string boundary preserved (no frontend change).
- **Item 6 — Adjacent security:** correctly **out of scope** (spec §"Explicit non-goals"); not planned here.
- **Global constraints:** money stays BigInt cents / strings at the boundary; `where: { tenantId }` remains the primary contract (backstop is additive); DB triggers and FK semantics untouched; UI text English; no design-system migration.

Harness realities verified against the repo: API run commands are `pnpm --filter @refearn/api test` (unit), `test:int` (integration, `runInBand`), `lint` (`tsc --noEmit`); integration bootstrap pattern copied verbatim from `apps/api/test/payouts.int-spec.ts` (`Test.createTestingModule({ imports: [AppModule] })`, `setGlobalPrefix('v1')`, `truncateAll` in `beforeEach`, JWT signing via `authConfig.accessSecret()`); web uses `tsc --noEmit` for lint with E2E landing in this track; root uses turbo/pnpm (`pnpm --filter`). Migration timestamp format `YYYYMMDDHHMMSS_name` matches existing migrations; Redis available at `REDIS_URL`/`redis://redis:6379` per `docker-compose.yml`.
