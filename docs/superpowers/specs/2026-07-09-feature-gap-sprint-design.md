# Feature-Gap Sprint — Design Spec

- **Date:** 2026-07-09
- **Branch:** `claude/serene-rosalind-6a05c6` (base: `reconcile/advanced-base`)
- **Author:** Mustafa + Claude
- **Status:** Draft — awaiting review

## Context

An 8-agent ground-truth audit of Americana Earn (2026-07-09) found that the product's
perceived "emptiness" is mostly a UI-execution problem, not missing features: Sales,
Payouts, and Members are already deep (4–5/5) and the backend is production-grade
(4/5). The real work splits into three tracks: (1) a design-system/primitives layer,
(2) the genuinely-thin Platform Command Center, and (3) **this sprint** — a batch of
high-value, mostly-backend-ready feature gaps, including two real money-safety fixes.

This spec covers all 7 items the founder selected, including the activity feed.

> Path links below are relative to this file (`docs/superpowers/specs/`); repo root is three levels up.

## Global constraints & conventions (apply to every item)

1. **Multi-tenant isolation is manual and is the #1 structural risk.** Every new query
   on a tenant-scoped model MUST include `where: { tenantId }` (or go through the
   existing membership scoping). No new endpoint may read/write across tenants.
2. **Money is BigInt cents server-side**; `Number()` only at the display edge.
3. **Audit** every money- or permission-affecting mutation inside the same transaction
   (follow the existing `audit()` helpers in each module).
4. **UI text is English.** Where a status pill is touched, route it through a single
   `statusBadge(status)` helper (see item 3 / cross-cutting) instead of interpolating
   the raw domain string into a CSS class.
5. **No design-system migration here.** Reuse existing `ui.tsx` primitives + `globals.css`
   classes. Systematizing the design layer is a separate track.

## Sequencing

Money-safety first, then quick wins, then the two larger items:

1. Duplicate detection (Sales) — 🔴 money-safety
2. Mandatory reject reason (Payouts) — 🔴 compliance
3. Unsaved-changes guard (Settings) — 🟡
4. Plan-simulator UI wiring (Settings) — 🟡
5. Share presets (Member app) — 🟡
6. Fraud triage screen (Admin) — 🟠 new screen, API ready
7. Activity feed (Member app) — 🟢 hybrid (derive-on-read now)

---

## 1. Duplicate sale detection (Sales) 🔴

**Problem.** `Sale.externalRef` has no uniqueness ([schema.prisma:509](../../../apps/api/prisma/schema.prisma)).
Neither create ([sales.service.ts:58](../../../apps/api/src/sales/sales.service.ts)) nor
CSV import ([sales.service.ts:390-427](../../../apps/api/src/sales/sales.service.ts)) checks
for an existing sale. Re-importing the same file silently creates duplicate draft
sales; once approved, `engine.applyCommissions` distributes **duplicate commissions**
across the tree. Per-sale idempotency exists (`@@unique([saleId, level, type])` on the
ledger) but does NOT protect against two distinct `Sale` rows for the same real-world
transaction.

**Decision.** `externalRef`-based DB uniqueness (partial unique index), plus dedup in
the import preview. Rows without an `externalRef` are unaffected (no false positives).

**Changes.**
- **Migration (safe rollout):**
  - First ship a read-only report query that finds existing collisions:
    `SELECT tenant_id, external_ref, count(*) FROM "Sale" WHERE external_ref IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1`.
    The migration must NOT auto-delete money rows. If collisions exist in prod, they are
    resolved manually (void/merge) before the unique index is created.
  - Add `CREATE UNIQUE INDEX CONCURRENTLY "sale_tenant_external_ref_uq" ON "Sale"(tenant_id, external_ref) WHERE external_ref IS NOT NULL;`
    (Prisma: partial unique index via `@@unique` is not expressible with a `WHERE`; use a
    raw SQL migration.)
- **Create path** ([sales.service.ts:58](../../../apps/api/src/sales/sales.service.ts)):
  catch the unique-violation (Prisma `P2002`) and return a friendly 409
  ("A sale with external reference X already exists").
- **Import preview** ([sales.service.ts:390-427](../../../apps/api/src/sales/sales.service.ts)):
  during `preview=true`, mark a row `duplicate` when its `externalRef` (a) already exists
  in the DB for this tenant, or (b) repeats earlier in the same file. Duplicate rows are
  **skipped** on commit, not created.
- **ImportWizard.tsx** ([ImportWizard.tsx](../../../apps/web/src/components/ImportWizard.tsx)):
  add a `duplicate` (warn) `PreviewRow` variant distinct from `ok`/`error`; show a summary
  count ("N ready · M duplicates skipped · K errors").

