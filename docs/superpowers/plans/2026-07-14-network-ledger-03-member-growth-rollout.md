# Network Ledger Member, Growth, Native, and Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give members a privacy-safe Money Timeline, make invite growth measurable from authoritative business events, prove web quality in a pilot, and deliver native parity only after secure session storage is approved.

**Architecture:** Extend the existing paginated wallet and invite services with member-owned projections, consume them in web before native, and derive rollout metrics from ledger/payout/invite truth rather than client events. Treat native secure storage, production cohort controls, and interaction analytics as explicit gates.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Next.js 15, React 19, Expo 52, React Native 0.76, Jest 29, Python Playwright available locally.

## Global Constraints

- Inherit every constraint and gate from `2026-07-14-network-ledger-implementation.md`.
- Member detail uses authenticated `mid`/`tid`, uniform 404, and an allowlisted projection.
- Invite funnel v1 uses only issued, active, expired, joined, email-verified, and first-approved-sale facts.
- Viewed/started/client-interaction counts are not shown before ProductEvent/privacy approval.
- Native session secrets cannot remain in AsyncStorage for production rollout.
- Offline/cached native money must display stale state and last-updated time.
- Browser tests use the existing Python Playwright runtime; no npm test package is added.

---

## Task M01: Deterministic Wallet Pagination and Private Ledger Detail API

**Files:**

- Modify: `apps/api/src/wallet/wallet.types.ts`
- Modify: `apps/api/src/wallet/wallet.controller.ts`
- Modify: `apps/api/src/wallet/wallet.service.ts:68-167`
- Modify: `apps/api/test/sales-wallet.int-spec.ts`
- Create: `apps/api/test/network-ledger-performance.int-spec.ts`

**Interfaces:**

- Consumes: A01 `MoneyTimelinePageV1`/`MoneyTimelineDetailV1`, A10 payout settlement mutation, F14 composite index, authenticated membership/tenant context.
- Produces: stable `(createdAt DESC, id DESC)` list and `GET /app/wallet/:ledgerEntryId` own-entry detail.

- [ ] **Step 1: Add pagination, detail allowlist, and IDOR tests**

Create equal-timestamp entries and assert no duplicate/skip across pages. For detail, assert own entry returns only allowlisted fields; another member, another tenant, and nonexistent UUID all return the same 404 response. Assert response JSON lacks seller/user/member identity, customer/external reference, sale amount, snapshot, settlement evidence, and settlement reference.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/sales-wallet.int-spec.ts
```

Expected: detail route is missing and equal timestamps are not deterministically ordered.

- [ ] **Step 3: Add stable ordering and explicit projection**

Use:

```ts
orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
```

Detail query roots at `{ id: ledgerEntryId, tenantId, beneficiaryMembershipId: membershipId }`. Select only entry fields, safe sale ID/date, and payout status/period/timestamps. Serialize every bigint as a string.

- [ ] **Step 4: Add the representative performance/concurrency gate**

In the opt-in performance suite, create one representative tenant with 100,000 ledger rows using a set-based SQL fixture. Warm five reads, then measure thirty first-page reads, thirty deep-page reads (`page=4000&pageSize=25`), and thirty detail reads; require each p95 below 1,000 ms on the recorded baseline runner. Assert `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` uses `ledger_entries_tenant_beneficiary_created_id_idx` without a sequential scan of `ledger_entries`. Run 25 simultaneous member detail reads while settling one eligible payout batch; assert all reads remain tenant/private, the mutation succeeds once, no pool timeout occurs, and ledger/payout reconciliation remains zero.

- [ ] **Step 5: Run GREEN, the opt-in performance gate, and lint**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/sales-wallet.int-spec.ts
$env:RUN_NETWORK_LEDGER_PERF='1'
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/network-ledger-performance.int-spec.ts
$env:RUN_NETWORK_LEDGER_PERF=$null
pnpm --filter @refearn/api lint
```

