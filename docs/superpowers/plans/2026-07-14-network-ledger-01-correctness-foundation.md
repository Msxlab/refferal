# Network Ledger Correctness and Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the authentication, privacy, accounting, provenance, audit, payout-export, and maturation defects that would make a premium Network Ledger untrustworthy.

**Architecture:** Correct existing behavior in place before adding new read models. Use database constraints and transaction boundaries for invariants, versioned AES-GCM envelopes for TOTP secrets, immutable payout snapshots for historical evidence, and bounded `SKIP LOCKED` work for maturation.

**Tech Stack:** TypeScript, NestJS 11, Prisma 6, PostgreSQL, Jest 29, Next.js 15, Expo 52.

## Global Constraints

- Inherit every constraint and approval gate from `2026-07-14-network-ledger-implementation.md`.
- No package, lockfile, `.env`, secret, or deployment-config change belongs to this packet.
- F08 cannot be production-enabled until the approved TOTP key contract is provisioned.
- Every migration must pass fresh and restored-schema upgrade rehearsals before a rollout flag is enabled.
- Use exact-file staging and one commit per task.

---

## Task F01: Web Rotating Refresh Single-Flight

**Files:**

- Modify: `apps/web/src/lib/api.ts:21-42,124-139`
- Modify: `apps/web/src/lib/auth-api.node.test.ts:89-145`

**Interfaces:**

- Consumes: browser HttpOnly refresh cookie, `getSession()`, `setSession()`, `clearSession()`.
- Produces: one module-scoped `Promise<Session | null>` shared by `request()`, `getCsv()`, and `refreshSession()`.

- [ ] **Step 1: Add the parallel-401 regression test**

Add a test whose fake fetch returns two protected-route 401 responses, holds the refresh response, then returns success only when the retry bears `fresh-access-token`:

```ts
test('parallel 401 responses share one rotating refresh request', async () => {
  const protectedCalls: string[] = [];
  let refreshCalls = 0;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });

  const restoreFetch = installFetch(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      await refreshGate;
      return Response.json(makeSession('fresh-access-token'));
    }
    const token = new Headers(init?.headers).get('Authorization');
    protectedCalls.push(token ?? '');
    return token === 'Bearer fresh-access-token'
      ? Response.json({ ok: true })
      : Response.json({ message: 'expired' }, { status: 401 });
  });

  try {
    const first = api.get<{ ok: true }>('/one');
    const second = api.get<{ ok: true }>('/two');
    await Promise.resolve();
    releaseRefresh();
    assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
    assert.equal(refreshCalls, 1);
    assert.equal(protectedCalls.filter((value) => value === 'Bearer fresh-access-token').length, 2);
  } finally {
    restoreFetch();
  }
});
```

- [ ] **Step 2: Run RED**

```powershell
$env:TS_NODE_PROJECT='../../apps/web/tsconfig.json'
$env:TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node","allowImportingTsExtensions":true}'
pnpm --filter @refearn/api exec node -r ts-node/register --test ../../apps/web/src/lib/auth-api.node.test.ts
```

Expected: the new test fails because `refreshCalls` is `2`.

- [ ] **Step 3: Serialize refresh without caching a settled result**

Use this exact state shape in `api.ts`:

```ts
let refreshPromise: Promise<Session | null> | null = null;

function refresh(): Promise<Session | null> {
  if (refreshPromise) return refreshPromise;
  const current = refreshOnce().finally(() => {
    if (refreshPromise === current) refreshPromise = null;
  });
  refreshPromise = current;
  return current;
}

async function refreshOnce(): Promise<Session | null> {
  const res = await rawFetch('/auth/refresh', { method: 'POST' });
  if (!res.ok) {
    clearSession();
    return null;
  }
  const next = (await res.json()) as Session;
  setSession(next);
  return next;
}
```

- [ ] **Step 4: Run GREEN and web typecheck**

```powershell
$env:TS_NODE_PROJECT='../../apps/web/tsconfig.json'
$env:TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node","allowImportingTsExtensions":true}'
pnpm --filter @refearn/api exec node -r ts-node/register --test ../../apps/web/src/lib/auth-api.node.test.ts
$env:TS_NODE_PROJECT=$null
$env:TS_NODE_COMPILER_OPTIONS=$null
pnpm --filter @refearn/web lint
```

