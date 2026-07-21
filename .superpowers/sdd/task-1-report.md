# Task 1 report — Security, permission, and contract-test foundation

Status: DONE

## Delivered

- Added `network.financials.view` to the referral-network permission catalog.
- Included the capability in owner/admin defaults through their existing full-permission seeds, while explicitly excluding it from the analyst view-only helper and the staff/support seed.
- Moved the legacy money-returning `GET /admin/members/tree` and `GET /admin/members/tree-snapshot` route guards to `network.financials.view`, preserving their controller/service TypeScript signatures.
- Added source/contract coverage for the capability split, legacy financial guards, the signed-in-member-bound aggregate wallet team endpoint, and the approved future hierarchy limits/privacy boundary. The hierarchy assertions read the approved design contract rather than inventing Task 2 service APIs.
- Updated the existing tree-snapshot contract expectation to the new financial guard.

## Verification

Passed:

```text
apps/api: jest --config jest.config.js --selectProjects unit --runInBand \
  src/members/members.network.contract.spec.ts \
  src/members/members.tree-snapshot.contract.spec.ts \
  src/wallet/wallet.team-tree.contract.spec.ts

Test Suites: 3 passed, 3 total
Tests:       8 passed, 8 total
```

Passed:

```text
apps/api: tsc -p tsconfig.json --noEmit
```

`pnpm --filter @refearn/api test -- ...` could not start because pnpm detected an inconsistent modules directory and requested an interactive modules purge. To avoid mutating dependencies, verification used the already-installed local Jest binary directly.

## Self-review

- Confirmed owner/admin receive the new permission through `ALL_PERMISSIONS`/`allExcept`, while analyst and support/staff do not receive it implicitly.
- Confirmed the non-financial `network-health` route retains `network.view`; `leaders` is a financial projection and now requires both network permissions.
- Confirmed no Task 2 hierarchy controller/service stubs or speculative TypeScript APIs were added.
- Confirmed `git diff --check` passed.

## Commit

This report is included in `feat: secure referral network financial access`; the final commit SHA is recorded in the task handoff.

## Review follow-up

- Classified `GET /admin/members/leaders` as a financial legacy projection because it returns group volume, group commission, and volume trend values.
- Extended `RequirePermission` to accept one or more permissions while retaining the existing single-permission metadata shape for all existing decorators. The access guard now requires every declared permission; tenant owner and platform admin retain their existing all-permission bypass.
- Applied the combined `network.view` and `network.financials.view` requirement to legacy `tree`, `tree-snapshot`, and `leaders` routes. A financial grant alone therefore cannot confer hierarchy access.
- Updated the RBAC integration matrix to assert: network-only staff receive `403` for all three financial routes; financial-only staff receive `403`; staff holding both permissions receive `200`.

### Follow-up verification

Passed:

```text
apps/api: 3 focused unit suites, 8 tests passed
apps/api: tsc -p tsconfig.json --noEmit
```

Attempted but blocked by local test infrastructure:

```text
apps/api: test/rbac.int-spec.ts
Prisma migrate deploy reached refearn_test at localhost:5434, then failed with Schema engine error.
```

The integration suite was invoked with the bundled Node runtime on `PATH`; the remaining failure is the local Prisma schema engine/database setup rather than a missing Node executable.

### Final review follow-up

- Updated the member detail authorization contract so its single-permission assertions remain string-based and its `leaders` assertion expects the combined permission array.
- Added a database-free `AccessTokenGuard` unit test proving a legacy single-permission route still authorizes normally and a combined route rejects each partial grant while accepting both grants.

Passed:

```text
apps/api: 4 focused unit suites, 20 tests passed
apps/api: tsc -p tsconfig.json --noEmit
```
