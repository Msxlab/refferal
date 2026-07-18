# Network Ledger Admin Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the admin web application into a premium operational workspace that explains sales, prioritizes payout work, and exposes immutable settlement proof without weakening financial or tenant boundaries.

**Architecture:** Freeze versioned Zod contracts in the existing shared workspace package, project bounded read models from NestJS, and consume them through reusable semantic primitives in Next.js. Keep mutations on existing API routes, make list/filter state URL-driven, lazy-load details, and preserve a working legacy route throughout rollout.

**Tech Stack:** TypeScript, Zod, NestJS 11, Prisma 6, Next.js 15, React 19, Tailwind CSS 4, shadcn/Radix, Python Playwright already available in the workspace runtime.

## Global Constraints

- Inherit every constraint and gate from `2026-07-14-network-ledger-implementation.md`.
- A01 requires explicit permission to change `apps/web/package.json` and `pnpm-lock.yaml`; it adds only `@refearn/shared: workspace:*`, not an external package.
- No UI task starts before its consumed API contract passes integration tests.
- Every cents value stays a string through the component boundary and is formatted by bigint-safe helpers.
- Busy financial overlays cannot close until the server response is reconciled.
- The UI uses indigo for navigation/actions, copper only for money emphasis, emerald for paid, sky for payable, amber for pending/requested/processing, rose for void/reversal/rejected/released, and neutral for draft.
- Status meaning is always text/icon plus color; no glass, decorative gradient, or new animation/chart dependency.

---

## Task A01: Versioned Shared Network Ledger Contracts

**Approval gate:** package/lockfile permission for the existing workspace dependency.

**Files:**

- Create: `packages/shared/src/contracts/network-ledger.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/test/network-ledger-contracts.spec.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: F04 canonical status semantics and F06 nullable plan provenance.
- Produces: Zod schemas and inferred types for admin operations, sale lineage, payout pages/details, audit pages, Money Timeline, invite summary, brand, and tenant switch.

- [ ] **Step 1: Write contract rejection/acceptance tests**

```powershell
New-Item -ItemType Directory -Force 'packages/shared/src/contracts' | Out-Null
```

```ts
it('accepts decimal cent strings and rejects numeric money', () => {
  expect(moneyCentsSchema.parse('-1200')).toBe('-1200');
  expect(() => moneyCentsSchema.parse(1200)).toThrow();
});

it('accepts exact and unresolved legacy plan provenance', () => {
  expect(salePlanV1Schema.parse({ provenance: 'legacy' })).toEqual({ provenance: 'legacy' });
  expect(salePlanV1Schema.parse({
    provenance: 'exact', id: crypto.randomUUID(), name: 'July', effectiveFrom: new Date().toISOString(), poolRateBps: 1000, depth: 5,
  }).provenance).toBe('exact');
});

it('rejects inconsistent canonical totals without Number arithmetic', () => {
  expect(() => canonicalCommissionTotalsV1Schema.parse({
    pendingCents: '1', payableCents: '0', processingCents: '0', paidCents: '0',
    grossCents: '2', reversalCents: '0', adjustmentCents: '0', netCents: '2',
  })).toThrow();
});
```

Add pagination, literal `version: 1` for every newly introduced Network Ledger read model, unknown status, and prohibited-number cases. The compatibility schemas for the existing public-invite, public-brand, and switch-tenant responses do not invent a version field.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/shared exec jest --runInBand test/network-ledger-contracts.spec.ts
```

Expected: module and schemas do not exist.

- [ ] **Step 3: Implement the exact shared contract surface**

Export these schemas/types from `network-ledger.ts` and `index.ts`:

```ts
export const moneyCentsSchema = z.string().regex(/^-?\d+$/);
export const ledgerStatusV1Schema = z.enum(['pending', 'payable', 'processing', 'paid', 'reversed']);
export const ledgerTypeV1Schema = z.enum(['commission', 'reversal', 'adjustment']);
export const canonicalCommissionTotalsV1Schema = z.object({
  pendingCents: moneyCentsSchema,
  payableCents: moneyCentsSchema,
  processingCents: moneyCentsSchema,
  paidCents: moneyCentsSchema,
  grossCents: moneyCentsSchema,
  reversalCents: moneyCentsSchema,
  adjustmentCents: moneyCentsSchema,
  netCents: moneyCentsSchema,
});
```

Add a `superRefine` that converts only validated cent strings to `BigInt` and enforces both invariants from the master contract: `gross + reversal + adjustment === net` and `pending + payable + processing + paid === net`. Never convert financial values to `Number`.

