# Referral Network Hierarchy — Implementation Plan

> **For Codex:** Execute this plan inline. The user explicitly approved both phases and asked for the complete implementation.

**Goal:** Replace the admin referral-tree default with a scalable, people-first hierarchy; give members a privacy-safe Tier 1–3 network tree; preserve Financial Value Flow as a separately permissioned admin surface; and give HQ and Expo equivalent hierarchy access.

**Architecture:** Add small, purpose-built API projections rather than widening the legacy snapshot. Admin initializes a signed snapshot context, then reads paged branches, clusters, search results, and a full-network list from a server-authoritative hierarchy service. Members read a signed, fixed redacted projection anchored to the active membership. A shared web tree model turns either projection into accessible tree/list UI; admin and member shells supply their own rendering and permissions. The legacy `tree-snapshot` endpoint remains only for the financial Value Flow surface.

**Tech stack:** NestJS 11 + Prisma/PostgreSQL ltree + Zod, Next.js 15/React 19 + TypeScript + lucide, Expo/React Native, pnpm workspace tests.

**Source design:** `docs/superpowers/specs/2026-07-20-referral-network-hierarchy-design.md`

## Fixed API contracts

### Admin hierarchy

- `GET /admin/members/network-context?scope=full|focused&focusId={uuid}&depth=1..5`
  - Requires `network.view` and returns a synthetic tenant root, focused member, ancestor lineage, the first server-authoritative branch page, scope coverage, and capability flags.
- `POST /admin/members/network-search`
  - Requires `network.view`; receives `{ query, cursor? }`, matches name/referral code tenant-side with keyset pagination, and logs only redacted search metadata.
- `GET /admin/members/network-children?parentRef={member-or-tenant-root}&cursor={opaque}&snapshotAt={timestamp}` and `GET /admin/members/network-cluster-children?clusterRef={signed}&cursor={opaque}&snapshotAt={timestamp}`
  - Require `network.view`; return a branch page of 50, with HMAC-signed, actor/tenant/parent/snapshot-bound refs and cursors. Expired snapshots return `409 NETWORK_SNAPSHOT_EXPIRED`.
- `GET /admin/members/network-list?cursor={opaque}&scope=full|focused&focusId={uuid}`
  - Requires `network.view`; gives the accessible list renderer a full cursor-paged traversal without relying on a truncated canvas snapshot.
- Financial fields are omitted (not null) unless caller also has `network.financials.view`. `members.view` controls the `openMember` detail action only, not hierarchy existence.

### Member hierarchy

- `GET /app/team/tree` returns sponsor, self, the first signed branch page, and visible-depth scope; it is bound exclusively to `RequestUser.mid` and accepts no root, search, cursor, or depth parameter.
- `GET /app/team/tree/children?parentRef={opaque}&cursor={opaque}&snapshotAt={timestamp}` and `POST /app/team/tree/direct-search` support bounded visible-depth expansion and direct-member-only search. Each opaque reference is signed to the viewer, tenant, parent, and snapshot.
- Sponsor contains a single full identity only. Self is the root. Tier 1 direct members carry names/code/status and aggregate metrics constrained to local Tiers 1–3. Tier 2–3 records contain only `initials`, `label`, `tier`, `status`, `performanceBand`, and (Tier 2 only) visible child count. Tier 3 has no child/continuation metadata.
- No Tier 4+ member, count, branch, sale, aggregate, or indirect continuation is queried into the response model. Member summary uses only sellers at relative depths 1–3.

## Task 1: Reconcile the shared base and establish contract tests

**Files:**
- Modify: `apps/api/src/common/permissions.ts`
- Create: `apps/api/src/members/members.network.contract.spec.ts`
- Create: `apps/api/src/wallet/wallet.team-tree.contract.spec.ts`

1. Merge `origin/main` with a normal merge commit while the worktree is clean; do not reset or drop current branch commits.
2. Add `network.financials.view` beside `network.view`; seed it for owner/admin and omit it from view-only/staff permissions unless explicitly assigned.
3. Write source/contract tests first asserting the capability split, the legacy financial route guards, and the future hierarchy query caps/privacy field constraints. The static hierarchy route placement is implemented together with its service in Task 2.

