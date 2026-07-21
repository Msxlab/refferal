# Codex continuation handoff - read this first

Last updated: 2026-07-21

This repository is in an active release-hardening branch. Before editing, testing, rebasing, or deploying, read this entire file and then inspect `git status --short`. Preserve every existing change unless its intent is understood. Do not use `git reset --hard`, `git checkout --`, force-push, or delete test data/services.

## Repository

- GitHub: https://github.com/Msxlab/refferal
- Working branch: `codex/earnica-referral-value-flow`
- Active pull request: https://github.com/Msxlab/refferal/pull/8
- Intended production URL: https://earn.oppeinnj.com/
- Current production deployment is NOT confirmed. SSH authentication to the host was rejected; do not claim the app is live.

## What has been completed

### Referral tree / product work

- Admin hierarchy now supports a professional focus-tree workflow: select any member, make them Tier 1, inspect descendants, and retain full identity for admins.
- Member tree is privacy bounded: one direct sponsor above, self as root, Tier 1 full identity, Tier 2-3 anonymized initials/performance summary, no Tier 4+ disclosure.
- Tree pagination/query snapshot behavior was repaired in web and mobile. Existing focused checks passed: web 8/8, mobile 6/6, mobile typecheck.
- Related tree/API contract, RBAC, privacy, and URL-redaction regression coverage was added.

### Security and payout hardening

- JWT/session generation invalidation was strengthened for impersonation/act-as flows.
- Tenant admin RBAC delegation was constrained to canonical allowed permissions.
- Legacy direct payout approval, settlement, retry, and maker-checker mutation routes now fail closed instead of moving money without a signed reviewed batch.
- Admin payout UI uses preview -> signed review -> start processing. A direct request approval opens the reviewed-batch confirmation instead of reserving money directly.
- Manual payout readiness and runtime fraud/KYC/sanctions checks were added at request/reservation time.
- Auto payout requests use the same safe request path and now have readiness, fraud, and concurrency coverage.
- SSE was hardened: no access token in a URL, bearer-authenticated fetch streaming, owner/admin-only access, periodic + per-event membership/role/session revalidation, and staff does not mount the admin live indicator.
- Payout settlement now publishes the canonical `payout.paid` live event and queues matching webhooks after a successful committed settlement.
- Deployment documentation was improved for Caddy versus cPanel/Apache deployments and fail-closed proxy configuration.

### New payout dispatch checkpoint (important current work)

A safer three-step lifecycle is being introduced:

1. `processing`: money is reserved and may still be released.
2. `dispatched`: an admin records the bank/provider hand-off with reference and evidence; compliance is checked at this irreversible checkpoint and the batch can no longer be released.
3. `settled`: bank/provider settlement evidence marks the linked payouts and ledger rows paid.

Current implementation adds:

- Prisma migration: `apps/api/prisma/migrations/20260721140000_payout_dispatch_checkpoint/`
- `PayoutSettlementBatchStatus.dispatched` and dispatch metadata columns.
- `POST /v1/admin/payouts/batches/:id/dispatch`
- Admin UI controls for `Mark dispatched`, `Settle batch`, and safe `Release batch` only before dispatch.
- A shared transaction-scoped PostgreSQL advisory lock for payout risk-state writers (fraud, KYC, sanctions) and payout reservation/dispatch so a new risk decision cannot commit between the final compliance read and payment dispatch.

This work was intentionally saved before the final full test pass. Treat it as in progress until the validation section below is complete.

## Remaining work, in order

1. Run Prisma generation and apply migrations on a disposable/local test database. Do not migrate production until the test matrix is green.
2. Finish adapting payout integration tests to the required lifecycle: `start -> dispatch -> settle`. In particular search for every direct `/settle` and `engine.settlePayoutBatch` call. Add dispatch first, except tests intentionally asserting that settlement before dispatch is rejected.
3. Add/finish regression coverage for:
   - dispatch rechecks fraud/KYC/sanctions and fails closed;
   - a dispatched batch cannot be released/reopened;
   - settlement after dispatch succeeds even if a risk flag changes later (no double-pay release path);
   - payout event/webhook emits exactly once on a successful settlement and not on idempotent/no-op settlement;
   - concurrent risk writer versus dispatch is serialized by the new advisory lock.
4. Re-run API typecheck, focused payout/fraud/audit/event suites, web typecheck/contracts, then the full test matrix in serial groups. Integration tests share a database and call `truncateAll`; never run integration suites concurrently.
5. Inspect `git diff --check`, review the final diff, commit, push this branch, wait for PR #8 checks, and merge only when checks are green.
6. Production deploy remains blocked until the owner supplies valid SSH access for `server.oppeinnj.com` (the previously attempted local key was rejected). Do not guess credentials or report deployment as successful.

## Known test/verification state

Verified earlier in this branch:

- API unit suite: 32 suites / 166 tests passed before the newest dispatch checkpoint work.
- Scheduler + notification focused suite: 31/31 passed before the newest checkpoint work.
- SSE hardening focused checks: API guard 3/3, SSE integration 3/3, web typecheck/contracts 9/9.
- `git diff --check` has passed after the broad changes.
- API TypeScript typecheck passed after the dispatch checkpoint schema/client generation (2026-07-21).
- Web TypeScript typecheck passed after the dispatch UI changes (2026-07-21).

Not yet verified after the latest dispatch/schema work:

- Full integration suite has not passed. A previous full-suite attempt was stopped; do not claim a full pass.
- The direct-approval test migration agent updated `payouts.int-spec.ts`, `fraud-gates.int-spec.ts`, and `audit-remediation.int-spec.ts`, but its final focused run was interrupted by the checkpoint work.

## Local validation commands

Use the bundled Node runtime when `pnpm` is unavailable. Configure the test database/Redis/JWT environment from secure local values first. Example command shape:

```powershell
Set-Location apps/api
$node = 'C:\Users\Mustafa\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node .\node_modules\prisma\build\index.js generate
& $node .\node_modules\prisma\build\index.js migrate deploy
& $node .\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --selectProjects unit --runInBand
```

For integration tests, set the test `DATABASE_URL`, `DATABASE_URL_TEST`, `REDIS_URL`, `JWT_ACCESS_SECRET`, and `NODE_ENV=test`, then run one suite/group at a time with `--selectProjects integration --runInBand`.

## Clone / resume instructions

```powershell
git clone https://github.com/Msxlab/refferal.git
Set-Location refferal
git fetch origin --prune
git switch --track origin/codex/earnica-referral-value-flow
git status --short
```

Prompt a new Codex session with:

```text
Read AGENTS.md and CONTINUE-HERE.md completely before doing anything. Resume the release-hardening work on codex/earnica-referral-value-flow. Preserve existing changes, finish the payout dispatch checkpoint and its test matrix, push PR #8 only after verification, and do not claim production deployment without verified SSH access.
```

## Safety notes

- Do not put `.env`, passwords, tokens, or SSH private keys in Git.
- Do not run destructive git operations or concurrently run integration tests.
- Keep the PR branch prefix `codex/`.
- If a new finding materially changes the payout lifecycle, update this file before handing off again.
