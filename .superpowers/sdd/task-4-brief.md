# Task 4: Shared web hierarchy primitives and URL surface separation

This task is independent of the pending API follow-up. Implement only the shared web model/rendering primitives and Value Flow URL separation. Do not replace the `/admin/tree` page yet (Task 5) or `/app/team` (Task 6).

## Required files

- Create `apps/web/src/components/network-hierarchy/types.ts`
- Create `apps/web/src/components/network-hierarchy/network-hierarchy.url.ts`
- Create `apps/web/src/components/network-hierarchy/network-hierarchy.model.ts`
- Create `apps/web/src/components/network-hierarchy/NetworkHierarchyTree.tsx`
- Create `apps/web/src/components/network-hierarchy/NetworkHierarchyList.tsx`
- Create `apps/web/src/components/network-hierarchy/NetworkHierarchyInspector.tsx`
- Create `apps/web/src/components/network-hierarchy/network-hierarchy.module.css`
- Create focused `*.node.test.ts` tests within that directory
- Modify `apps/web/src/components/admin/value-flow/value-flow.url.ts`
- Modify `apps/web/src/components/admin/value-flow/ReferralValueFlowContent.tsx` only as necessary to preserve explicit `surface=value-flow` and prevent optional financial formatting crashes.

## Contracts / rules

1. Mirror the new API DTOs as strict discriminated TypeScript unions. Admin member nodes can carry identity; member direct nodes can carry Tier 1 identity; member anonymous Tier 2/3 types must not expose name/email/code/raw membership ID/exact money. Tier 3 must be terminal in the type/model.
2. Admin URL state: `surface=hierarchy|value-flow`, `scope`, `focus`, `view`, `lens`, `selected`; default hierarchy surface. Never place search text in a URL. Preserve unknown unrelated query params. Selection/focus builder helpers must use a deliberate hierarchy surface.
3. Every Value Flow URL builder / attention navigation must preserve or add `surface=value-flow`, so `view` and `selected` query fields cannot collide with hierarchy state. Do not change its legacy data APIs.
4. Create accessible semantic nested-list tree and equivalent list view. Nodes must be `<button>` actions, have `aria-expanded` / `aria-controls` when expandable, keyboard Enter/Space and Arrow behaviors, visible focus styles; clusters use exact-tier labels such as `+3 Tier 2 members`, never `Tier 2+`. Do not introduce canvas/react-flow or another heavy library.
5. Keep renders scalable: direct imports, no barrel import, model uses maps rather than repeated scans, and long list CSS uses `content-visibility` where safe. Do not start fetches here; Task 5/6 wire data.
6. Inspector must accept a selected discriminated node and only render fields allowed by that node type/capability; optional performance must be guarded/defensively formatted so undefined values cannot reach `.trim()` or similar string calls.
7. Add source/model tests for URL collision prevention, hierarchy default URL, value-flow explicit surface, Tier 3 terminal behavior, anonymous privacy narrowing, exact cluster wording, semantic button/aria requirements, and defensive value-flow format behavior.

## Boundaries

- Preserve existing unrelated changes and parent-owned SDD briefs/review packages.
- Do not stage files outside this task.
- Run the narrow web node tests, TypeScript/build checks available locally, formatting, and `git diff --check`. Commit your task only and report evidence.