**Edge cases.** `externalRef` is stored as entered (already `.trim().max(200)` at
[sales.types.ts:16](../../../apps/api/src/sales/sales.types.ts)); match is exact/case-sensitive.
Null/blank refs never collide. Concurrent double-submit of the create form is caught by the
DB constraint, not just the app check.

**Tests (integration).** (a) Import the same file twice → second import creates zero new
sales and zero new ledger rows, all rows reported `duplicate`. (b) Create a sale with an
existing `externalRef` → 409, no ledger change. (c) Two sales with distinct refs and same
amount/date → both allowed (no false positive).

---

## 2. Mandatory reject reason (Payouts) 🔴

**Problem.** Reject reason is optional on both paths:
`decidePayoutSchema.ref` is `.min(1).max(500).optional()`
([payouts.types.ts:40](../../../apps/api/src/payouts/payouts.types.ts)), and `rejectBatch`
([payouts.service.ts:228](../../../apps/api/src/payouts/payouts.service.ts)) takes no reason
at all. A member's balance can be returned and the request closed with zero recorded
justification — an audit/compliance gap for a check-payout business.

**Changes.**
- **Per-request** `decidePayoutSchema`: add a `.superRefine` so that when
  `action === 'reject'`, `ref` is required (`min(3)`). Keep it optional for `approve`
  (where it is a bank/transfer reference).
- **Batch** `rejectBatch`: add a required `reason` param + a schema; store it in the audit
  `after` payload and emit a member notification, mirroring the per-request reject path
  ([payouts.service.ts:390-398](../../../apps/api/src/payouts/payouts.service.ts)).
- **UI** ([payouts/page.tsx:444-446](../../../apps/web/src/app/admin/payouts/page.tsx)):
  change the reject-modal label from "Reason (optional)" to "Reason (required)", add client
  validation, and disable the submit button until non-empty. Apply the same to the batch
  reject action.

**Tests (integration).** (a) Per-request reject without `ref` → 400; with reason → balance
returned to payable + audit records the reason. (b) Batch reject without reason → 400;
with reason → each member notified + reason in audit.

---

## 3. Unsaved-changes guard (Settings) 🟡

**Problem.** None of the 11 settings tabs track dirty state
([settings sections](../../../apps/web/src/app/admin/settings/sections)). Switching tabs or
navigating away silently discards pending edits to money rules.

**Changes.**
- Add a shared `useDirty(current, baseline)` hook + a sticky `<SaveBar>` showing
  "Unsaved changes" with Save / Discard. Reset the baseline after a successful save.
- Guard both exits: `beforeunload` (browser) and in-app tab switch / route change
  (confirm before discarding).
- Apply to the editable tabs first: **General, Brand, Plan, Reports, Ranks**.
- Extract a small `<SettingsSection maxWidth>` wrapper to normalize the inconsistent
  560/620/640/680 widths while we are in these files.

**Edge cases.** No warning when pristine. Deep-equal comparison must ignore server-added
fields (compare only the editable form slice). Discard restores the last-loaded baseline.

**Tests.** Lightweight: hook unit test for dirty detection; manual/smoke for the guard.

---

## 4. Plan-simulator UI wiring (Settings) 🟡

**Problem.** A real simulator exists server-side
([plans.service.ts:70 `simulate()`](../../../apps/api/src/plans/plans.service.ts), exposed at
[`POST /admin/plans/simulate`](../../../apps/api/src/plans/plans.controller.ts)) that resolves
the real upline chain and marks the company-retained share. The UI ignores it: `Plan.tsx`
recomputes a fake flat $1,000 client-side preview
([Plan.tsx:41-45](../../../apps/web/src/app/admin/settings/sections/Plan.tsx)).

**Changes.**
- Replace the client-side preview with a call to `POST /admin/plans/simulate`.
  Confirm the exact request shape from `simulatePlanSchema`
  ([plans.types.ts:3](../../../apps/api/src/plans/plans.types.ts)) during implementation
  (amount in cents + optional seller/membership id).
- Add an amount input (dollars → cents) and an optional seller picker (reuse member
  search). Render the returned per-beneficiary lines (tier / beneficiary / rate / amount)
  plus the company-kept amount. Loading + error states.

**Edge cases.** No seller selected → simulate the hypothetical full-depth chain per the
schema's default. Amount validation (positive, sane max).

---

## 5. Share presets (Member app) 🟡

**Problem.** The invite screen offers only "copy link"
([invite/page.tsx:96-104](../../../apps/web/src/app/app/invite/page.tsx)) — the single biggest
motivation gap for a mobile-first referral app.

**Changes.**
- Feature-detect `navigator.share()` (Web Share sheet) and offer it first on supported
  (mobile) browsers.
- Fallback preset buttons built from `linkFor(latest)` + the saved welcome message
  (URL-encoded): SMS (`sms:?&body=`), email (`mailto:?subject=&body=`),
  WhatsApp (`https://wa.me/?text=`), X (`https://x.com/intent/tweet?text=`).