Expected: pagination, own detail, uniform 404, allowlist, legacy compatibility, exact index plan, p95 target, and 25-read/payout concurrency all pass.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/api/src/wallet/wallet.types.ts apps/api/src/wallet/wallet.controller.ts apps/api/src/wallet/wallet.service.ts apps/api/test/sales-wallet.int-spec.ts apps/api/test/network-ledger-performance.int-spec.ts
git diff --cached --check
git commit -m "feat(wallet): add private ledger entry details"
```

## Task M02: Web Money Timeline and Proof Drawer

**Files:**

- Modify: `apps/web/src/app/app/wallet/page.tsx`
- Create: `apps/web/src/components/MoneyTimeline.tsx`
- Create: `apps/web/src/app/app/wallet/page.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**

- Consumes: M01 list/detail and A03/A04 primitives.
- Produces: URL page state, status/maturity explanation, lazy own-entry drawer.

- [ ] **Step 1: Add page and privacy contracts**

Assert `?page=N&pageSize=25`, Previous/Next, page/total label, out-of-range recovery, stale-request guard, detail lazy request, visible status+type+level+rate+maturity+payout state, and absence of prohibited PII labels.

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test apps/web/src/app/app/wallet/page.contract.node.test.ts
```

Expected: current page fetches only the first default page and has no detail drawer.

- [ ] **Step 3: Build timeline and drawer states**

Use URL search params as source of truth. Timeline entry button opens a busy-safe drawer with its own `AsyncState<MoneyTimelineDetailV1>`. Preserve visible list while the detail loads, but disable stale page interaction while a replacement page request is active. Use `MoneyAmount` and `StatusBadge`; never display cached money as current after an error.

- [ ] **Step 4: Run GREEN, lint, and build**

```powershell
node --experimental-strip-types --test apps/web/src/app/app/wallet/page.contract.node.test.ts
pnpm --filter @refearn/web lint
pnpm --filter @refearn/web build
```

Expected: page/detail/privacy contracts, typecheck, and build pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/app/app/wallet/page.tsx apps/web/src/components/MoneyTimeline.tsx apps/web/src/app/app/wallet/page.contract.node.test.ts apps/web/src/lib/i18n.ts
git diff --cached --check
git commit -m "feat(web): add member Money Timeline"
```

## Task M03: Authoritative Invite Funnel API

**Files:**

- Modify: `apps/api/src/invites/invites.controller.ts`
- Modify: `apps/api/src/invites/invites.service.ts:138-184`
- Modify: `apps/api/test/auth.int-spec.ts`

**Interfaces:**

- Consumes: caller-owned invites, `usedByMembershipId`, joined user's `emailVerifiedAt`, and approved sales.
- Produces: `GET /app/invites/summary` as `InviteFunnelSummaryV1`.

- [ ] **Step 1: Add empty, monotonic, and tenant-isolation tests**

Create active, expired, joined-unverified, verified, and first-approved-sale invite fixtures. Assert:

```ts
expect(summary.issued).toBeGreaterThanOrEqual(summary.joined);
expect(summary.joined).toBeGreaterThanOrEqual(summary.emailVerified);
expect(summary.emailVerified).toBeGreaterThanOrEqual(summary.activatedByApprovedSale);
```

Another inviter/tenant must not affect any count.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/auth.int-spec.ts
```

Expected: summary route returns 404.

- [ ] **Step 3: Implement member-owned aggregate query**

Return `{ version: 1, issued, active, expired, joined, emailVerified, activatedByApprovedSale }`. `issued` includes all caller-created links; `active`/`expired` derive current validity; joined requires consumed invite; email verification requires joined user verification; activation requires at least one approved sale by that joined membership. Return no identities or sale details.

- [ ] **Step 4: Run GREEN and lint**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/auth.int-spec.ts
pnpm --filter @refearn/api lint
```

Expected: empty, populated, monotonic, permission, and isolation tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/invites/invites.controller.ts apps/api/src/invites/invites.service.ts apps/api/test/auth.int-spec.ts
git diff --cached --check
git commit -m "feat(invites): expose authoritative member funnel"
```

## Task M04: Member Invite Workspace

**Files:**

- Modify: `apps/web/src/app/app/invite/page.tsx`
- Create: `apps/web/src/app/app/invite/page.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**

