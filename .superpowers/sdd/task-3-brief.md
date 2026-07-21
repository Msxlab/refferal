# Task 3: Immutable member privacy projection

Implement only the server-side member hierarchy projection. Task 2 is complete at `03be3e7`; reuse its `NetworkHierarchyService`, types, and signed-token helpers. Do not change web/mobile pages yet (Task 6 owns them), and preserve legacy `GET /app/team` and `GET /app/team/recruits` unchanged for unrelated clients.

## Files in scope

- `apps/api/src/members/network-hierarchy.service.ts`
- `apps/api/src/wallet/wallet.service.ts`
- `apps/api/src/wallet/wallet.controller.ts`
- `apps/api/src/wallet/wallet.module.ts`
- `apps/api/src/wallet/wallet.types.ts`
- `apps/api/src/wallet/wallet.team-tree.contract.spec.ts`
- `apps/api/test/network-tree.int-spec.ts` (extend if environment permits; do not weaken existing coverage)
- focused new unit/spec files within `apps/api/src/wallet` or `apps/api/src/members` when necessary

## Routes and root authority

Add static member routes before legacy `team` routing conflicts:

- `GET /app/team/tree`
- `GET /app/team/tree/children?parentRef=<opaque>&cursor=<opaque?>&snapshotAt=<canonical ISO>`
- `POST /app/team/tree/direct-search` body exactly `{ query, cursor? }`

All are under `@RequireMembership()` and derive tenant, viewer user id, and **sole root** exclusively from `RequestUser.mid`/token. They must not accept a membership root, arbitrary focus, depth, or URL search text. Thread `user.sub` into the hierarchy actor so opaque refs are viewer-bound.

Wire via `WalletService` and `NetworkHierarchyModule` rather than duplicating token/ltree logic. Use tenant/membership context assertions before delegation where consistent with the rest of wallet surface.

## Projection invariants (non-negotiable)

1. Fetch exactly one sponsor (or null), self, and descendants with **relative local tier 1–3 only**. The query boundary must exclude Tier 4+ before projection. Initial context plus expansion/search must never return, count, cluster, metric, token subject, continuation hint, or serialized string for Tier 4+.
2. Self is the only member root. Sponsor has exactly the single approved full-identity shape. Tier 1 direct records may have full name, initials, referral code, status, signed opaque `nodeRef`, direct/visible-branch count, and exact performance only for the visible Tier 1–3 window.
3. Tier 2 and Tier 3 use the existing anonymous union only. They must never carry `membershipId`, full name, email, referral code, exact money, commission, balance, raw UUID, or a parent raw ID. Generate exactly two server-side initials and signed opaque refs. Do not cast raw strings to privacy brands.
4. Tier 3 is terminal in DTO, query behavior, and UI-facing continuation metadata: `canExpand:false`; no child count, cursor, cluster, deeper count, or deeper query. No Tier 4 clusters ever.
5. Member structural and money metrics are strictly limited to local tiers 1–3 at the snapshot. Tier 4 sale/member changes must not alter context, children, search, counts, exact Tier 1 aggregates, or anonymous performance bands.
6. Anonymous performance bands exactly follow existing API type literals: approved sales `0 | 1-4 | 5-9 | 10+`; volume `none | under1k | 1k-5k | 5k-10k | 10k+`. Suppress both (`{suppressed:true, reason:'smallCohort'}`) when the aggregate cohort has fewer than 3 people; use `noData` only when appropriate and never invent an exact value.
7. Snapshots/refs: fresh context supplies canonical `snapshotAt`; direct/anonymous node refs and cursors must be HMAC-signed, canonical, viewer/tenant/root/snapshot-bound. Parent cursors additionally bind the passed opaque parent ref. A valid correctly bound expired ref yields `409 NETWORK_SNAPSHOT_EXPIRED`; unsigned/tampered/replayed/foreign refs stay generic `400`/`404` without DB reads or information leakage. Since node-token payloads cannot expose membership UUIDs, resolve server-side only within the visible root/tier scope using timing-safe matching.
8. Direct search is tenant/root scoped and returns only Tier 1 direct nodes. It is body-only, min 2/max 120, cursor-paginated, audit/log-redacted like admin search; raw query never reaches audit data or URL logs. Search result identity is allowed because Tier 1 is allowed.
9. Apply a server-fixed page/canvas budget and make any Tier 1–3 cluster exact for the visible level; clusters must name an exact tier (not `Tier 2+`) and never represent Tier 4+.

## Security and correctness specifics

- Every membership, ltree, and sales query is tenant-bound and snapshot-bound (`joinedAt <= snapshotAt` where structural consistency needs it).
- Query parent candidates only from the viewer’s own root + visible local tiers; cross-tenant, sibling, ancestor, or arbitrary opaque refs must not reveal existence.
- Do not add raw query/ref/cursor values to logs/audit. The shared URL redactor already covers `/app/team/tree*`; preserve it.
- Preserve 250-member global budget behavior; if self is separately rendered, reserve its slot just as focused admin contexts do.
- Do not use legacy `/app/team/recruits` response to construct this projection.

## Tests and verification

Add database-free service/contract tests that serialize every context, children page, and direct-search response and assert:

- one sponsor maximum; self root; Tier 1 named data allowed;
- Tier 2/3 have no PII/raw IDs/exact money; opaque refs are not UUIDs; Tier 3 terminal;
- no Tier 4 text/count/metric/cluster/continuation; altering a Tier 4 member/sale does not change returned visible data;
- actor/tenant/parent/snapshot replay rejection happens before DB reads;
- direct search returns Tier 1 only and audit payload excludes raw query;
- cursor expiry semantics and route schema/order are locked.

Run narrow tests, both API TypeScript configs, Prisma validate/generate, formatting/diff checks. Integration may be attempted if local migration environment permits; report an environment-only failure rather than masking it. Do not stage parent-owned SDD brief/review files or concurrent web changes.