Expected: the auth tests pass, exactly one refresh is observed, and typecheck exits `0`.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/lib/api.ts apps/web/src/lib/auth-api.node.test.ts
git diff --cached --check
git commit -m "fix(web-auth): serialize rotating session refresh"
```

## Task F02: Mobile Rotating Refresh Single-Flight

**Files:**

- Modify: `apps/mobile/src/lib/api.ts:31-53`
- Create: `apps/mobile/test/api-refresh.node.test.cjs`

**Interfaces:**

- Consumes: body refresh-token contract and asynchronous session persistence.
- Produces: one rotated session promise; one `saveSession()` or `clearSession()` side effect per refresh wave.

- [ ] **Step 1: Write a source/behavior contract test**

The CommonJS test loads `api.ts` through the existing API workspace `ts-node/register`, stubs `auth.ts`, starts two protected requests, and asserts:

```js
assert.equal(refreshRequests.length, 1);
assert.deepEqual(refreshRequests[0].body, JSON.stringify({ refreshToken: 'refresh-old' }));
assert.equal(savedSessions.length, 1);
assert.equal(savedSessions[0].refreshToken, 'refresh-new');
assert.equal(retryTokens.filter((token) => token === 'Bearer access-new').length, 2);
```

- [ ] **Step 2: Run RED**

```powershell
$env:TS_NODE_PROJECT='../../apps/mobile/tsconfig.json'
$env:TS_NODE_TRANSPILE_ONLY='true'
$env:TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}'
pnpm --filter @refearn/api exec node -r ts-node/register --test ../../apps/mobile/test/api-refresh.node.test.cjs
```

Expected: two refresh requests and two session writes are observed.

- [ ] **Step 3: Add mobile refresh single-flight state**

Implement the same identity-safe pattern with the initiating session captured inside `refreshOnce(session)`:

```ts
let refreshPromise: Promise<Session | null> | null = null;

function refresh(session: Session): Promise<Session | null> {
  if (refreshPromise) return refreshPromise;
  const current = refreshOnce(session).finally(() => {
    if (refreshPromise === current) refreshPromise = null;
  });
  refreshPromise = current;
  return current;
}
```

- [ ] **Step 4: Run GREEN, typecheck, and export check**

```powershell
$env:TS_NODE_PROJECT='../../apps/mobile/tsconfig.json'
$env:TS_NODE_TRANSPILE_ONLY='true'
$env:TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}'
pnpm --filter @refearn/api exec node -r ts-node/register --test ../../apps/mobile/test/api-refresh.node.test.cjs
$env:TS_NODE_PROJECT=$null
$env:TS_NODE_TRANSPILE_ONLY=$null
$env:TS_NODE_COMPILER_OPTIONS=$null
pnpm --filter @refearn/mobile lint
pnpm --filter @refearn/mobile export:check
```

Expected: one refresh, two retries, one persistence write; lint/export exit `0`.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/mobile/src/lib/api.ts apps/mobile/test/api-refresh.node.test.cjs
git diff --cached --check
git commit -m "fix(mobile-auth): serialize rotating session refresh"
```

## Task F03: Privacy-Safe Public Invite Contract

**Files:**

- Modify: `apps/web/src/app/i/[code]/page.tsx:19-26,108-115`
- Modify: `apps/mobile/app/i/[code].tsx:13-20,110-114`
- Create: `apps/web/src/lib/invite-contract.node.test.ts`
- Test: `apps/api/test/auth.int-spec.ts:107-140`

**Interfaces:**

- Consumes: `InvitesService.resolve()` fields `code`, `valid`, `tenantName`, `tenantSlug`, `brand`, `expiresAt`, `emailLocked`.
- Produces: tenant-centered web/native copy with no inviter identity dependency.

- [ ] **Step 1: Add a static cross-client contract test**