Also export `AdminOperationsSummaryV1`, `SaleCommissionLineageV1`, `PayoutWorkspaceSummaryV1`, `PayableMemberPageV1`, `PayoutRequestPageV1`, `PayoutBatchPageV1`, `PayoutBatchDetailV1`, `AuditPageV1`, `MoneyTimelinePageV1`, `MoneyTimelineDetailV1`, `InviteFunnelSummaryV1`, `PublicInviteResolution`, `PublicBrand`, and `SwitchTenantSession` with the fields defined in the master plan.

- [ ] **Step 4: Add the workspace dependency and run GREEN**

After explicit approval only:

```powershell
pnpm --filter @refearn/web add '@refearn/shared@workspace:*'
pnpm --filter @refearn/shared exec jest --runInBand test/network-ledger-contracts.spec.ts
pnpm --filter @refearn/shared lint
pnpm --filter @refearn/web lint
```

Expected: only the web manifest and root lockfile dependency graph change; contract suite and both typechecks pass.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/shared/src/contracts/network-ledger.ts packages/shared/src/index.ts packages/shared/test/network-ledger-contracts.spec.ts apps/web/package.json pnpm-lock.yaml
git diff --cached --check
git commit -m "feat(shared): add versioned Network Ledger contracts"
```

## Task A02: Canonical Runtime Brand Defaults

**Files:**

- Create: `packages/shared/src/branding.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/test/branding.spec.ts`
- Modify: `apps/api/src/common/branding.ts:3-36`
- Modify: `apps/web/src/lib/brand.ts:1-30`

**Interfaces:**

- Consumes: A01 workspace dependency.
- Produces: shared public-brand defaults/normalization while product-shell name remains application-owned.

- [ ] **Step 1: Write parity and validation tests**

```ts
expect(normalizePublicBrand({ name: 'Acme' })).toEqual({
  name: 'Acme', monogram: 'A', tagline: DEFAULT_PUBLIC_BRAND.tagline,
  primaryColor: '#384BB8', accentColor: '#6F7ACA',
});
expect(normalizePublicBrand({ name: 'Acme', primaryColor: 'red' }).primaryColor).toBe('#384BB8');
```

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/shared exec jest --runInBand test/branding.spec.ts
```

Expected: shared branding module does not exist.

- [ ] **Step 3: Implement one normalization contract**

```ts
export const DEFAULT_PUBLIC_BRAND = {
  tagline: 'Grow your referral network. Earn from real product sales.',
  primaryColor: '#384BB8',
  accentColor: '#6F7ACA',
} as const;
```

Normalize trimmed name, max-two-character monogram, max-120-character tagline, and `#RRGGBB` colors. API derives name/monogram fallback from the tenant; web application env still owns product-shell name.

- [ ] **Step 4: Run GREEN across consumers**

```powershell
pnpm --filter @refearn/shared exec jest --runInBand test/branding.spec.ts
pnpm --filter @refearn/api lint
pnpm --filter @refearn/web lint
```

Expected: shared fixtures pass and the API gold fallback is gone.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/shared/src/branding.ts packages/shared/src/index.ts packages/shared/test/branding.spec.ts apps/api/src/common/branding.ts apps/web/src/lib/brand.ts
git diff --cached --check
git commit -m "fix(shared): unify tenant branding defaults"
```

## Task A03: Premium Semantic Tokens and Ledger Primitives

**Files:**

- Create: `apps/web/src/components/ledger-ui.tsx`
- Create: `apps/web/src/components/ledger-ui.contract.node.test.ts`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/ui/button.tsx`
- Modify: `apps/web/src/components/ui/badge.tsx`

**Interfaces:**

- Consumes: A01 cents/status contracts and `apps/web/src/lib/format.ts` bigint-safe `money()`.
- Produces: `StatusBadge`, `MoneyAmount`, `MoneyFlow`, `AsyncSection`, `SectionHeader`, and `OperationalQueue`.

- [ ] **Step 1: Add source contracts for semantic mapping and money safety**

