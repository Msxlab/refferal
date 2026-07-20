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
- Confirmed only legacy financial tree endpoints changed; non-financial `leaders` and `network-health` retain `network.view`.
- Confirmed no Task 2 hierarchy controller/service stubs or speculative TypeScript APIs were added.
- Confirmed `git diff --check` passed.

## Commit

This report is included in `feat: secure referral network financial access`; the final commit SHA is recorded in the task handoff.
