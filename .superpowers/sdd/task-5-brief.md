# Task 5: Admin Focus Cockpit and HQ hierarchy integration

Implement the admin hierarchy screen after reading the approved design spec and current shared primitives under `apps/web/src/components/network-hierarchy/`. Task 4 owns the shared primitives; import them, do not rewrite or stage their files. Task 3 API may be in progress, but the admin API is complete and stable.

## Files in scope

- Create `apps/web/src/components/admin/network-hierarchy/AdminNetworkHierarchyContent.tsx`
- Create `apps/web/src/components/admin/network-hierarchy/AdminNetworkSearch.tsx`
- Create `apps/web/src/components/admin/network-hierarchy/AdminNetworkToolbar.tsx`
- Create `apps/web/src/components/admin/network-hierarchy/admin-network-hierarchy.module.css`
- Create focused tests in that directory
- Modify `apps/web/src/app/admin/tree/page.tsx`
- Modify `apps/web/src/components/admin/TreePageContent.tsx` (HQ reuse/adapter only)
- Modify `apps/web/src/app/hq/c/[id]/tree/page.tsx` only as necessary for equivalent hierarchy surface.

## Product/design direction

Subject: an admin investigates a real referral network, selects any person, understands their ancestry/branch health, and deliberately focuses them as a local Tier 1 root. The single job is orientation and safe drill-down, not a financial diagram.

Use the approved **Focus Cockpit** direction: obsidian left/utility rail, pearl/ivory workspace, cobalt selection/focus, compact operational typography, and one distinctive but restrained signature: a lineage “signal rail” that connects Company root → ancestors → selected person and makes the current local root visually undeniable. Keep the surrounding workspace quiet, dense, and legible. Respect reduced motion, mobile narrow layouts, and keyboard navigation.

## Behavior

1. `/admin/tree` defaults to hierarchy (`surface=hierarchy`). Value Flow only renders on explicit `surface=value-flow` **and** effective `network.financials.view`; otherwise preserve hierarchy/default safely. Existing `ReferralValueFlowContent` remains the deliberate financial surface.
2. Load `GET /admin/members/network-context` with `scope=full|focused`, `focusId` (when needed), depth 3; maintain response snapshot across subsequent branch/cluster/list requests. Treat `NETWORK_SNAPSHOT_EXPIRED` as a context reload while preserving user URL scope/focus.
3. Use shared admin types/model/tree/list/inspector. Show a truthful `Loaded X of Y` and collapsed-branch count; do not claim all nodes are in the canvas. Select a person without changing root. `Focus as Tier 1` explicitly changes the hierarchy URL to `scope=focused&focus=<membershipId>`; a whole-network action returns to full scope. Show ordered lineage from API ancestors.
4. Search uses only body-backed `POST /admin/members/network-search`; keep draft/debounced search ephemeral (never URL/local storage/analytics). Search select updates `selected`; `Focus as Tier 1` is an explicit separate action. Handle empty/error/loading state and pagination responsibly.
5. Tree/list toggles share selection and expansion state. Expand members via `network-children`; expand clusters via `network-cluster-children`; merge/rebuild model safely. Do not use the legacy 500-node snapshot or `NetworkExplorer`.
6. People/Performance lens: always offer People; only expose Performance control/financial fields when `context.capabilities.viewFinancials`. `Open member` only when `openMember`. Never derive money client side; optional performance must remain safely absent.
7. URL/historical behavior: use shared hierarchy URL builders for surface/scope/focus/view/lens/selected; `router.push` for discrete selection/focus/view actions. Do not let Value Flow `view`/`selected` state collide. Preserve unrelated query params.
8. HQ company route must reuse the hierarchy content/adaptor rather than reintroduce the old leader/NetworkExplorer tree. Ensure the existing active-company token mechanism still scopes calls correctly.
9. Avoid broad reformatting of old Value Flow or unrelated admin pages. Use direct imports and memoize model construction; no new canvas/graph dependency.

## Tests/verification

Add narrow web tests for default hierarchy/vf gating, API endpoint/projection shape, no URL search leakage, snapshot-expiry reload, explicit focus vs selection, capability-gated controls, lineage, exact loaded/collapsed copy, expanded cluster request behavior, and HQ reuse. Run web node tests/typecheck/build checks available locally, formatting/diff checks. Do not stage concurrent Task3/Task4 or parent docs.
