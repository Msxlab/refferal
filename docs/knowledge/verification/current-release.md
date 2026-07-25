# Current Release Verification

**Last reconciled:** 2026-07-22
**Evidence boundary:** This page records the active handoff's dated evidence and
the knowledge-vault documentation checks. It does not turn earlier checks into a
current full integration or production-deployment pass.

## Status legend

- `passed`: command/control completed for the stated scope and date.
- `stale`: passed earlier but not after a relevant later change.
- `not-run`: required command has not been run for the stated scope.
- `blocked`: cannot proceed without an external dependency.

## Active payout release evidence

| Control | Date / scope | Status | Evidence and next action |
| --- | --- | --- | --- |
| API unit suite | Before newest dispatch checkpoint: 32 suites / 166 tests | stale | Passed before latest schema/lifecycle work; rerun after dispatch validation changes |
| Scheduler + notification focused suite | Before newest checkpoint: 31/31 | stale | Passed before checkpoint; rerun if affected by final change set |
| SSE guard/integration checks | Before newest checkpoint: API guard 3/3, integration 3/3 | stale | Earlier hardening evidence only |
| API TypeScript typecheck | 2026-07-21, after dispatch schema/client generation | passed | Rerun with focused payout/fraud/audit/event checks before release claim |
| Web TypeScript typecheck | 2026-07-21, after dispatch UI changes | passed | Rerun web contracts/typecheck before release claim |
| Prisma generate and migrate deploy against disposable test DB | Latest dispatch checkpoint | not-run | Configure secure test environment; never apply production migration first |
| Payout integration lifecycle and dispatch regressions | Latest dispatch checkpoint | not-run | Adapt every direct settle path; prove pre-dispatch settlement rejection, risk gates, exactly-once events/webhooks and lock race |
| Full serial integration groups | Latest dispatch checkpoint | not-run | Integration suites share database/truncate state; never run them concurrently |
| Final diff/review/PR checks | Latest dispatch checkpoint | not-run | Inspect final scoped diff, independent review, green PR #8 checks before merge |
| Production deployment | `https://earn.oppeinnj.com/` | blocked | SSH authentication was rejected; valid owner access and independent verification required |

## Knowledge-vault evidence

| Control | Date / scope | Status | Evidence |
| --- | --- | --- | --- |
| Vault Task 1 entrypoint | 2026-07-22: AGENTS, START-HERE and `.obsidian` boundary | passed | Relative handoff link resolved; `.obsidian/workspace.json` ignored; no tracked Obsidian state; `git diff --check` passed |
| Vault Task 1 independent review | 2026-07-22 | passed | Review findings on missing future records, `.env` wording and sequence ambiguity were corrected before commit |
| Vault Task 2 evidence | Current work | not-run | Re-run the final vault documentation checker after all vault tasks exist |

## Claim boundary

Do not use this page to claim that production is live, that all integration tests
pass, or that a visual decision is implemented. Each claim requires a dated row
with the exact scope and fresh evidence.