```ts
assert.deepEqual(STATUS_TONE, {
  paid: 'success', payable: 'info', pending: 'warning', requested: 'warning', processing: 'warning',
  void: 'danger', reversal: 'danger', rejected: 'danger', released: 'danger', adjustment: 'neutral', draft: 'neutral',
});
assert.doesNotMatch(source, /Number\([^)]*(Cents|amount)/);
assert.match(source, /aria-label|sr-only/);
assert.doesNotMatch(css, /backdrop-filter|linear-gradient|radial-gradient/);
```

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test apps/web/src/components/ledger-ui.contract.node.test.ts
```

Expected: new exports and semantic mapping are absent.

- [ ] **Step 3: Implement focused primitives and tokens**

`MoneyAmount` accepts only `string | bigint`; `StatusBadge` maps status to visible label and tone; `AsyncSection` uses a discriminated state union; `OperationalQueue` renders ordered actions, not decorative cards. Implement this exact token baseline, mapping it through the existing shadcn variables rather than creating a second theme engine:

| Token | Light | Dark | Use |
|---|---|---|---|
| canvas | `#F5F7FB` | `#0B1020` | page background |
| panel | `#FFFFFF` | `#121829` | cards/drawers |
| panel-subtle | `#F0F3F9` | `#192137` | grouped rows |
| text | `#111827` | `#F3F6FC` | primary copy |
| muted | `#5B6475` | `#A9B2C3` | supporting copy |
| border | `#DDE3EE` | `#2C3650` | quiet separation |
| action | `#384BB8` | `#8E9BFF` | navigation/primary action only |
| money | `#8A4F12` | `#E7AD63` | financial emphasis only |
| success | `#0F7658` | `#54D2A4` | paid/success |
| info | `#0B65A5` | `#62B9F5` | payable/information |
| warning | `#8A5A00` | `#F0C15B` | pending/requested/processing |
| danger | `#B4233C` | `#FF8797` | reversal/void/rejected/released |

Use the existing system font stack; do not add a font package. Type scale is 28–36px/1.15 for page titles, 18–22px/1.3 for section titles, 14–16px/1.55 body, and 12–13px/1.4 metadata. Money uses `font-variant-numeric: tabular-nums` and `letter-spacing: -0.015em`. Use a 4px spacing base with 12/16px control gaps, 16/20/24px panel padding, and 24/32px section rhythm. Controls use 10px radius, panels 14px, overlays 16px; the only elevated shadow is `0 12px 32px rgb(15 23 42 / 0.08)`. Micro transitions are 120ms and overlay transitions 180ms with `cubic-bezier(.2,.8,.2,1)`; reduced motion collapses them. Do not use glass, gradients, glow, oversized hero cards, or status conveyed by color alone.

- [ ] **Step 4: Enforce coarse-pointer hit targets and run GREEN**

Under `@media (pointer: coarse)`, interactive controls are at least 44x44. Then run:

```powershell
node --experimental-strip-types --test apps/web/src/components/ledger-ui.contract.node.test.ts
pnpm --filter @refearn/web lint
```

Expected: six contract tests pass and typecheck exits `0`.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/components/ledger-ui.tsx apps/web/src/components/ledger-ui.contract.node.test.ts apps/web/src/app/globals.css apps/web/src/components/ui/button.tsx apps/web/src/components/ui/badge.tsx
git diff --cached --check
git commit -m "feat(web): add premium ledger primitives"
```

## Task A04: Async Sections and Busy-Safe Overlays

**Files:**

- Modify: `apps/web/src/components/ui.tsx:161-204`
- Modify: `apps/web/src/components/Drawer.tsx`
- Modify: `apps/web/src/components/useOverlayFocus.ts`
- Create: `apps/web/src/components/overlay.contract.node.test.ts`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**

- Consumes: A03 semantic primitives.
- Produces: overlay props `{ busy?: boolean; dismissible?: boolean }`, focus trap/restore, nested scroll-lock safety.

- [ ] **Step 1: Write overlay behavior contracts**

Assert source paths guard Escape, backdrop, and close button with `busy || !dismissible`; dialog has `aria-modal`, title association, and `aria-busy`; focus cleanup restores the captured trigger.

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test apps/web/src/components/overlay.contract.node.test.ts
```

Expected: current overlays always permit close.

- [ ] **Step 3: Implement the dismissal contract**

Use one close gate everywhere:

```ts
const canDismiss = dismissible && !busy;
const requestClose = () => { if (canDismiss) onClose(); };
```

The hook ignores Escape while busy, restores trigger focus only on actual close, and reference-counts body scroll locks for nested overlays.

- [ ] **Step 4: Run GREEN and reduced-motion verification**

```powershell
node --experimental-strip-types --test apps/web/src/components/overlay.contract.node.test.ts
pnpm --filter @refearn/web lint
```

