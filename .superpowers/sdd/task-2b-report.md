# Task 2B report: server-authoritative admin hierarchy reads

## Status

Implemented the admin hierarchy read surface on `codex/earnica-referral-value-flow`. The member `/app/team/tree` projection was not added.

## Delivered

- Added `NetworkHierarchyService` and its Nest module, then injected it into `MembersAdminController` through `MembersAdminModule`.
- Added static, staff-only `network-context`, body-only `network-search`, `network-children`, `network-cluster-children`, and `network-list` routes before `@Get(':id')`. Every structural route requires only `network.view`.
- Added Zod validation for full/focused scope invariants, focus UUIDs, depth 1–5 with default 3, canonical snapshot timestamps, tenant-root/member parents, query length 2–120, and bounded opaque references.
- Implemented repeatable-read context initialization with a canonical 15-minute snapshot, `joinedAt <= snapshotAt` structural filtering, synthetic tenant root, focused Tier 1 projection, ordered ancestors, breadth-first depth materialization, a 250-member context budget, 50-child branch budget, and exact collapsed cluster coverage.
- Implemented tenant-scoped ltree ancestor/descendant reads, `(joinedAt,id)` keyset pagination, exact direct/subtree counts, full/focused containment checks, accessible list pagination without clusters, and tenant-wide server search by name/referral code.
- Bound cursors and cluster references to actor, tenant, scope/parent, snapshot, and kind through the Task 2A HMAC primitives. Search cursor snapshots are read only as untrusted candidates and immediately passed into the canonical HMAC verifier. Valid expired references retain `409 NETWORK_SNAPSHOT_EXPIRED`; malformed/tampered/replayed references remain generic 400s.
- Kept `rank: null`. Global tiers come from stored depth; focused local tiers are relative to the immutable focus. Selecting/reading never mutates sponsorship or focus.
- Derived `viewFinancials` and `openMember` independently with `hasEffectivePermission`. Without finance access, no sales/ledger query is issued and `performance` is omitted. With access, the service batches current-month approved-sale count and subtree team volume in tenant currency, constrained to the authoritative snapshot.
- Added a redacted `network.search` audit event containing query length, result count, scope, and pagination state only; it never stores the raw query.
- Added the composite child traversal index to Prisma and a non-destructive migration with explicit cross-tenant sponsor, root path/depth, and parent path/depth preflight failures.

## Test coverage

Database-free tests cover:

- invalid full/focused inputs and cross-tenant focus/parent hiding;
- 50-member branch pagination, exact remainder clustering, and cluster expansion;
- parent/scope cursor replay rejection before data reads;
- body-only bounded search and raw-query-free audit data;
- financial omission and absence of finance reads without permission;
- authoritative structural counts independent of the loaded window;
- repeatable-read focused context coverage and capability separation;
- Task 2A token expiry/privacy contracts and static route ordering/guards.

## Verification evidence

- Focused Jest: 5 suites, 46 tests passed.
- `tsc -p apps/api/tsconfig.json --noEmit`: passed.
- `tsc -p apps/api/tsconfig.build.json --noEmit`: passed.
- `prisma validate --schema apps/api/prisma/schema.prisma`: passed.
- `prisma generate --schema apps/api/prisma/schema.prisma`: passed.
- Prettier check on changed TypeScript: passed.
- `git diff --check`: passed.

Prisma emitted only its existing warning that `package.json#prisma` configuration will be deprecated in Prisma 7.

## Self-review

- Correctness: checked scope invariants, canonical/expired snapshot paths, keyset continuity, exact-count math, focus containment, ancestor ordering, tier derivation, and cluster replacement behavior against the brief.
- Security/privacy: every membership/ltree/sale query is tenant-scoped; cursor verification precedes database reads on replayable routes; search parameters are SQL parameters; raw search text and token subjects are absent from audit records; finance reads are capability-gated.
- Architecture/readability: orchestration, token binding, projection, SQL reads, and DTO construction are separated into private helpers inside the requested service boundary. No new dependency was added.
- Performance: context is bounded to 250 individual nodes, branches/search/list are bounded to 50 plus one lookahead, counts/financials are authoritative batched SQL reads, and the sibling keyset index supports the hot traversal.
- Migration safety: the migration only validates and creates an index; it does not update, re-parent, or delete memberships.

## Concerns / follow-up

- `network-hierarchy.service.ts` is intentionally large (about 1,200 lines) because Task 2B owns five projections, exact coverage math, token binding, and PostgreSQL queries in one requested service. A later refactor could extract a Prisma query adapter without changing its public API, but doing so here would broaden the task and make the security-sensitive diff harder to verify.
- The task requested database-free service/contract tests, so the raw PostgreSQL ltree queries were type/static verified rather than executed against a live local database. Deployment preflight and the existing integration environment remain the appropriate end-to-end SQL gate.
- The migration uses a normal non-destructive `CREATE INDEX` so its preflight checks can live in the same migration; on a very large production membership table, schedule deployment with awareness of the write lock.
