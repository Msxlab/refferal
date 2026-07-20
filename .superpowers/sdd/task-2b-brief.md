## Task 2B: Implement server-authoritative admin hierarchy reads

**Files:**

- Create: `apps/api/src/members/network-hierarchy.service.ts`
- Create: `apps/api/src/members/network-hierarchy.module.ts`
- Create: `apps/api/src/members/network-hierarchy.service.spec.ts`
- Modify: `apps/api/src/members/members.admin.controller.ts`
- Modify: `apps/api/src/members/members.admin.module.ts`
- Modify: `apps/api/src/members/members.network.contract.spec.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260720160000_network_branch_cursor_index/migration.sql`

Build the admin half of the hierarchy service using the verified contracts and token primitives from Task 2A. Do not implement member `/app/team/tree` endpoints; Task 3 owns the member projection.

### Required endpoints

Declare all static routes before `@Get(':id')`, each with `@Roles(...STAFF)` and `@RequirePermission('network.view')`:

- `GET /admin/members/network-context?scope=full|focused&focusId={uuid}&depth=1..5`
- `POST /admin/members/network-search` with body `{ query, cursor? }`; search query must never be in a URL or audit payload.
- `GET /admin/members/network-children?parentRef={tenant-root-or-uuid}&focusId={uuid?}&cursor={opaque?}&snapshotAt={canonical-iso}`
- `GET /admin/members/network-cluster-children?parentRef={tenant-root-or-uuid}&focusId={uuid?}&clusterRef={opaque}&snapshotAt={canonical-iso}`
- `GET /admin/members/network-list?scope=full|focused&focusId={uuid?}&cursor={opaque?}&snapshotAt={canonical-iso}`

Validate all DTOs with Zod. `scope=focused` requires `focusId`; `scope=full` must not accept a focus. `depth` defaults to 3, is 1–5. Page size is server-fixed at 50. Cursor/cluster references are limited opaque strings. Search is trimmed, min 2, max 120 and body-only.

### Service behavior

1. Create and export `NetworkHierarchyService` in its own module. Inject it into `MembersAdminController`; import the module from `MembersAdminModule`.
2. Use tenant-scoped Prisma + ltree reads. Context initializes a repeatable-read snapshot and returns the Task 2A `AdminNetworkContext`: synthetic tenant root, focus (when focused), ordered ancestors up to company root, initial bounded branch page, exact coverage, and capabilities. Snapshot time must be canonical, within the token TTL, and filter structural reads with `joinedAt <= snapshotAt`.
3. A full context uses virtual `tenant-root` and all real tenant roots (`sponsorMembershipId=null`). A focused context validates `focusId` belongs to the tenant, exposes it at local Tier 1, and only permits child/cluster traversal inside its descendant path. Selecting a member never mutates focus; this service only returns the requested scope.
4. Child pages use `(joinedAt,id)` keyset ordering. Cursor and cluster references must be verified with the Task 2A HMAC helper against actor, tenant, parent/scope key, snapshot, and kind. Verified expired references propagate `409 NETWORK_SNAPSHOT_EXPIRED`; malformed/tampered/replayed references stay generic 400.
5. For every admin member node calculate exact direct and subtree counts from authoritative tenant/ltree queries, never from the loaded page. Set `rank: null` until a batched rank source exists. Local tier is relative to focus (or tenant root in full scope); global tier derives consistently from stored depth.
6. Page budget: return up to 50 individual children. If additional children remain, add a server-authoritative `AdminClusterNode` with the exact remaining count and an HMAC cluster reference whose subsequent expansion returns the next bounded page. Do not claim all nodes are loaded; branch/page coverage must state exact represented count.
7. The accessible list route cursor-paginates every member in the requested full/focused scope without clusters. It must use the same tenant/snapshot/keyset constraints.
8. Search is tenant-scoped server-side by full name/referral code, keyset paginated, excludes rows joined after snapshot, and writes an audit log with only query length/result count/scope metadata—never the raw query.
9. Derive `viewFinancials` from `hasEffectivePermission(user, 'network.financials.view')`; hierarchy requires `network.view` independently. When false, do not issue sale/ledger queries and omit `performance` from every node. When true, return only allowed monthly subtree team volume and approved-sale fields (with tenant currency and `YYYY-MM` period), calculated from the authoritative subtree and snapshot; never derive these from a loaded window. `members.view` controls only `openMember` capability.
10. Add the child traversal index `@@index([tenantId, sponsorMembershipId, joinedAt, id], map: "memberships_tenant_sponsor_joined_id_idx")`. Its migration must be non-destructive and include preflight SQL checks that fail clearly on cross-tenant sponsors, root/path/depth mismatches, or parent path/depth mismatches; it must not re-parent or delete data.

### Tests and verification

- Write database-free service/contract tests that exercise tenant isolation guard paths, full/focused validation, 50-node clustering/pagination contract, cursor scope replay rejection, no raw query audit data, financial field omission when disabled, and exact-count behavior independent of a loaded window. Mocks may be used only to prove these behavior boundaries, not to assert implementation trivia.
- Update existing source contract tests for static route order, URL-free search, query limits, and permission capability split.
- Run the focused API unit tests plus both `apps/api` TypeScript no-emit checks, Prisma validate/generate if local tooling allows, Prettier, and `git diff --check`.

**Non-goals:** no member tree endpoint, no wallet UI, no web hierarchy UI, no drag/drop or sponsor mutation, no raw URL query logging fix (handled after endpoint wiring).

### Controller clarification recorded during implementation

- `network-context.initialPage.items` is a breadth-first, flattened graph page from the synthetic tenant root (full) or focused member (focused), through requested `depth`, with a global cap of 250 individual member nodes. `parentMembershipId` and `localTier` reconstruct edges. `initialPage.parentRef` identifies the root/focus scope key. Once a branch page or global node budget is exceeded, an exact-count cluster represents remaining direct children. `scope.loadedNodes` is individual nodes; `scope.representedNodes` includes exact cluster representation; `complete` means every in-scope node is loaded or represented by an exact cluster. Focus itself is `context.focus` at local Tier 1; its materialized children begin local Tier 2. The standalone children endpoint remains branch-local at 50 individual children.
- Search body stays exactly `{ query, cursor? }`. For a supplied cursor, extract its untrusted canonical snapshot only to pass immediately into full HMAC/canonical/binding verification with parent scope key `search:${sha256(normalizedQuery)}`; no unverified value may reach a database query or audit log. An absent cursor creates a fresh snapshot.
