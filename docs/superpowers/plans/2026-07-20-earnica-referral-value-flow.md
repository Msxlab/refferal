# Earnica Referral Value Flow Implementation Plan

> **For Codex:** Execute this plan continuously with subagent-driven development, test-first implementation, browser verification, and an independent final review.

**Goal:** Replace the legacy `/admin/tree` leader landing with the selected “Referral value flow” operations workspace: an interactive, tree-shaped trace from referral sources through qualified sales and commission rules to payout liabilities, with evidence and attention details grounded in existing tenant-scoped APIs.

**Architecture:** Keep the API authoritative and compose the workspace client-side from existing read-only endpoints. Fetch the dashboard, referral tree, network health, to-do queue, commission plans, ranks, and a small approved-sales evidence list in parallel. Normalize them into a typed, bigint-safe read model. Keep the table view light; dynamically load the React Flow canvas only for the network view. Fetch member or sale evidence only after selection so the initial page never creates N+ traffic.

**Tech Stack:** Next.js 15, React 19, TypeScript, React Flow (`@xyflow/react`), Radix/shadcn primitives, Lucide icons, CSS Modules, Node test runner, Playwright/browser QA.

## Approved visual direction

- **Subject:** Earnica tenant operations teams tracing referral value and payout exposure.
- **Single job:** Answer “where did this value come from, how was it distributed, and what needs attention?” without leaving the network workspace.
- **Palette:** Obsidian `#0b1020`, pearl `#f5f2ea`, cobalt `#3157d5`, mint `#187a61`, amber `#b46518`, graphite `#17233b`.
- **Typography:** Existing Sora display face for page/KPI hierarchy, Inter for controls and prose, existing tabular-number treatment for finance values.
- **Layout:** Quiet title/filter rail; KPI strip; one large tree canvas with a persistent desktop evidence dock; a compact attention table below. On narrow screens the dock becomes a sheet and the table becomes a scan-friendly list.
- **Signature:** A provenance spine—selecting any source, sale, commission rule, liability bucket, member, or evidence row highlights the relevant branch and opens the corresponding evidence context.
- **Motion:** Only purposeful state transitions (selection, dock open/close, hover/press); interruptible CSS transitions, exact properties only, `scale(.96)` press feedback, and full `prefers-reduced-motion` support.

### Wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Referral value flow                         [Month] [Program] [Search]       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Attributed revenue │ Net commissions │ Confidence/source │ Open decisions   │
├───────────────────────────────────────────────────────┬──────────────────────┤
│ [Network] [Table]                         [fit] [+/−] │ Attribution evidence │
│                                                       │ selected context     │
│ Direct referrals ─┐                                   │ facts + provenance   │
│                   ├─ Qualified sales ─ Commission ────│ safe next action     │
│ Partner network ──┘                   └ Liabilities    │                      │
├───────────────────────────────────────────────────────┴──────────────────────┤
│ What needs attention                           explicit details/actions      │
└──────────────────────────────────────────────────────────────────────────────┘
```

The direction is intentionally specific to referral-ledger work. It avoids the generic warm-cream/editorial pattern by using the pearl surface as a restrained operational canvas, preserving Earnica’s Sora/Inter utility typography, and spending visual emphasis on the provenance spine instead of decorative cards or gradients.

## Authoritative data contract

Initial requests run concurrently:

```ts
await Promise.all([
  api.get('/admin/dashboard'),
  api.get('/admin/members/tree'),
  api.get('/admin/members/network-health'),
  api.get('/admin/todo'),
  api.get('/admin/plans'),
  api.get('/admin/ranks'),
  api.get('/admin/sales?status=approved&page=1&pageSize=6&sort=saleDate&dir=desc'),
]);
```

Rules:

- `/admin/dashboard` is the authority for selected month, currency, approved revenue, net commission, and liabilities.
- `/admin/members/tree` is the authority for hierarchy and current-month member economics.
- `/admin/plans` supplies configured level rates; the UI must not invent per-level earned amounts.
- `/admin/members/network-health` and `/admin/todo` are operational signals, not persisted statuses.
- `/admin/sales/:id` and `/admin/members/:id` load lazily after selection.
- Currency and month are never inferred in the browser.
- Cent strings remain strings/`bigint` for calculations and use the existing bigint-safe `money()` formatter for display.
- Missing optional sources render explicit “unavailable” states without hiding successful core data.

## Task 1: Restore and align the admin shell

**Files:**

- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/admin/layout.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/components/CommandPalette.tsx`

**Steps:**

1. Reproduce the existing shell contract failure and record the missing desktop selectors.
2. Update the contract test to expect the approved cobalt/obsidian shell rather than the superseded violet value.
3. Restore the lost `.admin-shell`, `.admin-rail`, `.admin-nav-*`, identity, and workspace rules using the previously working shell as the structural reference.
4. Keep every desktop and mobile target at least 44×44 px, retain skip-link/focus behavior, and use explicit transition properties.
5. Rename the navigation label and command-palette destination to “Value flow.”
6. Run the focused shell contract test and web typecheck.

## Task 2: Build the typed value-flow read model (test first)

**Files:**

- Create: `apps/web/src/components/admin/value-flow/value-flow.types.ts`
- Create: `apps/web/src/components/admin/value-flow/value-flow.model.ts`
- Create: `apps/web/src/components/admin/value-flow/value-flow.model.node.test.ts`

**Steps:**

