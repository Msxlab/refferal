# P0 Trust Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or an equivalent task-by-task review loop. Steps use checkbox syntax for tracking.

**Goal:** Eliminate the audited P0 authorization, MFA, payout, test-database, backup, and health correctness failures without discarding any existing user work.

**Architecture:** The plan replaces unsafe parallel paths with one canonical RBAC route, makes MFA assurance a property of the refresh-token session, atomically consumes tokens and invites, and separates payout reservation from settlement. Operational guardrails fail closed before destructive or misleading behavior. The user-approved UI reset begins only after this integrity checkpoint passes.

**Tech Stack:** NestJS 11, Prisma 6/PostgreSQL, Jest/Supertest, Next.js 15, Expo 52; no new dependencies.

## Global Constraints

- Preserve the dirty main worktree; never reset, checkout, overwrite, or clean user changes.
- Use `apply_patch` for source and plan edits; no dependency or lockfile changes.
- Add/adjust a failing test before every production behavior change and observe the expected failure.
- Run the focused test, then `pnpm.cmd test:int` at every P0 checkpoint.
- Do not treat an external bank transfer as paid without a verified settlement reference.
- Do not read or edit `.env` or repository memory documents.

---

## File Map

- `apps/api/src/members/members.admin.controller.ts` — remove the unsafe legacy role route.
- `apps/api/src/members/members.admin.service.ts` — remove direct coarse-role mutation.
- `apps/api/src/rbac/rbac.service.ts` — remain the sole role assignment authority.
- `apps/web/src/app/admin/members/page.tsx` — call the canonical assignment endpoint.
- `apps/api/src/auth/auth.service.ts`, `auth.types.ts`, `auth.guard.ts`, `auth.config.ts` — session MFA assurance and atomic token consumption.
- `apps/api/prisma/schema.prisma` plus a new migration — refresh-token assurance and payout reservation constraints.
- `apps/api/src/engine/engine.service.ts`, `apps/api/src/payouts/*` — payout state transitions.
- `apps/api/test/*.int-spec.ts` — API regressions.
- `apps/api/test/setup-env.ts`, `global-setup.ts`, `helpers.ts` — test database guard.
- `apps/api/prisma/seed.ts`, `add-platform-admin.ts` — fail-closed provisioning.
- `docker/backup/backup.sh`, `restore-test.sh`, `apps/api/src/health/*`, `docker/Caddyfile`, `docker-compose.yml` — operational truthfulness.

### Task 1: Canonical RBAC assignment — complete

**Files:**

- Modify: `apps/api/src/members/members.admin.controller.ts`, `apps/api/src/members/members.admin.service.ts`, `apps/web/src/app/admin/members/page.tsx`, `apps/api/test/admin.int-spec.ts`, `apps/api/test/rbac.int-spec.ts`

**Interfaces:**

- Consumes: `PATCH /v1/admin/people/:membershipId/role` with `{ tier?: Role, roleId?: string | null }`.
- Produces: one role-assignment path guarded by `RbacService.assignRole`.

- [ ] Write an integration regression showing a limited `tenant_admin` cannot assign a default `tenant_admin` tier through the legacy route or canonical route.
- [ ] Run `pnpm.cmd --filter @refearn/api test:int -- --runInBand test/rbac.int-spec.ts test/admin.int-spec.ts`; confirm the new regression fails because the legacy route/direct mutation remains.
- [ ] Remove `POST /admin/members/:id/role` and `MembersAdminService.setRole`; change the Members page to PATCH the canonical people endpoint with `{ tier: role }`.
- [ ] Update old assertions to expect the legacy route to be absent and the canonical route to preserve grant ceilings, self-change restrictions, and `roleId` normalization.
- [ ] Re-run the focused tests and then `pnpm.cmd test:int`.

### Task 2: MFA assurance and atomic one-time tokens

**Files:**