## Task 2: Build server-authoritative admin hierarchy reads

**Files:**
- Create: `apps/api/src/members/network-hierarchy.service.ts`
- Create: `apps/api/src/members/network-hierarchy.types.ts`
- Create: `apps/api/src/members/network-hierarchy.tokens.ts`
- Create: `apps/api/src/members/network-hierarchy.module.ts`
- Modify: `apps/api/src/members/members.admin.service.ts`
- Modify: `apps/api/src/members/members.admin.controller.ts`
- Modify: `apps/api/src/members/members.admin.module.ts`
- Modify: `apps/api/src/wallet/wallet.module.ts`
- Modify: `apps/api/src/wallet/wallet.controller.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260720160000_network_branch_cursor_index/migration.sql`
- Extend: `apps/api/src/members/members.network.contract.spec.ts`
- Extend: `apps/api/test/network-tree.int-spec.ts`

1. Implement one `NetworkHierarchyService` shared by admin and wallet modules plus a strict HMAC token helper based on `sales/bulk-scope.ts`; tokens bind actor/viewer, tenant, parent/cluster, sort tuple, snapshot time, and expiry.
2. Implement `adminContext`, `adminChildren`, `adminClusterChildren`, `adminSearch`, and `adminList` using tenant-scoped ltree ancestor/descendant reads and repeatable-read snapshot initialization.
3. Fetch structural fields in bounded queries; calculate exact `directCount`/`subtreeCount` with grouped and ltree aggregate queries, not with a partially loaded in-memory tree. Materialize over-budget content as exact-count cluster nodes and paginate each branch with 50 children.
4. Load sales/revenue/commission fields only when the controller supplies `includeFinancials=true`; avoid ledger and sale queries for callers without the permission. Move legacy `tree`/`tree-snapshot` behind `network.financials.view`, since they expose money and serve only Value Flow.
5. Add the composite sibling traversal index `[tenantId, sponsorMembershipId, joinedAt, id]` through Prisma schema and a non-destructive SQL migration. Include a preflight integrity audit query; do not silently alter sponsorship data.
6. Expose static `/admin/members/network-*` controller methods before `:id` using the new service, validate query/body DTOs with Zod, retain legacy financial tree routes with their financial capability guard, and add a redacted audit event for search. Redact hierarchy search/ref/cursor values from auth and exception URL logs.
7. Test tenant isolation, invalid/expired/replayed tokens, no financial query/projection without the new capability, focus lineage, exact subtree counts beyond branch page size, cluster expansion, and list pagination exhaustiveness.

## Task 3: Build the immutable member privacy projection

**Files:**
- Modify: `apps/api/src/members/network-hierarchy.service.ts`
- Modify: `apps/api/src/wallet/wallet.service.ts`
- Modify: `apps/api/src/wallet/wallet.controller.ts`
- Extend: `apps/api/src/wallet/wallet.types.ts`
- Extend: `apps/api/src/wallet/wallet.team-tree.contract.spec.ts`
- Extend: `apps/api/test/network-tree.int-spec.ts`

1. Use the active membership as the sole root. Fetch one sponsor and only relative-depth 1–3 descendants through ltree depth/path predicates, then serve initial and subsequent visible branch pages using signed opaque parent refs.
2. Project Tier 1 to named records and Tier 2–3 to a separate anonymous union. Generate exactly two initials from the server-held full name, never send member IDs/referral codes/full names/emails for anonymous records; use signed node references instead.
3. Aggregate approved sales and MTD volume only for relative depth 1–3. Bucket anonymous values as `0`, `1-4`, `5-9`, `10+` and `none`, `under-1k`, `1k-5k`, `5k-10k`, `10k-plus`; suppress both when the aggregate cohort has fewer than three people.
4. Render Tier 3 records as terminal DTOs; do not calculate, return, or expose deeper counts. Ensure all member summary metrics use the same 1–3 constraint and clusters never represent Tier 4+.
5. Keep legacy `/app/team` and `/app/team/recruits` for unrelated clients, but remove recruits usage from the new web/member screen so email never reaches its DOM.
6. Add regression tests that serialize context, child pages, and search pages to assert no Tier 4 identifier/count/metric, no anonymous PII, no email, no exact anonymous money, and no effect from adding a Tier 4 sale/member.