Expected: normal overlay closes and restores focus; busy overlay cannot close; reduced-motion CSS removes effective transition duration.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/components/ui.tsx apps/web/src/components/Drawer.tsx apps/web/src/components/useOverlayFocus.ts apps/web/src/components/overlay.contract.node.test.ts apps/web/src/app/globals.css
git diff --cached --check
git commit -m "fix(web): make financial overlays mutation safe"
```

## Task A05: Tenant-Aware Admin Shell and Workspace Switcher

**Files:**

- Modify: `apps/web/src/app/admin/layout.tsx`
- Create: `apps/web/src/components/WorkspaceSwitcher.tsx`
- Modify: `apps/web/src/lib/auth.ts`
- Create: `apps/web/src/app/admin/layout.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**

- Consumes: `POST /me/switch-tenant { membershipId }` returning A01 `SwitchTenantSession` data.
- Produces: atomic session merge, route-safe role landing, desktop sidebar and mobile Home/Sales/Payouts/More navigation.

- [ ] **Step 1: Add source/session transition tests**

Test successful admin→admin, admin→member, failed switch, staff payout visibility, mobile primary-nav count, and no tenant branding applied to the product shell.

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/layout.contract.node.test.ts
```

Expected: workspace switcher and four-item mobile model are absent.

- [ ] **Step 3: Implement atomic session replacement**

Add an auth helper:

```ts
export function mergeSwitchedSession(current: Session, next: Pick<Session, 'accessToken' | 'activeMembershipId'>): Session {
  return { ...current, accessToken: next.accessToken, activeMembershipId: next.activeMembershipId };
}
```

Persist only after the response validates; on failure keep current session and workspace. Route through `landingForSession()` after merge.

- [ ] **Step 4: Run GREEN, lint, and responsive browser check**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/layout.contract.node.test.ts
pnpm --filter @refearn/web lint
```

Expected: session/nav contracts pass; 320px shell has no page-level horizontal overflow in the later A15 suite.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/app/admin/layout.tsx apps/web/src/components/WorkspaceSwitcher.tsx apps/web/src/lib/auth.ts apps/web/src/app/admin/layout.contract.node.test.ts apps/web/src/lib/i18n.ts
git diff --cached --check
git commit -m "feat(web): add tenant-aware admin workspace shell"
```

## Task A06: Command Center Operations API

**Files:**

- Modify: `apps/api/src/reports/reports.controller.ts`
- Modify: `apps/api/src/reports/reports.service.ts`
- Modify: `apps/api/test/admin.int-spec.ts`

**Interfaces:**

- Consumes: F04 canonical totals and existing sale/payout/audit state.
- Produces: `GET /admin/operations/summary?month=YYYY-MM` as `AdminOperationsSummaryV1`.

- [ ] **Step 1: Add empty, populated, and tenant-isolation tests**

Assert cash flow buckets, oldest ages, requested/processing counts, draft approvals, failed/released batches, a stable `needsAttention` priority order, maximum five queue rows, and a serialized response below 30 KB. A second tenant's records must not affect any count.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/admin.int-spec.ts
```

Expected: route returns 404.

- [ ] **Step 3: Add bounded aggregate projection**

Return cents strings and at most one queue item per kind from no more than six aggregate/count reads scoped to the selected tenant/month; never fetch raw ledger/person/evidence rows. Priority order is:

```ts
const PRIORITY = ['reconciliation_mismatch', 'processing_over_sla', 'payout_requested', 'sale_needs_approval', 'pending_over_sla'] as const;
```

The dashboard mismatch is the selected month's lightweight ledger-versus-summary aggregate; F13 remains the authoritative full reconciliation. No raw person/evidence records belong in this summary.

- [ ] **Step 4: Run GREEN and lint**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/admin.int-spec.ts
pnpm --filter @refearn/api lint
```

Expected: empty/populated/isolation/permission tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/reports/reports.controller.ts apps/api/src/reports/reports.service.ts apps/api/test/admin.int-spec.ts
git diff --cached --check
git commit -m "feat(admin): expose operations summary"
```

## Task A07: Admin Command Center Web Surface

**Files:**

- Modify: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/components/NextActions.tsx`
- Modify: `apps/web/src/components/TrendChart.tsx`
- Create: `apps/web/src/app/admin/page.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**

- Consumes: A06 operations summary, existing analytics and recommendations.
- Produces: DOM order Needs attention → Cash flow → Sales operations → below-fold analytics.

- [ ] **Step 1: Add layout, error-isolation, and money-safety contracts**