- Modify: `apps/api/prisma/schema.prisma`, new `apps/api/prisma/migrations/<timestamp>_mfa_assurance/migration.sql`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.types.ts`, `apps/api/src/auth/auth.guard.ts`, `apps/api/test/auth.int-spec.ts`

**Interfaces:**

- Consumes: persisted `RefreshToken.mfaVerifiedAt`.
- Produces: access payload `mfaAt` only for sessions that completed MFA after it was enabled.

- [ ] Write failing integration cases for: refresh of an assurance-less session after MFA enablement; invite join by an existing MFA user; concurrent completion of an MFA challenge; concurrent email verification and password reset confirmation.
- [ ] Run `pnpm.cmd --filter @refearn/api test:int -- --runInBand test/auth.int-spec.ts`; confirm each case fails for the documented old behavior.
- [ ] Add nullable `mfa_verified_at`; ensure normal sessions write `null`, MFA completion writes `new Date()`, refresh rotation preserves it, and enabling MFA revokes active refresh tokens.
- [ ] Make `signAccess` and the guard require a valid session assurance timestamp for privileged MFA-required routes; issue a challenge rather than a session when an existing MFA user joins by invite.
- [ ] Atomically claim one-time token records with a conditional `updateMany` inside a transaction before producing a session or changing password/verification state.
- [ ] Re-run focused auth tests and `pnpm.cmd test:int`.

### Task 2b: Complete MFA-gated invite acceptance and session invalidation

**Files:**

- Modify: `apps/api/prisma/schema.prisma`, new migration, `apps/api/src/auth/auth.service.ts`, `auth.types.ts`, `auth.guard.ts`, `apps/api/test/auth.int-spec.ts`, `apps/api/test/rbac.int-spec.ts`, and invite client screens only as required for recovery.

**Interfaces:**

- Consumes: a password-validated existing MFA user, a live MFA challenge, and an active invite.
- Produces: no tenant membership or invite consumption until the MFA challenge succeeds; access tokens and refresh tokens bound to a current user auth generation.

- [ ] Write failing integration regressions showing that failed/expired invite MFA creates no membership and leaves the invite active; a `mid: null` assured session preserves proof through tenant selection; and pre-revocation access/refresh tokens fail after MFA enable, disable, password reset, logout, or session revocation.
- [ ] Add a challenge-bound invite intent and create/consume the membership only after successful MFA completion.
- [ ] Add and enforce a monotonic user auth generation in access and refresh session contracts; increment it at every session-revoking security event, and reject stale/legacy access or refresh contracts.
- [ ] Ensure the guarded tenant-switch path preserves only proof that the guard has already validated; provide a visible invite challenge-expiry restart path.
- [ ] Run focused auth/RBAC integration tests, then `pnpm.cmd test:int`, API/web/mobile lint, and a task-specific security review.

### Task 3: Invite consume-once and secure MFA secret storage

**Files:**

- Modify: `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.config.ts`, `apps/api/src/common/crypto.ts`, `apps/api/test/auth.int-spec.ts`; create a migration helper only if existing plaintext values need staged conversion.

**Interfaces:**

- Consumes: active invite code and encrypted TOTP storage.
- Produces: one membership per invite and ciphertext-only stored TOTP secret.

- [ ] Write failing concurrent invite registration test using the same non-email-locked invite; exactly one request must succeed.
- [ ] Write a storage regression that setup never persists the raw returned TOTP secret and enable/disable still validate it.
- [ ] Atomically claim the invite (`active -> used`) before membership creation inside the registration transaction; roll back the claim if membership creation fails.
- [ ] Encrypt/decrypt TOTP secrets with a dedicated configured key, use dual-read only for explicitly identified legacy plaintext data, and revoke assurance-less sessions after MFA enablement.
- [ ] Re-run `test/auth.int-spec.ts` and `pnpm.cmd test:int`.

### Task 4: Payout reservation and settlement state machine

**Files:**

- Modify: `apps/api/prisma/schema.prisma`, new payout migration, `apps/api/src/engine/engine.service.ts`, `apps/api/src/payouts/payouts.service.ts`, `payouts.controller.ts`, `payouts.types.ts`, `apps/api/test/payouts.int-spec.ts`, `apps/api/test/sales-wallet.int-spec.ts`

**Interfaces:**

- Consumes: a requested payout and payable ledger rows with `payoutId IS NULL`.
- Produces: `processing` payout reservation; explicit settle/fail transitions.

- [ ] Write failing regressions proving that approval produces `processing`, not `paid`; failed settlement releases rows; settlement moves rows/summaries to paid; and negative net does not violate the payout total check.
- [ ] Run `pnpm.cmd --filter @refearn/api test:int -- --runInBand test/payouts.int-spec.ts test/sales-wallet.int-spec.ts`; confirm old direct-paid behavior fails the new assertions.
- [ ] Reserve eligible ledger entries by setting `payoutId` while retaining `payable`, exclude reserved rows from balances/eligibility, and create exactly one open payout per tenant/member/period.
- [ ] Add staff-authorized settle endpoint requiring a non-empty settlement reference; add fail endpoint that clears reservation and records reason. Only settlement moves ledger and monthly summary balances to paid.
- [ ] Normalize negative-net failed requests to `totalCents: 0n` with an explicit reconciliation reason; block incompatible sale voids while a payout reservation exists.
- [ ] Re-run payout-focused tests and `pnpm.cmd test:int`.

### Task 5: Fail-closed test and provisioning guardrails

**Files:**

- Modify: `apps/api/test/setup-env.ts`, `apps/api/test/global-setup.ts`, `apps/api/test/helpers.ts`, `apps/api/prisma/seed.ts`, `apps/api/prisma/add-platform-admin.ts`, related test files.

- [ ] Write failing unit/integration guard cases for a non-test database URL and for missing explicit provisioning inputs.
- [ ] Add one shared test-URL validator that requires a test database name and rejects production-like URLs before migration or `TRUNCATE`.
- [ ] Make seed and platform-admin tools reject production use without explicit opt-in, require supplied credentials, avoid credential logging, and never silently mutate an existing administrator.
- [ ] Run focused guard tests, then `pnpm.cmd test:int`.

### Task 6: Backup, health, and metrics truthfulness

**Files:**

- Modify: `docker/backup/backup.sh`, `docker/backup/restore-test.sh`, `apps/api/src/health/health.controller.ts`, `apps/api/test/health.int-spec.ts`, `docker/Caddyfile`, `docker-compose.yml`.

- [ ] Add shell-level regression coverage or deterministic command checks for failed `pg_dump`, restore SQL failure, and degraded database health.
- [ ] Preserve pipeline failure status in backup, remove invalid partial artifacts, set `ON_ERROR_STOP`, add cleanup traps, and validate a meaningful restore invariant.
- [ ] Make degraded health return a non-2xx status; expose metrics only through the intended routed/token-protected path.
- [ ] Run `pnpm.cmd --filter @refearn/api test:int -- --runInBand test/health.int-spec.ts` and then the full verification checkpoint.

## Checkpoint: P0 Trust Foundation

- [ ] `pnpm.cmd lint` passes.
- [ ] `pnpm.cmd test` passes.
- [ ] `pnpm.cmd test:int` passes.
- [ ] `pnpm.cmd build` passes.
- [ ] A code review confirms no unsafe direct role or direct-paid payout path remains.

## Follow-on Plans (same goal, after P0 checkpoint)

### Phase 2: Data integrity and scale

- [ ] Add tenant composite relationship constraints after a non-destructive data preflight.
- [ ] Make mutation/audit writes atomic; batch maturation; fix voided commission reporting; add cursor pagination/streaming exports and query indexes.

### Phase 3: Quiet Fintech web foundation

- [ ] Replace Obsidian/Champagne tokens with accessible light/dark semantic tokens; generate and integrate a real brand asset rather than a handcrafted SVG.
- [ ] Consolidate custom overlays onto installed shadcn/Radix primitives; remove undersized hit areas and non-semantic clickable rows.
- [ ] Build one responsive, permission-driven admin/platform navigation shell; add tenant switching and URL-backed filters/pagination.

### Phase 4: Workflow and mobile completion

- [ ] Add confirmations, pending/failed/empty states, correct payment eligibility, MFA/reset/invite UI, and accessible notification/settings behavior.
- [ ] Add mobile single-flight refresh, authenticated route guard, safe-area/touch/contrast corrections, deep linking, push lifecycle, secure storage, and tenant brand parity.

### Phase 5: Operations and product growth

- [ ] Harden containers/backup visibility, alerting, restore verification, performance budgets, and required CI gates.
- [ ] Add a public conversion surface only after positioning and real customer research validate the message.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Dirty main worktree | High | Small sequential patches, scoped diffs, no reset/overwrite, test after every task. |
| MFA contract affects all clients | High | Session assurance migration is backward-safe and old tokens fail closed only where MFA is mandatory. |
| Payout transition changes accounting | High | Reservation before settlement, explicit test coverage, no external provider assumption. |
| Existing data violates new constraints | High | Data preflight and staged `NOT VALID` validation before tenant composite constraints. |
| Logo/design work introduces inaccessible contrast | Medium | Semantic tokens, contrast checks, and browser verification at desktop/mobile widths. |

## Execution Order

1. Task 1, then Task 2 and Task 3.
2. Task 4 only after auth/RBAC tests are green.
3. Tasks 5 and 6 can be reviewed independently but run after the same P0 checkpoint.
4. Start Phase 2–5 only after the P0 checkpoint and a human-visible progress update.