```ts
const webInvitePath = new URL('../app/i/[code]/page.tsx', import.meta.url);
const mobileInvitePath = new URL('../../../mobile/app/i/[code].tsx', import.meta.url);

test('public invite clients use the tenant contract without inviter identity', () => {
  for (const path of [webInvitePath, mobileInvitePath]) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /inviterName|undefined invited/);
    assert.match(source, /tenantName/);
  }
});
```

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test apps/web/src/lib/invite-contract.node.test.ts
```

Expected: both current clients contain `inviterName`.

- [ ] **Step 3: Remove the impossible field and use tenant copy**

Use the same valid-state title in both clients:

```ts
const inviteTitle = invite ? `You're invited to join ${invite.tenantName}` : 'Checking invitation';
```

Keep invalid, loading, MFA, and email-lock behavior unchanged. Do not add inviter identity to the API.

- [ ] **Step 4: Run GREEN and API/client verification**

```powershell
node --experimental-strip-types --test apps/web/src/lib/invite-contract.node.test.ts
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/auth.int-spec.ts
pnpm --filter @refearn/web lint
pnpm --filter @refearn/mobile lint
```

Expected: contract test, invite integration test, and both typechecks pass.

- [ ] **Step 5: Commit**

```powershell
git add -- 'apps/web/src/app/i/[code]/page.tsx' 'apps/mobile/app/i/[code].tsx' apps/web/src/lib/invite-contract.node.test.ts apps/api/test/auth.int-spec.ts
git diff --cached --check
git commit -m "fix(invites): align clients with privacy-safe public contract"
```

## Task F04: Canonical Net Commission Semantics

**Files:**

- Modify: `apps/api/src/reports/reports.service.ts:28-79,87-219`
- Modify: `apps/api/test/payouts.int-spec.ts`

**Interfaces:**

- Consumes: ledger statuses and `MonthlySummary.pendingCents`, `payableCents`, `processingCents`, `paidCents`.
- Produces: the same net commission total for dashboard, analytics, wallet checks, and later shared contracts.

- [ ] **Step 1: Add lifecycle assertions**

Create fixtures for unpaid void, processing payout, paid payout, paid-row reversal, and an adjustment. Assert the canonical formula:

```ts
const expected = pendingCents + payableCents + processingCents + paidCents;
expect(BigInt(dashboard.thisMonth.commissionCents)).toBe(expected);
expect(BigInt(analytics.totals.commissionCents)).toBe(expected);
```

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/payouts.int-spec.ts
```

Expected: void and processing assertions expose the current semantic mismatch.

- [ ] **Step 3: Apply one canonical SQL rule**

Dashboard ledger query must use:

```sql
SELECT COALESCE(SUM(le.amount_cents), 0)::bigint AS sum
FROM ledger_entries le
JOIN sales s ON s.id = le.sale_id
WHERE le.tenant_id = $tenant
  AND le.status IN ('pending', 'payable', 'processing', 'paid')
  AND COALESCE(
    s.summary_month,
    to_char(s.sale_date AT TIME ZONE $tenant_timezone, 'YYYY-MM')
  ) = $target_month
```

Do not filter out negative `reversal` or signed `adjustment` types; do filter out `reversed` status. Preserve the selected tenant-month scope shown above. Add `processingCents` to both current and previous analytics sums for the identical month range. Later contracts expose `grossCents`, `reversalCents`, and `adjustmentCents` separately with `netCents = grossCents + reversalCents + adjustmentCents`.

- [ ] **Step 4: Run GREEN and lint**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/payouts.int-spec.ts
pnpm --filter @refearn/api lint
```

Expected: every lifecycle total agrees and typecheck exits `0`.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/reports/reports.service.ts apps/api/test/payouts.int-spec.ts
git diff --cached --check
git commit -m "fix(reports): canonicalize net commission totals"
```

## Task F05: Commission Plan Effective-Date Uniqueness

**Files:**

- Modify: `apps/api/prisma/schema.prisma:322-339`
- Create: `apps/api/prisma/migrations/20260714120000_commission_plan_effective_from_unique/migration.sql`
- Modify: `apps/api/src/plans/plans.service.ts:34-84`
- Modify: `apps/api/test/settings.int-spec.ts`

**Interfaces:**

- Consumes: tenant ID and exact `effectiveFrom` timestamp.
- Produces: database invariant `UNIQUE (tenant_id, effective_from)` and deterministic HTTP 409 for a collision.

- [ ] **Step 1: Add the concurrent-create integration test**

```ts
const [first, second] = await Promise.all([
  request(app.getHttpServer()).post('/v1/admin/plans').set(ownerHeaders).send(plan),
  request(app.getHttpServer()).post('/v1/admin/plans').set(ownerHeaders).send(plan),
]);
expect([first.status, second.status].sort()).toEqual([201, 409]);
expect(await prisma.commissionPlan.count({ where: { tenantId, effectiveFrom } })).toBe(1);
```

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/settings.int-spec.ts
```

Expected: the application pre-check is raceable.

- [ ] **Step 3: Add fail-closed migration and conflict mapping**

```powershell
New-Item -ItemType Directory -Force 'apps/api/prisma/migrations/20260714120000_commission_plan_effective_from_unique' | Out-Null
```

The migration first raises if duplicate groups exist, then adds the unique constraint. In the service, map only Prisma `P2002` for this target:

```ts
if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
  throw new ConflictException('a plan already exists for this effectiveFrom value');
}
throw error;
```

- [ ] **Step 4: Validate schema and run GREEN**

```powershell
pnpm --filter @refearn/api exec prisma validate --schema prisma/schema.prisma
pnpm --filter @refearn/api exec prisma generate --schema prisma/schema.prisma
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/settings.int-spec.ts
```

Expected: schema validates; same-tenant result is `[201,409]`; different tenants may share a timestamp.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260714120000_commission_plan_effective_from_unique/migration.sql apps/api/src/plans/plans.service.ts apps/api/test/settings.int-spec.ts
git diff --cached --check
git commit -m "fix(plans): enforce unique effective dates per tenant"
```