Assert section order, explicit all-clear state, independent async sections, Pending→Payable→Processing→Paid rail, and absence of `Number(...Cents)`.

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/page.contract.node.test.ts
```

Expected: current dashboard leads with generic stat cards and lacks the operations rail.

- [ ] **Step 3: Recompose the page with A03 primitives**

Keep each request in its own `AsyncState`. Queue is first and ordered by API priority. Analytics errors never hide the operational queue. Chart axes may use ratios converted to bounded display numbers; tooltips always format original cents strings.

- [ ] **Step 4: Run GREEN, typecheck, and build**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/page.contract.node.test.ts
pnpm --filter @refearn/web lint
pnpm --filter @refearn/web build
```

Expected: contract suite, typecheck, and production build pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/app/admin/page.tsx apps/web/src/components/NextActions.tsx apps/web/src/components/TrendChart.tsx apps/web/src/app/admin/page.contract.node.test.ts apps/web/src/lib/i18n.ts
git diff --cached --check
git commit -m "feat(web): turn admin dashboard into command center"
```

## Task A08: Sale Commission Lineage API Projection

**Files:**

- Modify: `apps/api/src/sales/sales.service.ts:189-227`
- Modify: `apps/api/test/sales-wallet.int-spec.ts:470-520`

**Interfaces:**

- Consumes: F06 persisted plan ID, ledger captured rates, statuses, maturity, payout links.
- Produces: additive `commission: SaleCommissionLineageV1` in existing admin sale detail.

- [ ] **Step 1: Add exact, legacy, reversal, and tenant-isolation tests**

Assert exact plan metadata for new approval; `{ provenance: 'legacy' }` with no guessed name/pool for null provenance; bigint-safe gross/reversal/adjustment/net strings; matures/payout links; uniform 404 cross-tenant.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/sales-wallet.int-spec.ts
```

Expected: existing detail has line data but no versioned plan/totals projection.

- [ ] **Step 3: Build the additive view model**

Use persisted relation only for exact metadata. Totals use bigint reduction:

```ts
const gross = commissionLines.reduce((sum, line) => sum + line.amountCents, 0n);
const reversals = reversalLines.reduce((sum, line) => sum + line.amountCents, 0n);
const adjustments = adjustmentLines.reduce((sum, line) => sum + line.amountCents, 0n);
const net = gross + reversals + adjustments;
```

Serialize all four with `.toString()`.

- [ ] **Step 4: Run GREEN and lint**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/sales-wallet.int-spec.ts
pnpm --filter @refearn/api lint
```

Expected: exact/legacy/reversal/isolation tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/sales/sales.service.ts apps/api/test/sales-wallet.int-spec.ts
git diff --cached --check
git commit -m "feat(sales): project commission lineage"
```

## Task A09: Sale Commission Lineage Drawer

**Files:**

- Modify: `apps/web/src/app/admin/sales/page.tsx:511-614`
- Modify: `apps/web/src/app/admin/sales/page.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**

- Consumes: A08 `SaleCommissionLineageV1` and A03/A04 primitives.
- Produces: explainable Sale → Applied plan → Beneficiaries → Maturation → Payout/evidence flow.

- [ ] **Step 1: Extend page contracts**

Assert current-plan inference and `Number(line.amountCents)` are absent; exact/legacy labels, line rate, type, status, maturity, payout/batch links, gross/reversal/adjustment/net, and busy overlay props are present.

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/sales/page.contract.node.test.ts
```

Expected: current drawer ignores provenance/maturity/payout fields and converts cents to Number.

- [ ] **Step 3: Recompose the existing drawer**

Use `MoneyFlow` for the proof chain, `MoneyAmount` for every amount, `StatusBadge` for status/type, and a visible “Historical plan unavailable” legacy state. Do not fetch current plans for a legacy sale.

- [ ] **Step 4: Run GREEN, lint, and build**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/sales/page.contract.node.test.ts
pnpm --filter @refearn/web lint
pnpm --filter @refearn/web build
```

Expected: contracts/typecheck/build pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/app/admin/sales/page.tsx apps/web/src/app/admin/sales/page.contract.node.test.ts apps/web/src/lib/i18n.ts
git diff --cached --check
git commit -m "feat(web): explain sale commission lineage"
```

## Task A10: Payout Summary, Batch Page, and Proof APIs

**Files:**

- Modify: `apps/api/src/payouts/payouts.types.ts`
- Modify: `apps/api/src/payouts/payouts.controller.ts`
- Modify: `apps/api/src/payouts/payouts.service.ts`
- Modify: `apps/api/src/common/permissions.ts`
- Modify: `apps/api/test/payouts.int-spec.ts`

**Interfaces:**