- Consumes: M03 summary and existing create/list routes.
- Produces: ordered funnel, create/share controls, independent partial-error states.

- [ ] **Step 1: Add funnel and refresh contracts**

Assert list+summary parallel load, visible label+count for every authoritative stage, no viewed/started stage, create success refetches both resources, one resource failure leaves the other visible, and active/expired status is text plus color.

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test apps/web/src/app/app/invite/page.contract.node.test.ts
```

Expected: summary/funnel does not exist.

- [ ] **Step 3: Compose the workspace with independent async sections**

Order `Issued → Joined → Email verified → First approved sale`; show active/expired link counts alongside, not as invented conversion events. Keep current QR/share behavior and income disclaimer. Use tenant branding only in share/preview surfaces.

- [ ] **Step 4: Run GREEN, lint, and build**

```powershell
node --experimental-strip-types --test apps/web/src/app/app/invite/page.contract.node.test.ts
pnpm --filter @refearn/web lint
pnpm --filter @refearn/web build
```

Expected: funnel/partial-state contracts, typecheck, and build pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/app/app/invite/page.tsx apps/web/src/app/app/invite/page.contract.node.test.ts apps/web/src/lib/i18n.ts
git diff --cached --check
git commit -m "feat(web): show authoritative invite funnel"
```

## Task M05: Trust-First Public Invite Web Experience

**Files:**

- Modify: `apps/web/src/app/i/[code]/page.tsx`
- Create: `apps/web/src/app/i/[code]/page.contract.node.test.ts`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**

- Consumes: F03 tenant-centered contract and A02 normalized public brand.
- Produces: deterministic checking/valid/invalid/MFA flow without inviter identity or income promise.

- [ ] **Step 1: Add source/copy/state contracts**

Assert valid title `You're invited to join {tenantName}`, visible tenant brand/tagline, active invitation status, password requirements, income disclaimer, safe mapped error copy, MFA resume/restart, and absence of `inviterName` or raw backend message rendering.

- [ ] **Step 2: Run RED**

```powershell
node --experimental-strip-types --test 'apps/web/src/app/i/[code]/page.contract.node.test.ts'
```

Expected: F03 fixes identity, but trust-first hierarchy and safe error mapping are incomplete.

- [ ] **Step 3: Reorder content and map public errors**

Render trust context before the form: tenant brand, invitation validity, what happens next, form, disclaimer. Map 404/expired/email-lock/MFA expiry to fixed i18n keys; keep detailed server errors out of public copy.

- [ ] **Step 4: Run GREEN, auth regression, and build**

```powershell
node --experimental-strip-types --test 'apps/web/src/app/i/[code]/page.contract.node.test.ts'
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/auth.int-spec.ts
pnpm --filter @refearn/web lint
pnpm --filter @refearn/web build
```

Expected: public state/copy, API auth, typecheck, and build pass.

- [ ] **Step 5: Commit**

```powershell
git add -- 'apps/web/src/app/i/[code]/page.tsx' 'apps/web/src/app/i/[code]/page.contract.node.test.ts' apps/web/src/lib/i18n.ts
git diff --cached --check
git commit -m "feat(web): make public invites trust first"
```

## Task M06: Bounded Request and Financial Rollout Metrics

**Files:**

- Create: `apps/api/src/health/request-telemetry.ts`
- Modify: `apps/api/src/health/health.module.ts`
- Modify: `apps/api/src/health/metrics.controller.ts`
- Modify: `apps/api/test/health.int-spec.ts`

**Interfaces:**

- Consumes: route templates, response status/duration, payout/ledger/provenance aggregate truth.
- Produces: bounded no-PII metrics and structured request logs for baseline/pilot guardrails.

- [ ] **Step 1: Add token, cardinality, zero-state, and mismatch tests**