## Task F06: Approval-Time Commission Plan Provenance

**Files:**

- Modify: `apps/api/prisma/schema.prisma:322-383`
- Create: `apps/api/prisma/migrations/20260714121000_sale_commission_plan_provenance/migration.sql`
- Modify: `apps/api/src/engine/engine.service.ts:21-33,122-160`
- Modify: `apps/api/test/engine.int-spec.ts:197-235`

**Interfaces:**

- Consumes: F05's deterministic plan timeline.
- Produces: nullable, tenant-safe `Sale.commissionPlanId`; new approvals freeze the selected plan before ledger writes.

- [ ] **Step 1: Extend the plan-change regression**

```ts
const approved = await prisma.sale.findUniqueOrThrow({ where: { id: firstSale.id } });
expect(approved.commissionPlanId).toBe(originalPlan.id);
await engine.applyCommissions(firstSale.id);
expect((await prisma.sale.findUniqueOrThrow({ where: { id: firstSale.id } })).commissionPlanId).toBe(originalPlan.id);
```

Also assert a legacy sale with existing ledger rows and null provenance remains null. Attempt to attach a second tenant's plan ID and assert the database rejects it.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/engine.int-spec.ts
```

Expected: Prisma model has no provenance field.

- [ ] **Step 3: Add nullable FK and freeze it in the engine transaction**

```powershell
New-Item -ItemType Directory -Force 'apps/api/prisma/migrations/20260714121000_sale_commission_plan_provenance' | Out-Null
```

Use a restrictive relation:

```prisma
commissionPlanId String?         @map("commission_plan_id") @db.Uuid
commissionPlan   CommissionPlan? @relation("AppliedCommissionPlan", fields: [tenantId, commissionPlanId], references: [tenantId, id], onDelete: Restrict)
@@index([tenantId, commissionPlanId])
```

Add `appliedSales Sale[] @relation("AppliedCommissionPlan")` and `@@unique([tenantId, id], map: "commission_plans_tenant_id_id_key")` to `CommissionPlan`, then create the matching composite foreign key in SQL. Plan resolution order is persisted plan first, sale-date lookup second. Update `commissionPlanId` and `summaryMonth` before ledger creation in the same transaction.

- [ ] **Step 4: Validate, generate, and run GREEN**

```powershell
pnpm --filter @refearn/api exec prisma validate --schema prisma/schema.prisma
pnpm --filter @refearn/api exec prisma generate --schema prisma/schema.prisma
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/engine.int-spec.ts
```

Expected: exact plan remains stable after later plan creation and idempotent replay; a cross-tenant plan link fails at the database boundary.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260714121000_sale_commission_plan_provenance/migration.sql apps/api/src/engine/engine.service.ts apps/api/test/engine.int-spec.ts
git diff --cached --check
git commit -m "feat(engine): persist applied commission plan provenance"
```

## Task F07: Idempotent Provenance Backfill and Reconciliation

**Files:**

- Create: `apps/api/prisma/backfill-sale-plan-provenance.ts`
- Modify: `apps/api/test/database-safety.int-spec.ts`

**Interfaces:**

- Consumes: nullable sale provenance, captured ledger rates, tenant/date plan candidates.
- Produces: bounded backfill result `{ scanned, updated, ambiguous, missing }`; no monetary/status mutation.

- [ ] **Step 1: Add restored-data fixtures**

Test four rows: exact single plan/rate match, no plan, multiple candidates, and already-populated provenance. Assert only the exact row changes and the second run reports `updated: 0`.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/database-safety.int-spec.ts
```

Expected: backfill entry point does not exist.

- [ ] **Step 3: Implement 500-row bounded updates**

Expose a callable function and CLI:

```ts
export interface ProvenanceBackfillResult {
  scanned: number;
  updated: number;
  ambiguous: number;
  missing: number;
}