- Consumes: immutable batch/item snapshots, F15 minimized/redacted audit boundary, existing settlement state machine, G4 evidence policy.
- Produces: `/admin/payouts/summary`, paginated ready/request/batch views, and `/admin/payouts/batches/:id` proof view models.

- [ ] **Step 1: Add pagination, evidence, privacy, and permission tests**

Cover empty/populated summary; ready/requested/processing/released/history counts and totals; ready-page and request-page pagination; stable batch-page ordering; item sub-pagination; second-tenant 404; `payouts.view` without `payouts.evidence` redaction; exact snapshot totals/checksum/state timeline for an evidence-authorized actor; no live fallback. Serialize representative maximum pages/details and assert list payloads remain at most 100 KB and detail payloads at most 30 KB.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/payouts.int-spec.ts
```

Expected: new read routes do not exist.

- [ ] **Step 3: Add bounded schemas and projections**

Add `{ key: 'payouts.evidence', label: 'View settlement evidence' }` to the permission catalog. Ready, request, and batch page schemas use `{ page: 1.., pageSize: 1..100 }` with default `25`; request/batch status filters keep their existing internal enums. Detail uses `{ itemPage: 1.., itemPageSize: 1..50 }` with default `50`. Use stable orders: ready `(netCents DESC, membershipId ASC)`, requests `(createdAt DESC, id DESC)`, batches `(processingStartedAt DESC, id DESC)`, and detail items `(createdAt ASC, id ASC)`. The summary sources are fixed: ready = threshold-eligible memberships, requested = requested payouts, processing = processing batches, released = failed batches, history = settled batches. Batch detail performs at most three bounded DB reads, enforces the 30 KB response budget, and returns item recipient fields only from immutable snapshots when `payouts.evidence` is present; otherwise `canViewEvidence` is false and both `evidence` and every `recipient` are null. Batch pages enforce the 100 KB response budget. Internal failed state remains API `failed`; UI may label it Released.

- [ ] **Step 4: Run GREEN and lint**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/payouts.int-spec.ts
pnpm --filter @refearn/api lint
```

Expected: read contracts, permission, immutable proof, and existing mutation regressions pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/payouts/payouts.types.ts apps/api/src/payouts/payouts.controller.ts apps/api/src/payouts/payouts.service.ts apps/api/src/common/permissions.ts apps/api/test/payouts.int-spec.ts
git diff --cached --check
git commit -m "feat(payouts): expose operations and proof views"
```

## Task A11: URL-Driven Lazy Payout Workspace

**Files:**

- Modify: `apps/web/src/app/admin/payouts/page.tsx`
- Create: `apps/web/src/app/admin/payouts/payouts-state.ts`
- Create: `apps/web/src/app/admin/payouts/page.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**

- Consumes: A10 summary and paginated active-tab view.
- Produces: `tab=ready|requested|processing|released|history&page=N` URL state; summary + one active request on initial render.

- [ ] **Step 1: Add reducer/query and source contracts**

Test invalid tab/page normalization, back/forward restoration, page reset on filter change, stale-request rejection, the exact tab-to-route mapping, initial request budget, and removal of `listAllPayouts`.

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/payouts/page.contract.node.test.ts
```

Expected: current page eagerly fetches multiple views and loops pages.

- [ ] **Step 3: Implement pure URL state and active-tab loading**

Map exactly one active tab request after the summary: Ready → `/admin/payouts/payable`; Requested → `/admin/payouts?status=requested`; Processing → `/admin/payouts/batches?status=processing`; Released → `/admin/payouts/batches?status=failed`; History → `/admin/payouts/batches?status=settled`. Every route includes the URL `page` and `pageSize=25`. Use an abort signal or monotonic request ID:

```ts
const requestId = ++latestRequest.current;
const result = await api.get<PayoutBatchPageV1>(path);
if (requestId === latestRequest.current) setPage(result);
```

Keep selection only for still-eligible ready rows. Map internal `failed` to visible Released without changing API state.

- [ ] **Step 4: Run GREEN, lint, and build**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/payouts/page.contract.node.test.ts
pnpm --filter @refearn/web lint
pnpm --filter @refearn/web build
```

Expected: URL/request contracts and production build pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/app/admin/payouts/page.tsx apps/web/src/app/admin/payouts/payouts-state.ts apps/web/src/app/admin/payouts/page.contract.node.test.ts apps/web/src/lib/i18n.ts
git diff --cached --check
git commit -m "feat(web): add lazy payout operations workspace"
```

## Task A12: Payout Proof Drawer and Pessimistic Mutations

**Files:**

- Modify: `apps/web/src/app/admin/payouts/page.tsx`
- Create: `apps/web/src/components/PayoutEvidenceDrawer.tsx`
- Modify: `apps/web/src/app/admin/payouts/page.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**