- On desktop (no `sms:`), hide/degrade the SMS button.

**Edge cases.** URL-encode message + link. Empty welcome message → use a sensible default
share text. (Optional, out of scope for v1: per-channel UTM tags into the existing invite
funnel.)

---

## 6. Fraud triage screen (Admin) 🟠

**Problem.** A fraud engine exists (5 signals + block-score,
[fraud.service.ts](../../../apps/api/src/fraud/fraud.service.ts)) with a full controller
(list / scan / decide / clear / confirm), but there is **no admin UI**. The dashboard's
"Members flagged for review" to-do dead-ends at the bare `/admin/members` list
([reports.service.ts:169](../../../apps/api/src/reports/reports.service.ts)).

**Changes.**
- New route `apps/web/src/app/admin/fraud/page.tsx` + a nav item in
  [admin/layout.tsx](../../../apps/web/src/app/admin/layout.tsx) (perm-gated).
- Triage queue table: member, score, reasons, status. A "Scan now" action. Per-item
  **decide / clear / confirm** actions, each requiring a note (Confirm dialog).
- Cross-link each flagged member to the existing MemberDrawer and to their sales.
- Repoint the dashboard to-do
  ([reports.service.ts:169](../../../apps/api/src/reports/reports.service.ts)) to `/admin/fraud`.

**Edge cases.** Empty state ("No members flagged"). Server already audits fraud decisions;
UI just needs to pass the note. Confirm before destructive/clear actions.

**Tests.** Backend fraud endpoints already covered; add a smoke test that the queue renders
and a decide action posts the note.

---

## 7. Activity feed (Member app) 🟢 — HYBRID

**Decision.** Derive-on-read now (no new table, history comes for free), but shape the API
contract to match a future `ActivityEvent` row so we can swap the source to a real table
later (for read/unread + realtime) without changing the client.

**Backend.**
- New endpoint `GET /app/activity?cursor=` returning a unified, time-sorted list of
  `ActivityItem { id, type, ts, title, amountCents?, subject? }`, derived from existing
  timestamped sources, all scoped to the member/tenant:
  - `memberships.joinedAt` → "X joined your team" (**direct recruits only, by name**; deeper
    downline is aggregate/anonymized — reuse the privacy model in
    [wallet.service.ts](../../../apps/api/src/wallet/wallet.service.ts)).
  - `sales.approvedAt` → "Your sale was approved".
  - `LedgerEntry.createdAt` where `type = commission` → "Commission credited".
  - `checks.mailedAt` / `paidAt` → "Check mailed" / "Check paid".
  - `invites.usedAt` → "Your invite was accepted".
- Cursor pagination by `(ts, id)` descending. The `type` union and field names deliberately
  mirror a future `ActivityEvent` schema (`type / ts / actor / subject / amount`).

**Frontend.**
- An activity-feed component on Home (and optionally Team), grouped by day, with a
  per-type icon and a teaching empty state ("No activity yet — invite someone to get
  started").

**Non-goals for v1 (documented).** No read/unread state and no realtime push — both are
deferred to the event-table evolution. Realtime can later hook into the existing
`LiveIndicator` / SSE + Web Push infrastructure.

**Tests (integration).** Feed returns items from each source in correct time order; deep
downline joins are aggregated/anonymized (privacy); pagination cursor is stable.

---

## Cross-cutting: `statusBadge` helper

Several of these surfaces render `className={\`badge ${status}\`}` with no fallback, so an
unknown status (e.g. `suspended`) renders an uncolored pill. Where items 1/2/6/7 touch a
badge, add and use a `statusBadge(status)` helper in
[lib/format.ts](../../../apps/web/src/lib/format.ts) mapping every known status to a `.badge`
modifier with a safe default. (Full rollout across all ~80 call sites is part of the
separate design-system track; here we only route the badges we touch.)

## Effort (rough)

| # | Item | Backend | Frontend | Migration/risk |
|---|------|---------|----------|----------------|
| 1 | Duplicate detection | S | S | ⚠️ prod dup-data pre-check |
| 2 | Mandatory reject reason | S | S | — |
| 3 | Unsaved-changes guard | — | M | — |
| 4 | Plan-simulator wiring | — | S | — |
| 5 | Share presets | — | S | — |
| 6 | Fraud triage screen | XS (API ready) | M | perm-gate nav |
| 7 | Activity feed | M | M | privacy scoping |

## Explicit non-goals (separate tracks)

- Design-system / primitives migration, shadcn-vs-hand-rolled decision.
- Platform Command Center.
- Reconciliation v2, first-class Payout Run object, member Segments engine.
- Structural tenant isolation (RLS / Prisma extension) — tracked as the top hardening item.