export type BackfillSalePlanProvenance = (
  prisma: PrismaClient,
  options?: { batchSize?: number; dryRun?: boolean },
) => Promise<ProvenanceBackfillResult>;
```

The implementation selects null-provenance sales in stable ID order, at most 500 rows per batch. For each sale it loads tenant plans effective on the sale date, compares every captured positive commission-line level/rate with each candidate, and writes only when exactly one candidate matches. The conditional update includes `commissionPlanId: null`, so concurrent or repeated runs cannot overwrite provenance. It writes no guess when the candidate count is not exactly one.

- [ ] **Step 4: Run GREEN and an explicit dry run on disposable data**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/database-safety.int-spec.ts
pnpm --filter @refearn/api exec ts-node prisma/backfill-sale-plan-provenance.ts --dry-run
```

Expected: integration suite passes; dry run prints counts and writes zero rows.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/prisma/backfill-sale-plan-provenance.ts apps/api/test/database-safety.int-spec.ts
git diff --cached --check
git commit -m "chore(data): backfill unambiguous sale plan provenance"
```

## Task F08: Versioned AES-GCM TOTP Secret Envelope

**Approval gate:** G1 production key contract.

**Files:**

- Modify: `apps/api/src/auth/auth.config.ts`
- Create: `apps/api/src/auth/totp-secret.ts`
- Modify: `apps/api/src/auth/auth.service.ts:340-399,786-801`
- Modify: `apps/api/test/auth.int-spec.ts:411-614`

**Interfaces:**

- Consumes: approved base64 32-byte `MFA_SECRET_ENCRYPTION_KEY` supplied by the runtime secret manager.
- Produces: `totp.v1.<iv_b64url>.<tag_b64url>.<ciphertext_b64url>`; legacy plaintext dual-read with `needsRewrite`.

- [ ] **Step 1: Add encrypted, legacy, and corrupted-envelope tests**

```ts
expect(stored.totpSecret).toMatch(/^totp\.v1\./);
expect(stored.totpSecret).not.toContain(setup.body.secret);
expect(await loginWithTotp(legacyUser, validLegacyCode)).toHaveProperty('accessToken');
await expect(loginWithTotp(corruptedUser, validCode)).rejects.toMatchObject({ status: 401 });
```

- [ ] **Step 2: Run RED with a test-only encryption key**

```powershell
$env:MFA_SECRET_ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/auth.int-spec.ts
```

Expected: setup still stores the plaintext secret.

- [ ] **Step 3: Implement envelope read/write**

The helper contract is:

```ts
export interface TotpSecretRead { secret: string; needsRewrite: boolean }
export function encryptTotpSecret(userId: string, secret: string): string;
export function decryptTotpSecret(userId: string, stored: string): TotpSecretRead;
```

Use AES-256-GCM, random 12-byte IV, 16-byte auth tag, unpadded base64url segments, AAD `refearn:user:${userId}:totp`, and exact four-segment prefix/version parsing. Reject empty/extra/malformed segments before decryption. Invalid key length, missing production key, and auth-tag failure must throw a safe configuration/authorization error without logging the secret.

- [ ] **Step 4: Wire new writes and lazy rewrite, then run GREEN**

`setupMfa()` encrypts before DB write. `enableMfa()` and `verifyMfaCode()` decrypt before verification. A successful legacy-plaintext verification rewrites the envelope in the same auth transaction. Key rotation remains a G1 runbook/re-encryption gate; this task does not invent an unapproved keyring contract.

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/auth.int-spec.ts
pnpm --filter @refearn/api lint
```

Expected: new, legacy, corrupt, missing-key, enable, login, disable, and recovery-code paths pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/auth/auth.config.ts apps/api/src/auth/totp-secret.ts apps/api/src/auth/auth.service.ts apps/api/test/auth.int-spec.ts
git diff --cached --check
git commit -m "fix(auth): encrypt TOTP secrets with versioned envelopes"
```

## Task F09: RBAC and Settings Mutation-Audit Atomicity

**Files:**

- Modify: `apps/api/src/rbac/rbac.service.ts:120-329`
- Modify: `apps/api/test/rbac.int-spec.ts`
- Modify: `apps/api/src/settings/settings.service.ts:114-189`
- Modify: `apps/api/test/settings.int-spec.ts`

**Interfaces:**

- Consumes: actor, mutation input, `Prisma.TransactionClient`.
- Produces: all-or-nothing mutation and audit for role create/update/delete/assign and settings update.

- [ ] **Step 1: Add forced-audit-failure rollback tests**

Inside `try/finally`, create a test-only PostgreSQL trigger rejecting the target audit action, invoke the mutation, then assert before/after DB state is identical. Drop the trigger in `finally`.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/rbac.int-spec.ts test/settings.int-spec.ts
```

Expected: current mutation commits before the audit insert fails.