- Consumes: A10 `PayoutBatchDetailV1`, A04 busy-safe drawer.
- Produces: lazy proof detail and refetch-before-retry mutation behavior.

- [ ] **Step 1: Add proof/privacy/mutation contracts**

Assert detail loads only on row activation; reference/evidence/checksum/timeline/count/total are visible; item-page controls preserve the drawer and request at most 50 rows; redacted actors see an explicit permission-safe state; evidence is plain text; loading/error/retry remain inside drawer; busy settle/fail cannot dismiss; network ambiguity triggers detail/list refetch before enabling retry.

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/payouts/page.contract.node.test.ts
```

Expected: current page lacks immutable proof detail and dismisses mutation overlays.

- [ ] **Step 3: Implement lazy detail and pessimistic state**

Use `AsyncState<PayoutBatchDetailV1>` and never mark settled locally. Request `itemPage`/`itemPageSize=50` within the same drawer and discard stale page responses. On mutation success or ambiguous network error, refetch batch and active list; enable retry only when the server still reports a retryable state.

- [ ] **Step 4: Run GREEN, lint, and build**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/payouts/page.contract.node.test.ts
pnpm --filter @refearn/web lint
pnpm --filter @refearn/web build
```

Expected: proof, privacy, and busy-state contracts pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/app/admin/payouts/page.tsx apps/web/src/components/PayoutEvidenceDrawer.tsx apps/web/src/app/admin/payouts/page.contract.node.test.ts apps/web/src/lib/i18n.ts
git diff --cached --check
git commit -m "feat(web): expose immutable payout proof"
```

## Task A13: Server-Filtered Audit Explorer

**Files:**

- Modify: `apps/api/src/reports/reports.controller.ts:14-17,41-47`
- Modify: `apps/api/src/reports/reports.service.ts:233-260`
- Modify: `apps/api/test/admin.int-spec.ts`
- Modify: `apps/web/src/app/admin/audit/page.tsx`
- Modify: `apps/web/src/app/admin/audit/page.contract.node.test.ts`

**Interfaces:**

- Consumes: F15 redacted `AuditPageV1` plus query `q`, `action`, `entity`, `actor`, `from`, `to`, `page`, `pageSize`.
- Produces: filtered total/items/facets; URL is the UI source of truth.

- [ ] **Step 1: Add API and UI contract tests**

API cases: valid combinations, invalid UUID/date/range 400, tenant isolation in items/facets, filtered total, and no raw email/IP/token/secret/payout evidence/reference/reason in items or facets. UI cases: URL restoration, page reset on filter change, server query construction, visible “Sensitive fields redacted” treatment when `redacted` is true, and no client search over only loaded JSON.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/admin.int-spec.ts
node --experimental-strip-types --test apps/web/src/app/admin/audit/page.contract.node.test.ts
```

Expected: API ignores filters and UI filters only a loaded page.

- [ ] **Step 3: Implement tenant-AND-filter query and URL UI**

Build one Prisma `where` rooted at `{ tenantId }`; add search OR only underneath it. Use `(createdAt DESC, id DESC)` for deterministic pages and a transaction for filtered count/items and bounded facet queries. Encode every UI filter in `URLSearchParams`; reset page to `1` when a non-page filter changes. Render redacted `before`/`after` JSON as escaped text only; never use `dangerouslySetInnerHTML`.

- [ ] **Step 4: Run GREEN and lint both apps**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/admin.int-spec.ts
node --experimental-strip-types --test apps/web/src/app/admin/audit/page.contract.node.test.ts
pnpm --filter @refearn/api lint
pnpm --filter @refearn/web lint
```

Expected: API/UI contracts and tenant isolation pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/reports/reports.controller.ts apps/api/src/reports/reports.service.ts apps/api/test/admin.int-spec.ts apps/web/src/app/admin/audit/page.tsx apps/web/src/app/admin/audit/page.contract.node.test.ts
git diff --cached --check
git commit -m "feat(admin): add server-filtered audit explorer"
```

## Task A14: Brand Editor Preview Bound to the Shared Contract

**Files:**

- Modify: `apps/web/src/app/admin/settings/sections/Brand.tsx`
- Create: `apps/web/src/app/admin/settings/sections/Brand.contract.node.test.ts`

**Interfaces:**

- Consumes: A02 shared normalization and existing settings PATCH.
- Produces: honest tenant-brand preview; product shell remains product-branded.