## Task 4: Create shared web hierarchy primitives and URL separation

**Files:**
- Create: `apps/web/src/components/network-hierarchy/types.ts`
- Create: `apps/web/src/components/network-hierarchy/network-hierarchy.url.ts`
- Create: `apps/web/src/components/network-hierarchy/network-hierarchy.model.ts`
- Create: `apps/web/src/components/network-hierarchy/NetworkHierarchyTree.tsx`
- Create: `apps/web/src/components/network-hierarchy/NetworkHierarchyList.tsx`
- Create: `apps/web/src/components/network-hierarchy/NetworkHierarchyInspector.tsx`
- Create: `apps/web/src/components/network-hierarchy/network-hierarchy.module.css`
- Create: `apps/web/src/components/network-hierarchy/*.node.test.ts`
- Modify: `apps/web/src/components/admin/value-flow/value-flow.url.ts`
- Modify: `apps/web/src/components/admin/value-flow/ReferralValueFlowContent.tsx`

1. Define discriminated TypeScript unions so `AdminHierarchyNode`, `MemberDirectNode`, and `MemberAnonymousNode` cannot accidentally share identity/financial-only fields.
2. Parse/build admin URLs with `surface=hierarchy|value-flow`; hierarchy defaults to `surface=hierarchy`, while all Value Flow URL builders preserve/add `surface=value-flow`. Keep URL text search out of both paths.
3. Build accessible tree rows from buttons and nested lists: roving focus or conventional sequential buttons, visible focus rings, `aria-expanded`, `aria-controls`, keyboard Enter/Space/Arrow behavior, and buttons instead of clickable `div`/`tr`.
4. Add a responsive list renderer with the same selection/expansion model. Tree budgets use exact-tier cluster labels only (`+N Tier 2 members`, never `Tier 2+`).
5. Make optional node performance slots nullable and format them defensively to eliminate the existing undefined `.trim()` crash when a member is selected.
6. Test URL collision prevention, Tier 3 terminal behavior, cluster wording, keyboard semantics source rules, and render-model privacy type narrowing.

## Task 5: Implement the admin Focus Cockpit

**Files:**
- Create: `apps/web/src/components/admin/network-hierarchy/AdminNetworkHierarchyContent.tsx`
- Create: `apps/web/src/components/admin/network-hierarchy/AdminNetworkSearch.tsx`
- Create: `apps/web/src/components/admin/network-hierarchy/AdminNetworkToolbar.tsx`
- Create: `apps/web/src/components/admin/network-hierarchy/admin-network-hierarchy.module.css`
- Create: `apps/web/src/components/admin/network-hierarchy/*.node.test.ts`
- Modify: `apps/web/src/app/admin/tree/page.tsx`
- Modify: `apps/web/src/app/hq/c/[id]/tree/page.tsx`
- Modify: `apps/web/src/components/admin/TreePageContent.tsx`

1. Replace `/admin/tree` default with the Focus Cockpit and retain `ReferralValueFlowContent` only when `surface=value-flow` and `network.financials.view` are both true.
2. Fetch branch data, selection lineage, and search independently; select a person without changing root, then let `Focus as Tier 1` explicitly set `scope=focused&focus={membershipId}`.
3. Render lineage (`Company root › … › selected`), full/focused switch, tree/list, people/performance lens, `Loaded X of Y`, and collapsed branch count. Only show performance lens/fields under `network.financials.view`; only show `Open member` under `members.view`.
4. Implement paged expansion and server-backed search. Preserve browser history for `scope`, `focus`, `view`, `lens`, and `selected`; use ephemeral in-memory search text.
5. Switch HQ’s tree route to the same component and ensure company id is honored by the existing platform context rather than using the old leader landing page.
6. Write component contract tests for default hierarchy, no implicit focus on selection, surface switching, permission gates, back/forward parsers, and the fixed selected-member error state.

