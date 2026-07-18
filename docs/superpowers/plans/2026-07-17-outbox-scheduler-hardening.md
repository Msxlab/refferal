# Outbox and Scheduler Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent lost or hot-looped notifications and make commission maturation bounded and observable.

**Architecture:** PostgreSQL remains the durable queue. A notification claim owns a time-bounded UUID lease, and terminal state changes are fenced by that lease. Commission maturation processes a fixed database-locked batch per transaction and exports job state through the metrics controller.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 17, Jest integration tests.

## Global Constraints

- Additive migrations only; no destructive schema operation.
- No dependency additions or queue infrastructure.
- Write and run each focused test in RED before production-code changes.
- Use `postgresql://refearn:refearn@localhost:5434/refearn_test` only for integration tests.
- Delivery remains at-least-once; do not claim exactly-once SMTP/push semantics.
- Do not commit or stage unrelated user work in the already-dirty checkout.

---

### Task 1: Durable notification leases, backoff, and dead-letter recovery

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260717103000_notification_lease_backoff/migration.sql`
- Modify: `apps/api/src/notifications/notification-relay.service.ts`
- Modify: `apps/api/test/notifications.int-spec.ts`

**Interfaces:**
- `Notification.availableAt: Date | null` means next retry time for `pending`, lease expiry for `processing`, and `null` for terminal states.
- `Notification.leaseToken: string | null` is a new UUID for each claim.
- `claimPending()` returns a fresh lease token with every claimed row; terminal updates match `{ id, status: processing, leaseToken }`.

- [ ] **Step 1: Write failing integration behavior tests**

Add these cases to `notifications.int-spec.ts`:

```ts
it('delays a transient retry instead of immediately claiming it again', async () => {
  emailShouldFail = true;
  const row = await prisma.notification.create({ data: failingEmailData });
  await relay.tick();
  const after = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
  expect(after).toMatchObject({ status: NotificationStatus.pending, attempts: 1, leaseToken: null });
  expect(after.availableAt!.getTime()).toBeGreaterThan(Date.now());
});

it('moves an expired final-attempt processing lease to failed without sending', async () => {
  const row = await prisma.notification.create({ data: expiredFinalProcessingData });
  expect(await relay.drainOnce()).toBe(0);
  expect(await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
    status: NotificationStatus.failed,
    leaseToken: null,
    availableAt: null,
  });
});
```

Also add an expired lower-attempt reclaim test and a two-relay deferred-send test proving an old claimant's completion cannot replace the new claimant's state.

- [ ] **Step 2: Run the focused test in RED**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/notifications.int-spec.ts`

Expected: TypeScript/test setup fails because `availableAt` and `leaseToken` do not exist, then old behavior fails once the additive migration is applied.

- [ ] **Step 3: Add schema and migration before implementation**

Add to `Notification`:

```prisma
availableAt DateTime? @default(now()) @map("available_at")
leaseToken  String?   @db.Uuid @map("lease_token")
@@index([status, availableAt, createdAt], map: "notifications_status_available_created_idx")
```

The SQL migration adds nullable columns, sets existing pending rows to `CURRENT_TIMESTAMP`, sets existing processing rows to `updated_at + interval '5 minutes'`, and creates the composite index. Do not add a state constraint that breaks rolling compatibility with the old worker.

- [ ] **Step 4: Implement the smallest relay state machine**

Use `newUuid()` for every claimed row. Before selecting work, move expired `processing` rows at `attempts >= 5` into `failed`, clear both lease fields, and set a bounded `lastError`. Claim only due pending rows or expired processing rows below the attempt limit under the existing transaction and `FOR UPDATE SKIP LOCKED`; increment attempts, set `status = processing`, set a fresh `leaseToken`, and set `availableAt = now + 5 minutes`.

For success/failure use `updateMany({ where: { id, status: NotificationStatus.processing, leaseToken }, data })`. On a zero update count log a stale lease and leave the newer state untouched. Retry delay is `30 * 2 ** (attempts - 1)` seconds capped at 240 seconds. Sent and failed rows clear both lease fields.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm.cmd --filter @refearn/api exec prisma migrate deploy`

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/notifications.int-spec.ts`

Expected: original send/redaction cases and all new recovery/backoff/fencing cases pass.

### Task 2: Bound commission maturation and expose worker signals

**Files:**
- Modify: `apps/api/src/engine/engine.service.ts`
- Modify: `apps/api/src/scheduler/scheduler.service.ts`
- Modify: `apps/api/src/health/metrics.controller.ts`
- Modify: `apps/api/test/scheduler.int-spec.ts`
- Modify: `apps/api/test/health.int-spec.ts`

**Interfaces:**
- `EngineService.matureCommissions(now, limit = 100): Promise<{ matured: number; hasMore: boolean }>` processes at most `limit` rows.
- `SchedulerService` retains successful-run timestamp, latest duration, and a failure count while executing at most ten maturation batches per tick.
- Metrics expose integer maturation backlog, last-success, duration, error, pending, failed, and aged-processing notification gauges.

- [ ] **Step 1: Write RED scheduler and metrics tests**

Create 101 due ledger entries, call `engine.matureCommissions(now, 100)`, and assert exactly 100 become payable with `hasMore === true`. Add a scheduler test that supplies a deterministic engine fake returning one nonempty and one empty batch and asserts two calls. Add metrics assertions for pending, failed, aged-processing, scheduler last-success/duration/error/backlog names.

- [ ] **Step 2: Run RED**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/scheduler.int-spec.ts test/health.int-spec.ts`

Expected: maturation is unbounded and the new metric names are absent.

- [ ] **Step 3: Implement bounded work and metrics**

Add `LIMIT ${limit + 1}` to the locked maturity query, process only the first `limit` rows, and return whether an extra row was present. In the scheduler loop, process at most ten batches and store successful completion time/duration; increment a failure counter on error. Expose a read-only scheduler state object to `MetricsController`. Count `processing` notifications older than five minutes separately from terminal failures.

- [ ] **Step 4: Verify GREEN and type safety**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/scheduler.int-spec.ts test/health.int-spec.ts`

Run: `pnpm.cmd --filter @refearn/api lint`

Expected: focused tests and API type-check pass.

### Task 3: Outbox and scheduler regression checkpoint

**Files:** None beyond Tasks 1-2.

- [ ] **Step 1: Run focused regression**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/notifications.int-spec.ts test/scheduler.int-spec.ts test/health.int-spec.ts`

- [ ] **Step 2: Run full API integration suite after payout changes land**

Run: `pnpm.cmd --filter @refearn/api test:int`

Expected: all suites pass against the dedicated test database.