Assert metrics remain token-protected; labels contain method/route-template/status-class only; raw URL, query, tenant, user, email, body, authorization, evidence are absent; empty DB yields zero; a payout-item mismatch yields gauge `1`; oldest ages and 48h settlement counts match fixtures.

- [ ] **Step 2: Run RED**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/health.int-spec.ts
```

Expected: financial/request metrics do not exist.

- [ ] **Step 3: Add bounded interceptor and aggregate gauges**

Use fixed duration buckets and route templates. Reuse valid inbound request ID or generate UUID and echo it in the response. Add tenant-label-free gauges for ledger status/type, missing plan provenance, reconciliation mismatch, payout/batch status, processing oldest age, pending oldest age, settled-within-48h numerator/denominator, and metrics collection duration.

- [ ] **Step 4: Run GREEN and lint**

```powershell
pnpm --filter @refearn/api exec jest --selectProjects integration --runInBand test/health.int-spec.ts
pnpm --filter @refearn/api lint
```

Expected: security/cardinality/aggregate tests pass and typecheck exits `0`.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/api/src/health/request-telemetry.ts apps/api/src/health/health.module.ts apps/api/src/health/metrics.controller.ts apps/api/test/health.int-spec.ts
git diff --cached --check
git commit -m "feat(observability): expose bounded rollout guardrails"
```

## Task M07: Dependency-Free Web Browser Acceptance Suite

**Files:**

- Create: `apps/web/test/e2e/member-network-ledger.py`

**Interfaces:**

- Consumes: M02, M04, M05 routes; localStorage session; mocked API responses.
- Produces: deterministic web evidence without adding an npm package.

- [ ] **Step 1: Write route-mocked Playwright journeys**

```powershell
New-Item -ItemType Directory -Force 'apps/web/test/e2e' | Out-Null
```

Cover member wallet page 1→2→back, detail drawer privacy/focus/retry, invite funnel partial failure/create refresh, public valid/expired/MFA flows, 390x844 and 1440x900, dark/light/reduced motion, 200% zoom, keyboard path, console errors, failed requests, and horizontal overflow.

- [ ] **Step 2: Run RED**

```powershell
$env:NODE_OPTIONS=''
python C:\Users\Windows\.agents\skills\webapp-testing\scripts\with_server.py --server "pnpm --filter @refearn/web dev" --port 3000 -- python apps/web/test/e2e/member-network-ledger.py
```

Expected: missing member timeline/funnel states fail before M02-M05 are complete.

- [ ] **Step 3: Keep the suite deterministic and privacy-assertive**

Abort any unmocked API request, fail on console/page error, and assert forbidden strings such as customer reference, settlement evidence/reference, other member names, and inviter identity never render. Do not add a Python dependency to repository manifests.

- [ ] **Step 4: Run GREEN against production build**

```powershell
pnpm --filter @refearn/web build
$env:NODE_OPTIONS=''
python C:\Users\Windows\.agents\skills\webapp-testing\scripts\with_server.py --server "pnpm --filter @refearn/web start" --port 3000 -- python apps/web/test/e2e/member-network-ledger.py
```