- [ ] **Step 1: Add normalization/form-state contracts**

Assert local fallback constants are absent, preview and payload use shared normalization, invalid colors disable save, error keeps user input, and explanatory copy distinguishes product shell from tenant-facing member/invite surfaces.

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/settings/sections/Brand.contract.node.test.ts
```

Expected: local defaults and divergent preview logic remain.

- [ ] **Step 3: Bind preview and payload to shared normalization**

Use a normalized preview value derived from form state; send only `logoText`, `tagline`, `primaryColor`, and `accentColor`. Show tenant monogram/accent in preview, not a fake uploaded logo.

- [ ] **Step 4: Run GREEN and lint**

```powershell
node --experimental-strip-types --test apps/web/src/app/admin/settings/sections/Brand.contract.node.test.ts
pnpm --filter @refearn/web lint
```

Expected: three contract tests and typecheck pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/app/admin/settings/sections/Brand.tsx apps/web/src/app/admin/settings/sections/Brand.contract.node.test.ts
git diff --cached --check
git commit -m "refactor(web): bind brand editor to public brand contract"
```

## Task A15: Admin Accessibility, Performance, and E2E Checkpoint

**Files:**

- Create: `apps/web/test/e2e/admin-network-ledger.py`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/admin/layout.tsx`
- Modify: `apps/web/src/components/ui.tsx`
- Modify: `apps/web/src/components/TrendChart.tsx`

**Interfaces:**

- Consumes: all A01-A14 routes and components.
- Produces: deterministic browser evidence at 390x844, 768x1024, and 1440x900.

- [ ] **Step 1: Write route-mocked Python Playwright acceptance**

```powershell
New-Item -ItemType Directory -Force 'apps/web/test/e2e' | Out-Null
```

The test bootstraps localStorage session, mocks Network Ledger responses, and checks: shell/skip link, command queue, cash rail, sale drawer, payout lazy request budget, proof drawer, audit URL/back-forward, brand preview, keyboard focus restore, 200% zoom, dark/light/reduced motion, computed foreground/background contrast, console errors, and horizontal overflow.

- [ ] **Step 2: Run RED against the pre-A15 implementation**

```powershell
$env:NODE_OPTIONS=''
python C:\Users\Windows\.agents\skills\webapp-testing\scripts\with_server.py --server "pnpm --filter @refearn/web dev" --port 3000 -- python apps/web/test/e2e/admin-network-ledger.py
```

Expected: at least target-size, heading, focus, or overflow assertions fail before the final corrections.

- [ ] **Step 3: Make only evidence-driven quality corrections**

Ensure one `h1` per route, real `h2` section headings, skip link targets `#main-content`, coarse-pointer controls are 44x44, tables scroll inside their container, reduced motion removes count/slide animation, and chart calculations never convert raw cents directly to Number. Use computed styles to assert primary/muted/status text reaches WCAG AA for its rendered size in both themes; status also retains visible text/icon.

- [ ] **Step 4: Run full admin GREEN checkpoint**

```powershell
pnpm --filter @refearn/api test:int
pnpm --filter @refearn/shared test -- --runInBand
pnpm --filter @refearn/web lint
pnpm --filter @refearn/web build
$env:NODE_OPTIONS=''
python C:\Users\Windows\.agents\skills\webapp-testing\scripts\with_server.py --server "pnpm --filter @refearn/web start" --port 3000 -- python apps/web/test/e2e/admin-network-ledger.py
```

Expected: integration/shared/typecheck/build pass; browser suite reports zero console errors and page overflow. LCP target is <=2.5s and CLS <=0.1 in the mocked production run.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/test/e2e/admin-network-ledger.py apps/web/src/app/globals.css apps/web/src/app/admin/layout.tsx apps/web/src/components/ui.tsx apps/web/src/components/TrendChart.tsx
git diff --cached --check
git commit -m "test(web): verify admin accessibility and performance"
```

## Packet 2 Completion Gate

- [ ] A01 package/lockfile permission was explicit and no external dependency was added.
- [ ] Shared contracts reject number-valued cents and unknown versions.
- [ ] Admin shell clearly separates product brand from active tenant workspace.
- [ ] Command Center prioritizes work before analytics.
- [ ] Sale lineage never guesses a legacy plan and uses bigint-safe totals.
- [ ] Payout workspace fetches summary plus one active page, not every list.
- [ ] Payout proof uses immutable snapshots and pessimistic mutation state.
- [ ] Audit filters and totals are server-side and tenant-scoped.
- [ ] Browser quality gates pass at all three viewports and interaction modes.
