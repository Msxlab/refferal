# Task 2B follow-up — bounded hierarchy reads and preflight hardening

Base: `016f057` (Task 2B plus the redaction/test follow-up).

Fix these review blockers only. Preserve current API shapes and the parent-owned `task-2b-brief.md` / review-package files; stage only files you edit for this follow-up.

## 1. Bound initial context reads before recursion

`readContextMembers` currently expands a recursive CTE across all eligible branches before its outer `LIMIT 250`; a depth-5, 50-ary tree can materialize hundreds of millions of rows.

Replace it with iterative, level-by-level BFS inside the existing repeatable-read transaction:

- maximum `depth` rounds, only starting from synthetic tenant root or focus and then the prior loaded frontier;
- hard global individual-member budget `ADMIN_CONTEXT_NODE_BUDGET` (250), checked before each level;
- deterministic sibling order `(joined_at, id)`, at most `ADMIN_HIERARCHY_PAGE_SIZE` (50) children per loaded parent;
- use tenant/snapshot filters on every query and the child traversal index; use a per-parent bounded lateral/subquery approach rather than scanning/recursing the full descendants;
- globally deterministic order for candidates and no descendants query once the global budget is exhausted;
- retain exact branch summaries/clusters for omitted siblings, budget cutoff, and depth cutoff. `loadedNodes`, `representedNodes`, and `complete` must retain their stated semantics.

Add a database-free regression test that models a depth-5 wide tree / helper behavior and proves max 250 loaded individuals, no more than `depth` bounded level reads, and no level read after budget exhaustion. Prefer behavior/helper assertions over fragile raw-SQL snapshots.

## 2. Reject unsigned expired snapshots as invalid

For initial `/network-children` and `/network-list` calls with no cursor, `snapshotAt` is caller controlled. A stale unsigned timestamp must fail generic `400`, not `409 NETWORK_SNAPSHOT_EXPIRED`. Retain `409` only after a valid actor/tenant/parent/snapshot-bound HMAC cursor or cluster reference was verified. Add coverage.

## 3. Migration orphan-parent preflight

Before the index, add an explicit `LEFT JOIN` preflight that rejects a non-null `child.sponsor_membership_id` with no matching sponsor. Add/extend a migration SQL/source contract test so the guard cannot silently disappear. Keep the migration non-destructive.

## Verification

Run focused Task 2 API tests, API typecheck (both configs), Prisma validate/generate, formatting/diff checks. Report any environment-only blocker separately.