- [ ] **Step 3: Pass one transaction client through mutation and audit**

Use this boundary for each service:

```ts
return this.prisma.$transaction(async (tx) => {
  const updated = await mutate(tx);
  await audit(tx, actor, before, updated);
  return updated;
});
```

Read-only response enrichment may occur after commit, but it must not create a second mutation.

- [ ] **Step 4: Run GREEN and permission regressions**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/rbac.int-spec.ts test/settings.int-spec.ts
pnpm --filter @refearn/api lint
```

Expected: rollback tests pass and existing permission ceilings remain unchanged.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/rbac/rbac.service.ts apps/api/test/rbac.int-spec.ts apps/api/src/settings/settings.service.ts apps/api/test/settings.int-spec.ts
git diff --cached --check
git commit -m "fix(audit): commit privileged mutations atomically"
```

## Task F10: Immutable Historical Paid Payout Export

**Files:**

- Modify: `apps/api/src/payouts/payouts.service.ts:301-324`
- Modify: `apps/api/test/payouts.int-spec.ts:421-508`

**Interfaces:**

- Consumes: reservation-time `PayoutBatchItem` recipient fields and `recipientSnapshotAt`.
- Produces: profile-independent historical CSV; deterministic 409 for unsafe legacy records.

- [ ] **Step 1: Add profile-mutation and legacy-snapshot tests**

Export once, change the member's name/email/code, export again, and assert byte equality. Insert one paid legacy payout with no provenance marker and assert 409 with no partial CSV.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/payouts.int-spec.ts
```

Expected: the second export currently reflects live profile data.

- [ ] **Step 3: Query only immutable snapshot-backed rows**

Build each paid payout row from batch items. Before serialization enforce:

```ts
if (paidPayoutCount !== snapshotBackedPayoutCount) {
  throw new ConflictException('historical payout snapshot is incomplete');
}
```

Keep `csvCell()` formula-injection protection and cents strings.

- [ ] **Step 4: Run GREEN and lint**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/payouts.int-spec.ts
pnpm --filter @refearn/api lint
```

Expected: immutable bytes, legacy 409, tenant isolation, and exact large cents pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/payouts/payouts.service.ts apps/api/test/payouts.int-spec.ts
git diff --cached --check
git commit -m "fix(payouts): export paid history from immutable snapshots"
```

## Task F11: Bounded Commission Maturation Transaction

**Files:**

- Modify: `apps/api/src/engine/engine.service.ts:264-307`
- Modify: `apps/api/test/engine.int-spec.ts`

**Interfaces:**

- Consumes: due pending rows.
- Produces: `{ matured: number; hasMore: boolean }`, maximum 500 rows per transaction.

- [ ] **Step 1: Add 501-row and concurrent-worker tests**

Assert calls return `500`, `1`, then `0`, summaries equal ledger totals, and two workers never mature the same ID.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/engine.int-spec.ts
```

Expected: the current first call processes all 501 rows.

- [ ] **Step 3: Bound and order the lock query**

Use deterministic ordering and a literal cap:

```sql
ORDER BY le.matures_at ASC, le.created_at ASC, le.id ASC
LIMIT 500
FOR UPDATE OF le SKIP LOCKED
```

Return `hasMore: due.length === 500`; an exact-500 backlog may cause one safe empty scheduler call.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/engine.int-spec.ts
pnpm --filter @refearn/api lint
```

Expected: 500/1/0, idempotency, race, and summary assertions pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/engine/engine.service.ts apps/api/test/engine.int-spec.ts
git diff --cached --check
git commit -m "fix(engine): bound commission maturation transactions"
```

## Task F12: Scheduler Tick Bounded Drain

**Files:**

- Modify: `apps/api/src/scheduler/scheduler.service.ts:17-34`
- Modify: `apps/api/test/scheduler.int-spec.ts`

**Interfaces:**

- Consumes: F11 `{ matured, hasMore }`.
- Produces: maximum 20 batches or 10,000 rows per cron tick.

- [ ] **Step 1: Add early-stop and cap tests**

Mock the engine with `[500, 42]`, `[500 x 21]`, and `[0]`. Assert call counts `2`, `20`, and `1`; overlapping in-process tick remains ignored.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/scheduler.int-spec.ts
```

Expected: current scheduler invokes only one batch.

- [ ] **Step 3: Drain with a fixed clock and hard cap**

```ts
const now = new Date();
let total = 0;
for (let batch = 0; batch < 20; batch += 1) {
  const result = await this.engine.matureCommissions(now);
  total += result.matured;
  if (!result.hasMore) break;
}
```

Log only the total count and duration; no tenant label or row data.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/scheduler.int-spec.ts
pnpm --filter @refearn/api lint
```