Expected: every journey passes; console errors and page-level overflow are zero.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/test/e2e/member-network-ledger.py
git diff --cached --check
git commit -m "test(web): cover member ledger and invite journeys"
```

## Task M08: Internal and Pilot-Tenant Rollout

**Files:** Operational task; no repository file changes.

**Interfaces:**

- Consumes: C1-C3 green checkpoints, M06 metrics, named tenant/SLA approval G3, existing deployment capability controls.
- Produces: recorded baseline, internal observation, pilot decision, cohort go/no-go. It does not authorize config edits.

- [ ] **Step 1: Capture 14-day baseline before enabling new UI**

Record request-to-settlement p50/p90, processing oldest age, reconciliation mismatch, duplicate reservation/payment, auth failure, API 5xx/p95, LCP/INP/CLS, invite issued/joined/verified/activated, and plan-provenance coverage.

- [ ] **Step 2: Run internal tenant for at least 24 hours**

Execute:

```powershell
if (-not $env:PILOT_TENANT_ID) { throw 'PILOT_TENANT_ID must be the explicitly approved internal tenant UUID' }
pnpm --filter @refearn/api exec ts-node prisma/reconcile-network-ledger.ts --tenant=$env:PILOT_TENANT_ID
```

Expected: correctness counters are zero. Do not set `PILOT_TENANT_ID` by inference.

- [ ] **Step 3: Run one pilot admin for one payout cycle or seven days**

Go only when G3 names the tenant/owner and accepts 48h SLA or a replacement. Stop for any reconciliation mismatch, duplicate payment/reservation, cross-tenant exposure, API 5xx above 0.5% for 15 minutes, p95 above 1s or more than 20% over baseline, auth failures above baseline by 10%, or payout completion below baseline by 10%.

- [ ] **Step 4: Add member web for seven days, then cohort**

If guardrails remain green, enable member web for the same tenant. Cohort sequence is 5%→25%→50%→100% with 48h→72h→one-payout-cycle holds. If deployment lacks tenant capability controls, obtain production-config authorization or stop at internal/staging; do not silently implement a new platform toggle.

- [ ] **Step 5: Record the decision in the release/PR system**

Include time window, tenant count, north-star change, every guardrail, incidents, rollback rehearsal, and signer. No source commit is created for this operational evidence unless the user explicitly requests a repository report.

## Task M09: Native Secure Session Persistence

**Approval gate:** G2 dependency/package/lockfile permission.

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/mobile/src/lib/auth.ts`
- Modify: `apps/mobile/src/lib/api.ts`
- Create: `apps/mobile/test/session-storage.cjs`

**Interfaces:**

- Consumes: approved `expo-secure-store` dependency and F02 single-flight refresh.
- Produces: secure token persistence, one-time AsyncStorage migration, atomic save/clear.

- [ ] **Step 1: Write storage migration and failure tests**

Test new install, legacy AsyncStorage session, secure-store write failure, refresh success, failed refresh, logout, and idempotent second migration. Assert legacy storage is removed only after successful secure write and both stores clear on invalid session.

- [ ] **Step 2: Obtain approval and run RED**

After explicit permission only:

```powershell
pnpm --filter @refearn/mobile exec expo install expo-secure-store
node apps/mobile/test/session-storage.cjs
```

Expected: test fails because auth still persists tokens in AsyncStorage.

- [ ] **Step 3: Implement secure token storage and nonsecret metadata cache**

Store access/refresh tokens only in SecureStore. AsyncStorage may retain nonsecret UI metadata after tokens are removed. Maintain one in-memory session cache and serialize migrations/writes so a refresh cannot race a legacy migration.

- [ ] **Step 4: Run GREEN, typecheck, and export**

```powershell
node apps/mobile/test/session-storage.cjs
pnpm --filter @refearn/mobile lint
pnpm --filter @refearn/mobile export:check
```

Expected: migration/session tests pass and Android export exits `0`.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/mobile/package.json pnpm-lock.yaml apps/mobile/src/lib/auth.ts apps/mobile/src/lib/api.ts apps/mobile/test/session-storage.cjs
git diff --cached --check
git commit -m "fix(mobile): secure persisted sessions"
```

## Task M10: Native Workspace Switch Atomicity

**Files:**

- Modify: `apps/mobile/src/lib/auth.ts`
- Modify: `apps/mobile/src/lib/api.ts`
- Create: `apps/mobile/src/components/WorkspaceSwitcher.tsx`
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/test/workspace-session.cjs`

**Interfaces:**

- Consumes: M09 secure session, A01 `SwitchTenantSession` from `POST /me/switch-tenant`, `landingForSession()`.
- Produces: atomic member→member switch/remount and safe member→privileged landing.

- [ ] **Step 1: Add session transition tests**

Cover success/failure, second-tap suppression, brand refresh, active membership remount key, member→admin privileged landing, and refresh/switch race preserving the newest rotated session.

- [ ] **Step 2: Run RED**

```powershell
node apps/mobile/test/workspace-session.cjs
```