## Task 6: Implement member web tree and remove unsafe UI data paths

**Files:**
- Create: `apps/web/src/components/member-network/MemberNetworkContent.tsx`
- Create: `apps/web/src/components/member-network/member-network.module.css`
- Create: `apps/web/src/components/member-network/*.node.test.ts`
- Modify: `apps/web/src/app/app/team/page.tsx`
- Optionally retain but stop importing: `apps/web/src/components/RadialNetwork.tsx`

1. Replace the radial/aggregate page fetch pattern with `/app/team/tree`; do not call `/app/team/recruits`.
2. Render sponsor strip, anchored self node, full-name Tier 1 cards, anonymous Tier 2–3 cards, exact-tier collapsed sibling labels, privacy copy, visible-scope KPI strip, tree/list, and direct-member-only ephemeral filtering.
3. Block tree expansion below Tier 3 in model and markup. Do not use member id, email, raw anonymous name, exact money, or deeper aggregates in client props/DOM.
4. Add browser-independent contract tests scanning markup/model inputs for forbidden fields and confirming expected direct names/anonymous initials behavior.

## Task 7: Implement Expo outline parity

**Files:**
- Modify: `apps/mobile/app/(tabs)/team.tsx`
- Create: `apps/mobile/src/components/MemberNetworkOutline.tsx`
- Create: `apps/mobile/test/member-network-outline.node.test.cjs`
- Modify: `apps/mobile/src/lib/i18n.ts`

1. Fetch `/app/team/tree`, keep refresh/error behavior, and replace level bars with sponsor/self context plus a semantic accordion outline.
2. Allow Tier 1 and Tier 2 expansion only. Tier 3 has no disclosure control. Show exact-tier `+N Tier N members` summary rows only inside the visible 1–3 data set.
3. Use initials/performance bands from the server directly and do not add a mobile-specific anonymous-data derivation.
4. Test endpoint usage, expansion limits, and absence of prohibited PII/deeper-level wording.

## Task 8: Verify, review, and release

**Files:**
- Modify only as required by test findings.
- Update: `CONTINUE-HERE.md` with implemented commits, routes, verification result, and remaining deployment notes.

1. Run targeted API unit/contract/integration tests, web node tests/typecheck, mobile tests/typecheck, Prisma validate/generate, then workspace builds that are relevant to changed code.
2. Start the web app with available local environment and inspect `/admin/tree?surface=hierarchy` and `/app/team` at desktop and narrow widths. Verify keyboard focus, no horizontal trapping, and selected/empty/error states.
3. Compare implementation against the design spec’s privacy matrix line by line. Search compiled/source inputs for `Tier 2+`, `recruits`, and raw anonymous PII on the member path.
4. Commit logical slices (API contracts, web hierarchy, member/mobile parity), push `codex/earnica-referral-value-flow`, and record the exact validation commands/results in the handoff.

## Verification commands

```powershell
pnpm --filter @refearn/api test -- members.network.contract.spec.ts wallet.team-tree.contract.spec.ts members.tree-snapshot.contract.spec.ts
pnpm --filter @refearn/api test:int -- network-tree.int-spec.ts
pnpm --filter @refearn/api prisma:validate
pnpm --filter @refearn/web test
pnpm --filter @refearn/web typecheck
pnpm --filter @refearn/mobile test
pnpm --filter @refearn/mobile typecheck
pnpm --filter @refearn/api build
pnpm --filter @refearn/web build
```

## Completion criteria

- The default admin route is people hierarchy, while financial value flow still opens deliberately and only with financial permission.
- Admin can search, select, focus, browse lineage, expand branches, and list the whole network without using a truncated snapshot as truth.
- Member clients receive and render exactly sponsor + self + Tiers 1–3, with all Tier 2–3 data redacted/bucketed and no Tier 4 effect.
- HQ and Expo use the same relevant contract.
- Targeted tests, typechecks, builds, visual checks, accessibility checks, and privacy scans pass; changes are committed and pushed.
