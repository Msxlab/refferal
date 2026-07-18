# Manual Payout Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require auditable, current manual compliance reviews and a masked payout destination for every member and administrator payout path.

**Architecture:** A `PayoutComplianceService` owns tenant-scoped decision/destination storage and produces a normalized readiness snapshot. `PayoutsService`, `WalletService`, and `EngineService` consume that snapshot rather than creating independent eligibility rules. Reservation and settlement re-read snapshots under their existing transactions.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 17, Zod, React/Next.js existing shadcn-style components, Jest.

## Global Constraints

- Missing, blocked, and expired controls are fail-closed.
- Store only masked destination metadata and opaque references; never store raw bank/KYC/document data.
- Tenant owners and tenant administrators receive both compliance permissions through the existing catalog; the built-in finance/support/analyst roles receive neither unless a custom role is deliberately configured.
- A reviewer cannot review their own membership.
- Every review API mutation is schema-validated, tenant-scoped, and audit-redacted.

---

### Task 1: Compliance persistence and pure readiness mapping

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260717110000_manual_payout_readiness/migration.sql`
- Create: `apps/api/src/payouts/payout-compliance.ts`
- Modify: `apps/api/src/payouts/payout-readiness.ts`
- Test: `apps/api/test/payouts.int-spec.ts`

**Interfaces:**
- `PayoutComplianceKey = 'address' | 'kyc' | 'fraud' | 'sanctions' | 'payment_method'`.
- `evaluatePayoutReadiness(input)` accepts a current decision for each key and a masked destination state.
- Prisma models `PayoutReadinessCheck` and `PayoutDestination` are unique by tenant/member/key and tenant/member/active destination respectively.

- [ ] **Step 1: Write RED evaluator cases**

Add table-driven tests that assert a missing decision maps to `blocked` with `reasonCode: 'review_required'`, an expired ready decision maps to `blocked` with `reasonCode: 'review_expired'`, a blocked decision preserves its controlled reason, and a ready payment-method decision without a verified active destination remains blocked.

- [ ] **Step 2: Run RED**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/payouts.int-spec.ts`

Expected: current code emits `unknown/not_configured` and cannot accept decisions/destination input.

- [ ] **Step 3: Add additive tables and pure domain mapper**

Create the decision model with tenant/member foreign keys, key, status, reason code, reviewer, timestamps, expiry, and integer version. Create the destination model with opaque `providerReference`, `maskedLabel`, optional `last4`, country, currency, reviewer/timestamp/version, and `active`. The migration must use UUID foreign keys, unique tenant/member/key and active-destination protection, and indexes on tenant/status/expiry. It must not backfill any member as ready.

Implement the mapper so `ready` decisions are current only when `expiresAt` is absent or future. Expose no evidence/document field in the type.

- [ ] **Step 4: Verify GREEN**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/payouts.int-spec.ts`

Expected: new evaluator cases pass; existing expectations are updated only where their old "email alone is enough" policy contradicted fail-closed readiness.

### Task 2: RBAC, admin review API, and redacted audit events

**Files:**
- Create: `apps/api/src/payouts/payout-compliance.service.ts`
- Modify: `apps/api/src/payouts/payouts.controller.ts`
- Modify: `apps/api/src/payouts/payouts.types.ts`
- Modify: `apps/api/src/payouts/payouts.module.ts`
- Modify: `apps/api/src/common/permissions.ts`
- Test: `apps/api/test/payouts.int-spec.ts`
- Test: `apps/api/test/rbac.int-spec.ts`

**Interfaces:**
- `PayoutComplianceService.getMemberReadiness(actor, membershipId)` returns checks plus a masked active destination.
- `PayoutComplianceService.review(actor, membershipId, input)` creates/updates a decision and audit record.
- `PayoutComplianceService.setDestination(actor, membershipId, input)` replaces the active masked destination safely.
- Admin routes require `compliance.view` or `compliance.review` in addition to tenant-admin/owner role protection.

- [ ] **Step 1: Write RED authorization and audit tests**

Cover: another tenant returns 404, support/finance without compliance permission returns 403, a reviewer targeting their own membership returns 400, owner/admin may set a ready decision, and audit rows never contain `providerReference`, `last4`, or freeform evidence. Add Zod cases rejecting blank reason codes, invalid ISO country/currency, and unmasked destination labels.

- [ ] **Step 2: Run RED**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/payouts.int-spec.ts test/rbac.int-spec.ts`

Expected: the endpoints and permissions do not exist.

- [ ] **Step 3: Implement only the review surface**

Add `compliance.view` and `compliance.review` to the catalog; include both for owner/administrator defaults and neither in the built-in finance/support/analyst roles. Custom roles may receive either permission through the existing RBAC UI. Add tenant-scoped GET and PUT endpoints beneath `/admin/payouts/members/:membershipId/readiness` and a destination endpoint beneath `/admin/payouts/members/:membershipId/destination`. Use the existing `ActorContext`, `ZodValidationPipe`, `RequireMembership`, `Roles`, `RequirePermission`, and `AuditLog` patterns. Reject self-review by comparing target membership user ID with actor user ID.