Expected: endpoint is unused and session merge helper is absent.

- [ ] **Step 3: Implement validated atomic switch**

Validate the response, merge only its returned `accessToken` and `activeMembershipId` into the newest in-memory session, preserve the current refresh token, save securely once, then replace the route. Serialize refresh and switch commits so a late response cannot overwrite the newest rotated session. Key the member tab navigator by `activeMembershipId` so wallet/invite/brand state cannot bleed between tenants. On failure keep the current session and surface a retryable error.

- [ ] **Step 4: Run GREEN and export**

```powershell
node apps/mobile/test/workspace-session.cjs
pnpm --filter @refearn/mobile lint
pnpm --filter @refearn/mobile export:check
```

Expected: transition/race tests and export pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/mobile/src/lib/auth.ts apps/mobile/src/lib/api.ts apps/mobile/src/components/WorkspaceSwitcher.tsx 'apps/mobile/app/(tabs)/_layout.tsx' apps/mobile/test/workspace-session.cjs
git diff --cached --check
git commit -m "feat(mobile): switch member workspaces safely"
```

## Task M11: Native Money Timeline Parity

**Files:**

- Modify: `apps/mobile/app/(tabs)/wallet.tsx`
- Create: `apps/mobile/src/components/MoneyTimelineSheet.tsx`
- Create: `apps/mobile/test/member-ledger.cjs`
- Modify: `apps/mobile/src/lib/i18n.ts`
- Modify: `apps/mobile/src/theme.ts`

**Interfaces:**

- Consumes: M01 list/detail and M09 secure session.
- Produces: duplicate-safe load-more timeline, private detail sheet, explicit offline/last-updated state.

- [ ] **Step 1: Add pagination/detail/offline contracts**

Test page append dedupes IDs, refresh replaces pages, detail is lazy, another-member 404 uses generic unavailable copy, forbidden PII is absent, 46px targets/accessibility labels exist, cached data is marked offline with last-updated time, and financial status roles match the web semantic meanings in light/dark themes.

- [ ] **Step 2: Run RED**

```powershell
node apps/mobile/test/member-ledger.cjs
```

Expected: current wallet ignores pagination/detail and stale-state requirements.

- [ ] **Step 3: Implement parity without optimistic money**

Keep items keyed by entry ID, append only unseen rows, and refetch page 1 after payout mutation. Detail sheet shows amount/status/type/level/rate/maturity/safe source/payout state. Map paid/payable/pending-processing/reversal-released/adjustment to success/info/warning/danger/neutral roles, use tabular-number money, 12/16px spacing, 14px panels, and 46px controls; no gradient/glass or color-only status. Never update balances locally before server refetch.

- [ ] **Step 4: Run GREEN, lint, and export**

```powershell
node apps/mobile/test/member-ledger.cjs
pnpm --filter @refearn/mobile lint
pnpm --filter @refearn/mobile export:check
```

Expected: timeline/detail/offline contracts and Android export pass.

- [ ] **Step 5: Commit**

```powershell
git add -- 'apps/mobile/app/(tabs)/wallet.tsx' apps/mobile/src/components/MoneyTimelineSheet.tsx apps/mobile/test/member-ledger.cjs apps/mobile/src/lib/i18n.ts apps/mobile/src/theme.ts
git diff --cached --check
git commit -m "feat(mobile): add Money Timeline details"
```

## Task M12: Native Invite and Brand Parity

**Files:**

- Modify: `apps/mobile/src/lib/brand.ts`
- Modify: `apps/mobile/app/(tabs)/invite.tsx`
- Modify: `apps/mobile/app/i/[code].tsx`
- Create: `apps/mobile/test/invite-funnel.cjs`
- Modify: `apps/mobile/src/lib/i18n.ts`

**Interfaces:**

- Consumes: A02 defaults, M03 summary, F03 public contract, M10 active workspace.
- Produces: authoritative native funnel, active-tenant share brand, tenant-centered public invite.

- [ ] **Step 1: Add brand/funnel/public-copy tests**

Assert fallback colors match A02, issued/joined/verified/activated stages render, viewed/started are absent, create refreshes list+summary, share uses active tenant, `inviterName` is absent, public title uses tenant, and partial failure keeps successful content.

- [ ] **Step 2: Run RED**

```powershell
node apps/mobile/test/invite-funnel.cjs
```

Expected: native defaults and invite contract diverge.

- [ ] **Step 3: Implement funnel, active brand, and public state parity**

Normalize brand with `#384BB8/#6F7ACA`, fetch `/app/invites/summary`, preserve current QR/share behavior, and use the same safe public copy/error/MFA states as web. No inviter identity or income guarantee is added.