Expected: early stop, cap, idempotency, and running guard pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/scheduler/scheduler.service.ts apps/api/test/scheduler.int-spec.ts
git diff --cached --check
git commit -m "fix(scheduler): cap maturation work per cron tick"
```

## Task F13: Foundation Reconciliation and Migration Rehearsal

**Files:**

- Create: `apps/api/prisma/reconcile-network-ledger.ts`
- Modify: `apps/api/test/database-safety.int-spec.ts`

**Interfaces:**

- Consumes: tenant-scoped ledger, monthly summaries, payouts, batches, and batch items.
- Produces: process exit `0` only when every mismatch count is zero; JSON-safe aggregate counts with cents as strings.

- [ ] **Step 1: Add mismatch fixtures**

Test clean state, summary mismatch, payout-total mismatch, duplicate reservation, and cross-tenant link. Each dirty fixture must produce a named nonzero counter.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/database-safety.int-spec.ts
```

Expected: reconciliation entry point is absent.

- [ ] **Step 3: Implement bounded aggregate checks**

Return this stable shape:

```ts
export interface NetworkLedgerReconciliation {
  ledgerSummaryMismatchCount: number;
  payoutItemMismatchCount: number;
  duplicateReservationCount: number;
  crossTenantLinkCount: number;
  missingPlanProvenanceCount: number;
}
```

The CLI accepts `--tenant=$env:PILOT_TENANT_ID` or `--all`, logs no PII, and exits nonzero when any correctness counter except informational missing provenance is nonzero.

- [ ] **Step 4: Run integration, fresh migration, and restored upgrade rehearsal**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/database-safety.int-spec.ts
pnpm --filter @refearn/api exec prisma migrate deploy --schema prisma/schema.prisma
pnpm --filter @refearn/api exec ts-node prisma/reconcile-network-ledger.ts --all
```

Expected: fresh and upgraded disposable databases migrate; clean fixture reconciliation is zero. A restored production-like copy is required before C1 is marked complete.

- [ ] **Step 5: Run task verification and commit**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/database-safety.int-spec.ts
pnpm --filter @refearn/api lint
git add -- apps/api/prisma/reconcile-network-ledger.ts apps/api/test/database-safety.int-spec.ts
git diff --cached --check
git commit -m "test(finance): enforce Network Ledger reconciliation"
```

Expected: reconciliation and lint pass; only the two F13 files are staged for its commit.

## Task F14: Ledger Timeline Composite Index and Catalog Guard

**Files:**

- Modify: `apps/api/prisma/schema.prisma:386-416`
- Create: `apps/api/prisma/migrations/20260714122000_ledger_timeline_index/migration.sql`
- Modify: `apps/api/test/database-safety.int-spec.ts`

**Interfaces:**

- Consumes: the member timeline order `(tenantId, beneficiaryMembershipId, createdAt DESC, id DESC)`.
- Produces: one named B-tree index matching that filter/order and a catalog regression that prevents silent drift.

- [ ] **Step 1: Add an exact index-catalog regression**

Query `pg_indexes` for `ledger_entries_tenant_beneficiary_created_id_idx`. Assert the index is absent before the migration, then assert its definition contains `tenant_id`, `beneficiary_membership_id`, `created_at DESC`, and `id DESC` in that order after migration.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/database-safety.int-spec.ts
```

Expected: the named timeline index is missing.

- [ ] **Step 3: Add the Prisma index and expand-only migration**

```powershell
New-Item -ItemType Directory -Force 'apps/api/prisma/migrations/20260714122000_ledger_timeline_index' | Out-Null
```

Add this model directive:

```prisma
@@index([tenantId, beneficiaryMembershipId, createdAt(sort: Desc), id(sort: Desc)], map: "ledger_entries_tenant_beneficiary_created_id_idx")
```

The SQL migration creates the same index with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`; it drops or rewrites nothing. Rehearse it on the restored copy and record lock duration before production deployment.

- [ ] **Step 4: Run schema, migration, and catalog verification**

```powershell
pnpm --filter @refearn/api exec prisma validate --schema prisma/schema.prisma
pnpm --filter @refearn/api exec prisma generate --schema prisma/schema.prisma
pnpm --filter @refearn/api exec prisma migrate deploy --schema prisma/schema.prisma
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/database-safety.int-spec.ts
pnpm --filter @refearn/api exec ts-node prisma/reconcile-network-ledger.ts --all
```