- [ ] **Step 4: Verify GREEN**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/payouts.int-spec.ts test/rbac.int-spec.ts`

Expected: tenant/permission/self-review/audit cases pass.

### Task 3: Enforce one policy in wallet, request, preview, reservation, and settlement

**Files:**
- Modify: `apps/api/src/payouts/payout-readiness.ts`
- Modify: `apps/api/src/wallet/wallet.service.ts`
- Modify: `apps/api/src/wallet/wallet.module.ts`
- Modify: `apps/api/src/payouts/payouts.service.ts`
- Modify: `apps/api/src/payouts/payouts.module.ts`
- Modify: `apps/api/src/engine/engine.service.ts`
- Modify: `apps/api/src/engine/engine.module.ts`
- Test: `apps/api/test/fraud-gates.int-spec.ts`
- Test: `apps/api/test/payouts.int-spec.ts`
- Test: `apps/api/test/recommendations.int-spec.ts`

**Interfaces:**
- `PayoutComplianceService.snapshot(tx, tenantId, membershipId)` returns a current normalized snapshot and a deterministic fingerprint material string.
- Engine payout reservation skips/blocks non-ready memberships with reason `compliance_not_ready`.
- `PayoutBatchReview.selectionFingerprint` includes the snapshot material.

- [ ] **Step 1: Write RED bypass and drift tests**

Create a verified-email member with payable ledger entries but no decisions; assert member request returns `400 payout_not_ready`, admin preview excludes it, direct approval/reservation refuses it, and settlement refuses a batch if fraud/sanctions change after reservation. Create a fully reviewed member plus masked destination and assert wallet/request/admin preview all agree it is ready. Change one decision version after preview and assert batch start returns `409 review_required`.

- [ ] **Step 2: Run RED**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/payouts.int-spec.ts test/fraud-gates.int-spec.ts test/recommendations.int-spec.ts`

Expected: admin paths currently bypass compliance and wallet/request diverge from the desired reviewed state.

- [ ] **Step 3: Centralize eligibility**

Import the compliance module into wallet, payouts, and engine modules. Replace hard-coded unavailable checks with the persisted snapshot. In the engine target loop, load/lock snapshot after locking membership and before ledger reservation; add its version material to the review fingerprint and reservation snapshot. Revalidate snapshots inside settlement before moving ledger rows to paid. Keep failure/release explicit; do not auto-release on a compliance conflict.

- [ ] **Step 4: Verify GREEN**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/payouts.int-spec.ts test/fraud-gates.int-spec.ts test/recommendations.int-spec.ts`

Expected: all member and admin payout paths are consistently fail-closed and drift-safe.

### Task 4: Expose the reviewed state in existing interfaces

**Files:**
- Modify: `apps/web/src/app/app/wallet/page.tsx`
- Modify: `apps/web/src/app/admin/payouts/page.tsx`
- Test: `apps/web/src/app/admin/payouts/page.contract.node.test.ts`

**Interfaces:**
- Wallet consumes `payoutReadiness.checks` and renders actionable, non-sensitive status text.
- Admin payout management fetches the readiness endpoint before enabling reserve/approve actions and offers a compact review form for masked destination and individual status.

- [ ] **Step 1: Write RED contract assertions**

Add node contract assertions that the admin page calls only the tenant-scoped readiness/destination endpoints, does not render raw provider reference fields, and disables an action when a selected member is not ready. Add wallet assertions that the request button follows `payoutReadiness.requestable` rather than a legacy reason string alone.

- [ ] **Step 2: Run RED**

Run: `pnpm.cmd --filter @refearn/web test`

Expected: contract assertions fail before the new data is rendered.

- [ ] **Step 3: Implement compact existing-style controls**

Reuse existing `Card`, `Table`, `Badge`, `Button`, `Input`, `Select`, `Modal`, `Alert`, and toast primitives. Show only control name/status/reason/expiry and masked destination. Never put opaque provider references or raw PII into DOM text, browser state, or error toast. Keep the existing payout workflow; readiness gates determine whether buttons are enabled.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm.cmd --filter @refearn/web test`

Run: `pnpm.cmd --filter @refearn/web exec tsc --noEmit`

Expected: contracts and web type-check pass.

### Task 5: Payout regression checkpoint

**Files:** None beyond Tasks 1-4.

- [ ] **Step 1: Run payout regression**

Run: `apps/api/node_modules/.bin/jest.cmd --selectProjects integration --runInBand test/payouts.int-spec.ts test/fraud-gates.int-spec.ts test/recommendations.int-spec.ts test/rbac.int-spec.ts`

- [ ] **Step 2: Run full API integration suite after outbox changes land**

Run: `pnpm.cmd --filter @refearn/api test:int`

Expected: full suite passes using only `refearn_test`.
