# Spec: P0 Trust Foundation

## Objective

Make the existing referral platform safe to operate before visual or growth work: a tenant admin must not be able to bypass the role grant ceiling; an MFA-enabled account must only receive a privileged session after an MFA challenge; an invite or one-time token must be consumable exactly once; and payout, backup, health, and integration-test workflows must not report false success or corrupt data.

The affected users are platform administrators, tenant owners/admins/staff, members, and operators. Success is a fail-closed API with regression coverage for every reported P0 path, while retaining the current public API unless a deliberately unsafe legacy route is removed.

## Assumptions

- PostgreSQL and Prisma migrations are available for the local test database.
- Existing uncommitted source changes are intentional and must be preserved.
- No dependency, `.env`, lockfile, CI, or deployment credential changes are in scope.
- The approved product direction is the audit recommendation: safety first, then Quiet Fintech experience work.

## Commands

- Typecheck: `pnpm.cmd lint`
- Unit/shared tests: `pnpm.cmd test`
- API integration tests: `pnpm.cmd test:int`
- Production build: `pnpm.cmd build`
- Targeted API integration test: `pnpm.cmd --filter @refearn/api test:int -- --runInBand <test-file>`

## Project Structure

- `apps/api/src/auth/` owns session assurance, MFA, and one-time tokens.
- `apps/api/src/rbac/` is the canonical tenant role assignment service.
- `apps/api/src/engine/` and `apps/api/src/payouts/` own payout transitions and ledger effects.
- `apps/api/prisma/` owns schema and migrations.
- `apps/api/test/` holds integration regressions.
- `docker/backup/` and `apps/api/src/health/` own operational correctness.

## Code Style

Use existing NestJS service patterns, Zod DTO validation, Prisma transactions, `bigint` cents, and explicit result unions. Tests assert observable HTTP/service behavior, not internal mocks. For example:

```ts
const response = await request(app.getHttpServer())
  .patch(`/v1/admin/people/${member.id}/role`)
  .set(authHeader(limitedAdmin.accessToken))
  .send({ tier: 'tenant_admin' })
  .expect(403);

expect(response.body.message).toContain('permission');
```

## Testing Strategy

- Add an integration regression before each API security or money change; run it red, then green.
- Use concurrent `Promise.all` integration cases for consume-once flows.
- Run the whole API integration suite after each completed P0 task because auth, ledger, and migrations are cross-cutting.
- Run typecheck and build at the P0 checkpoint.

## Boundaries

- Always: preserve user changes, use `apply_patch`, run focused tests before broad tests, and fail closed.
- Ask first: new packages, external payment-provider integration, credential rotation in a live environment, or destructive production migration execution.
- Never: reset/revert user files, read or modify `.env`, log secrets, or mark an unconfirmed external bank transfer as settled.

## Success Criteria

- The legacy unsafe role endpoint is absent; canonical role assignment enforces self-change and permission ceilings.
- `mfa` assurance originates from a persisted verified session timestamp, not merely an enabled user flag.
- Invite, MFA challenge, email verification, and reset flows are atomically consumed once.
- Payouts have separate requested, processing, paid, and failed semantics; only settlement moves ledger and summaries to paid.
- Test DB setup rejects non-test databases before migrations/truncation; backups fail on a failed dump; degraded health is not HTTP 200.

## Deferred Follow-on Work

Tenant composite foreign keys, audit atomicity, performance/pagination, Quiet Fintech design tokens, brand assets, canonical shadcn components, role UX, and mobile trust/accessibility are tracked in `tasks/plan.md` after the P0 checkpoint.