1. Write failing tests for bigint-safe cent addition/subtraction, direct-versus-partner aggregation, liability nodes, plan-rate labels, partial optional-source failures, and stable attention ordering.
2. Define exact API response types and a `ValueFlowWorkspace` view model.
3. Implement pure normalization helpers. Reject malformed cent strings safely rather than coercing them through `Number`.
4. Build graph stages only from authoritative facts. Commission tier nodes show configured rates, not fabricated earned values.
5. Build stable node/edge IDs so selection survives refreshes.
6. Run the model test until green and typecheck the web package.

## Task 3: Implement data loading and workspace states

**Files:**

- Create: `apps/web/src/components/admin/value-flow/ReferralValueFlowContent.tsx`
- Create: `apps/web/src/components/admin/value-flow/ValueFlowSkeleton.tsx`
- Modify: `apps/web/src/app/admin/tree/page.tsx`

**Steps:**

1. Add a focused source-contract test for the existing `/admin/tree` route and loading/error semantics.
2. Load all independent initial endpoints in parallel with required-versus-optional result handling.
3. Prevent stale request completion from overwriting newer search/period state with a request generation guard.
4. Preserve successful core data when an optional evidence/health source fails and expose a retry.
5. Keep view, search, selected entity, and inspector tab in URL query state so refresh/back/forward preserve context.
6. Expose honest period behavior: the current implementation is “this month”; controls that require historic hierarchy data explain why they are unavailable.
7. Switch `/admin/tree` to the new workspace while keeping the existing hierarchy explorer available through the Table/member drill-in path where useful.

## Task 4: Implement the tree canvas and evidence dock

**Files:**

- Create: `apps/web/src/components/admin/value-flow/ReferralValueFlowCanvas.tsx`
- Create: `apps/web/src/components/admin/value-flow/ValueFlowNode.tsx`
- Create: `apps/web/src/components/admin/value-flow/AttributionEvidencePanel.tsx`
- Create: `apps/web/src/components/admin/value-flow/ReferralHierarchyTable.tsx`
- Create: `apps/web/src/components/admin/value-flow/referral-value-flow.module.css`

**Steps:**

1. Dynamically import the React Flow canvas from the workspace so table users do not pay the graph bundle cost.
2. Lay out a left-to-right tree with source, qualified-sale, configured-tier, and liability nodes. Use React Flow handles/edges and Lucide UI icons; do not hand-draw SVG artwork.
3. Add Network/Table semantic tabs, keyboard-operable selection, fit/zoom controls, search, and visible focus states.
4. Highlight the selected branch and keep details synchronized with URL state.
5. Render the desktop evidence dock beside the canvas and a Radix Sheet on tablet/mobile.
6. Lazy-load selected member or sale detail and show provenance, ledger lines, nullable references, and safe links to Sales/Members/Payouts. Do not expose a mutation button without a corresponding safe API contract.
7. Render empty, partial, loading, and error states with a clear safest next action.

## Task 5: Implement attention decisions and responsive polish

**Files:**

- Create: `apps/web/src/components/admin/value-flow/ValueFlowAttention.tsx`
- Modify: `apps/web/src/components/admin/value-flow/referral-value-flow.module.css`
- Modify: `apps/web/src/components/admin/value-flow/ReferralValueFlowContent.tsx`

**Steps:**

1. Combine server-provided to-do items and network-health signals into an explicitly labelled attention list.
2. Give each row a native link/button with a deterministic target or evidence selection; do not make the whole row a fake control.
3. Add desktop table, tablet split, and mobile list/detail layouts at the approved breakpoints.
4. Apply tabular numerals, balanced headings, pretty body wrapping, concentric radii, optical icon alignment, restrained layered shadows, and 44×44 targets.
5. Add only exact-property transitions and reduced-motion overrides. Avoid gradients, decorative pills, excessive cards, and `transition: all`.
6. Verify light and dark themes while keeping the selected pearl/obsidian hierarchy intact.

## Task 6: Wire web tests into CI and verify the implementation

**Files:**

- Create: `apps/web/scripts/run-node-tests.mjs`
- Modify: `apps/web/package.json`
- Create: `apps/web/src/components/admin/value-flow/referral-value-flow.contract.node.test.ts`
- Create: `design-qa.md`

**Steps:**

1. Add a cross-platform test runner that discovers `*.node.test.ts`/`*.node.test.cjs` and invokes Node’s test runner with TypeScript stripping.
2. Add `test` to `@refearn/web` so `turbo run test` no longer skips the web package.
3. Run focused tests, all web node tests, `pnpm --filter @refearn/web lint`, and `pnpm --filter @refearn/web build`.
4. Start the real Next app and use browser request mocking plus a valid local admin session to render `/admin/tree` without changing production auth behavior.
5. Verify 1440×1024, 1024×768, and 390×844; test Network/Table, selection, evidence, retry, URL state, keyboard flow, reduced motion, console, and failed requests.
6. Compare the selected source render and implementation screenshot side by side. Fix visual drift and interaction defects, then repeat.
7. Fetch and apply the current Web Interface Guidelines to the changed UI files.
8. Save `design-qa.md` with tested viewport evidence and the exact final line `final result: passed` only after every blocking issue is resolved.

## Task 7: Independent review and handoff

**Files:**

- Review all changed files and `git diff`.

**Steps:**

1. Run an independent code review focused on data truthfulness, money precision, request races, accessibility, responsive behavior, and bundle boundaries.
2. Address all high- and medium-confidence defects; rerun the smallest failing check after each root-cause fix.
3. Run final verification from a clean command invocation and inspect `git status` for unintended files.
4. Commit only the scoped implementation if all checks pass. Do not push unless the user’s authorization for this branch is still in scope.