Expected: validation, generation, fresh/upgraded migration, exact catalog assertion, and zero reconciliation counters pass.

- [ ] **Step 5: Run task verification and commit**

```powershell
pnpm --filter @refearn/api lint
git add -- apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260714122000_ledger_timeline_index/migration.sql apps/api/test/database-safety.int-spec.ts
git diff --cached --check
git commit -m "perf(wallet): index deterministic ledger timelines"
```

Expected: schema/migration/catalog checks and API lint pass; only the three F14 files are staged for its commit.

## Task F15: Sensitive Audit Minimization and Legacy Response Redaction

**Files:**

- Modify: `apps/api/src/engine/engine.service.ts:650-830`
- Modify: `apps/api/src/reports/reports.service.ts:6-19,233-270`
- Modify: `apps/api/test/payouts.int-spec.ts`
- Modify: `apps/api/test/admin.int-spec.ts`

**Interfaces:**

- Consumes: F10 canonical payout/batch proof records and existing audit rows.
- Produces: minimal new payout audit payloads and a defensive legacy `AuditPageV1` projection with `redacted: true` when fields were removed. It does not delete or rewrite historical audit rows.

- [ ] **Step 1: Add storage and response non-disclosure regressions**

Settle, fail, and reject fixtures with unique reference/evidence/reason canaries. Assert the canonical payout/batch record retains the authorized proof but newly written audit JSON contains none of the canaries. Insert a legacy audit row containing nested `email`, `ip`, `token`, `secret`, `password`, `settlementReference`, `settlementEvidence`, `failureReason`, `rejectionReason`, `reason`, `ref`, `recipientEmail`, and `recipientFullName`; assert the audit API returns none of them, omits the model's top-level IP, and reports `redacted: true`.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/payouts.int-spec.ts test/admin.int-spec.ts
```

Expected: current settlement audit payload duplicates evidence/reference and the audit response exposes legacy sensitive fields/IP.

- [ ] **Step 3: Minimize all new payout audit writes**

Keep the canonical values only on `Payout`/`PayoutBatch`. Settlement audit payloads contain `{ batchId, evidenceRecorded: true }` plus aggregate counts for batch events. Failure/rejection audit payloads contain `{ batchId?, reasonRecorded: true }` plus aggregate counts; they never copy the free-text reason. Preserve action, entity, entity ID, actor, status transition, and timestamp so the audit still proves who changed which state and when.

- [ ] **Step 4: Add a recursive defensive legacy projector**

Replace the invite-only response helper with:

```ts
export function redactAuditValue(
  value: Prisma.JsonValue | null,
): { value: Prisma.JsonValue | null; redacted: boolean };
```

Recursively traverse arrays/objects, drop only the exact case-insensitive keys named in Step 1, keep safe fingerprints such as `emailFingerprint`, and OR the nested redaction flags. Project no top-level `ip`. For each audit item set `redacted` when either side removed a field. Do not mutate the stored JSON.

- [ ] **Step 5: Run the packet checkpoint and commit**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/payouts.int-spec.ts test/admin.int-spec.ts
pnpm --filter @refearn/shared test -- --runInBand
pnpm --filter @refearn/api test
pnpm --filter @refearn/api test:int
pnpm --filter @refearn/api lint
pnpm --filter @refearn/web lint
pnpm --filter @refearn/mobile lint
git add -- apps/api/src/engine/engine.service.ts apps/api/src/reports/reports.service.ts apps/api/test/payouts.int-spec.ts apps/api/test/admin.int-spec.ts
git diff --cached --check
git commit -m "fix(audit): minimize sensitive payout evidence"
```

Expected: targeted canary tests and the full foundation checkpoint pass; only the four F15 files are staged for its commit.

## Packet 1 Completion Gate

- [ ] Parallel refresh is single-flight on web and mobile.
- [ ] Public invite clients no longer require inviter identity.
- [ ] Every financial surface uses the canonical active-status net rule.
- [ ] Plan uniqueness and new-sale provenance are database-backed.
- [ ] Backfill changes only unambiguous null provenance.
- [ ] TOTP plaintext count reaches zero only after G1 and restored-DB rehearsal.
- [ ] Privileged mutation and audit records are atomic.
- [ ] Historical paid CSV is immutable or fails closed.
- [ ] Maturation is bounded per transaction and cron tick.
- [ ] Reconciliation correctness counters are zero.
- [ ] Timeline index definition matches tenant/member/created/id ordering exactly.
- [ ] New audit rows do not duplicate payout evidence/reference/reasons; legacy API output is defensively redacted.