- [ ] **Step 4: Run GREEN, lint, and export**

```powershell
node apps/mobile/test/invite-funnel.cjs
pnpm --filter @refearn/mobile lint
pnpm --filter @refearn/mobile export:check
```

Expected: brand/funnel/public-copy contracts and export pass.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/mobile/src/lib/brand.ts 'apps/mobile/app/(tabs)/invite.tsx' 'apps/mobile/app/i/[code].tsx' apps/mobile/test/invite-funnel.cjs apps/mobile/src/lib/i18n.ts
git diff --cached --check
git commit -m "feat(mobile): align invite funnel and brand"
```

## Task M13: Native Device QA and CRO Readiness Gate

**Files:** Operational task; no repository file changes by default.

**Interfaces:**

- Consumes: M08 successful web pilot, M09-M12 green checks, real Android/iOS devices, G5 analytics approval for experiments.
- Produces: native go/no-go and a separate CRO eligibility decision.

- [ ] **Step 1: Run static/export gates**

```powershell
node apps/mobile/test/session-storage.cjs
node apps/mobile/test/workspace-session.cjs
node apps/mobile/test/member-ledger.cjs
node apps/mobile/test/invite-funnel.cjs
pnpm --filter @refearn/mobile lint
pnpm --filter @refearn/mobile export:check
```

Expected: every test and export passes.

- [ ] **Step 2: Run real-device smoke on Android and iOS**

Verify login/MFA, refresh rotation, workspace switch, offline/reconnect, Money Timeline/detail, payout request/refetch, invite create/share/public link, screen reader labels, 46px targets, light/dark/reduced motion, and logout storage clearing. Emulator tooling was not available during planning, so static/export evidence alone cannot satisfy this step.

- [ ] **Step 3: Run a native pilot after web remains green**

Use the same reconciliation/auth/5xx/p95 guardrails. Stop immediately for stale-current money, token persistence outside secure storage, tenant state bleed, IDOR, or duplicate payout behavior.

- [ ] **Step 4: Evaluate CRO readiness separately**

Without G5, stop after authoritative funnel reporting. With G5, approve a separate `ProductEvent` spec containing consent, schema version, allowlisted properties, pseudonymous session, dedupe UUID, 90-day raw/13-month aggregate retention, deletion path, and kill switch. Audit logs never store product analytics.

- [ ] **Step 5: Choose the first experiment only after the gate**

Order: admin proof side panel → member proof-chain drawer → trust-first invite intro. Financial state/calculation never varies. Assign at tenant level, pre-register primary metric/guardrails, run at least 14 days and two business/payout cycles, and avoid a statistical-win claim when power/MDE is insufficient.

## Packet 3 Completion Gate

- [ ] Member list pagination is deterministic and detail is own-entry only.
- [ ] Web Money Timeline explains every safe status without prohibited PII.
- [ ] Invite funnel uses authoritative monotonic business events only.
- [ ] Public invite is tenant-centered, safe, and MFA-complete.
- [ ] Request/financial metrics are bounded and contain no PII/tenant label.
- [ ] Web member browser suite has zero console errors and page overflow.
- [ ] Internal and pilot reconciliation counters remain zero.
- [ ] Native package/storage changes occurred only after G2.
- [ ] Android and iOS device smoke passes before production native rollout.
- [ ] CRO remains disabled until G5 and stable financial guardrails.
