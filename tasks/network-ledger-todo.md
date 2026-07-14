# Network Ledger Execution Checklist

Source plan: `docs/superpowers/plans/2026-07-14-network-ledger-implementation.md`

Detailed packets:

- `docs/superpowers/plans/2026-07-14-network-ledger-01-correctness-foundation.md`
- `docs/superpowers/plans/2026-07-14-network-ledger-02-admin-operations.md`
- `docs/superpowers/plans/2026-07-14-network-ledger-03-member-growth-rollout.md`

The existing untracked `tasks/plan.md` and `tasks/todo.md` are user-owned; do not edit, stage, or commit them.

## Status Legend

- `[ ]` not started
- `[x]` verified complete
- Approval-gated tasks remain unchecked until their named gate is explicit.
- A code-changing task is complete only after its RED test, GREEN test, scoped review, exact-file staging check, and commit all succeed. Operational tasks M08/M13 require their recorded evidence instead of a source commit.

## Approval Gates

- [ ] **G1 — TOTP key:** Approve the base64 32-byte `MFA_SECRET_ENCRYPTION_KEY`, secret-manager owner, rotation/re-encryption procedure, and restored-DB rehearsal.
- [ ] **G2 — Native secure storage:** Approve `expo-secure-store` plus `apps/mobile/package.json` and `pnpm-lock.yaml` changes.
- [ ] **G3 — Pilot:** Name internal/pilot tenant, payout owner, rollout window, and 48h SLA or approved replacement.
- [ ] **G4 — Evidence/PII:** Define who can view settlement evidence and which customer/recipient fields are allowed.
- [ ] **G5 — Interaction analytics:** Approve ProductEvent schema, consent, retention, deletion, and privacy policy before experiments.
- [ ] **G6 — Advisory remediation:** Approve dependency/package changes only after reachability report.
- [ ] **G7 — Web shared workspace package:** Approve adding existing `@refearn/shared: workspace:*` to web manifest and lockfile.

## Checkpoint C0 — Isolated Baseline

- [ ] Create an isolated `codex/` worktree using `superpowers:using-git-worktrees`.
- [ ] Confirm user-owned dirty files are absent from the implementation worktree.
- [ ] Run `pnpm lint`; record package results.
- [ ] Run `pnpm exec turbo run test --force`; record package results.
- [ ] Run `pnpm exec turbo run build --force`; record package results.
- [ ] Run `pnpm --filter @refearn/mobile export:check`.
- [ ] Record the known web Node-test ESM baseline before changing its harness.

## Packet 1 — Correctness and Foundation

### Authentication and privacy

- [ ] **F01 — Web refresh single-flight** · S · depends C0
  - Acceptance: two concurrent 401s create one cookie refresh; both retry once with the rotated access token; failed refresh clears once.
  - Verify: web auth Node tests + `pnpm --filter @refearn/web lint`.

- [ ] **F02 — Mobile refresh single-flight** · S · depends C0
  - Acceptance: two concurrent 401s create one body refresh; both use the same rotated session; persistence/clear occurs once.
  - Verify: mobile refresh Node test + mobile lint/export.

- [ ] **F03 — Public invite privacy contract** · M · depends C0
  - Acceptance: API remains inviter-private; web/native use tenant-centered title; no `inviterName` dependency remains.
  - Verify: invite contract test, auth integration, web/mobile lint.

### Financial truth and provenance

- [ ] **F04 — Canonical net commission** · S · depends C0
  - Acceptance: pending+payable+processing+paid active amounts include negative reversals and signed adjustments; reversed status is excluded; dashboard/analytics agree.
  - Verify: payout integration + API lint.

- [ ] **F05 — Plan effective-date uniqueness** · M · depends C0
  - Acceptance: `(tenantId,effectiveFrom)` is unique; parallel creates yield `[201,409]`; duplicate preflight fails closed.
  - Verify: Prisma validate/generate + settings integration.

- [ ] **F06 — Approval-time plan provenance** · M · depends F05
  - Acceptance: new approval freezes exact plan ID; later plans/replay cannot change it; legacy ledger rows remain nullable.
  - Verify: Prisma validate/generate + engine integration.

- [ ] **F07 — Provenance backfill** · M · depends F06
  - Acceptance: only a single tenant/date/rate match is written; ambiguous/missing remain null; second run updates zero rows.
  - Verify: database-safety integration + disposable dry run.

### Security and transaction integrity

- [ ] **F08 — TOTP AES-GCM envelope** · M · depends G1
  - Acceptance: new writes are encrypted, legacy is dual-read/rekeyed, corrupt/unknown key fails closed, no secret is logged.
  - Verify: auth integration + API lint + restored-DB rehearsal.

- [ ] **F09 — Mutation/audit atomicity** · M · depends C0
  - Acceptance: RBAC/settings mutation and audit commit or rollback together; permission boundaries are unchanged.
  - Verify: RBAC/settings integration with forced audit failure + API lint.

- [ ] **F10 — Immutable paid export** · S · depends C0
  - Acceptance: profile changes do not alter paid CSV; unsafe legacy paid record returns 409; no live fallback.
  - Verify: payout integration + API lint.

### Bounded processing

- [ ] **F11 — Bounded maturation transaction** · S · depends C0
  - Acceptance: maximum 500 rows/transaction, deterministic order, 501 rows complete as 500+1, concurrent workers do not overlap.
  - Verify: engine integration + API lint.

- [ ] **F12 — Bounded scheduler drain** · S · depends F11
  - Acceptance: fixed clock, early stop, maximum 20 batches/10,000 rows per tick, existing overlap guard remains.
  - Verify: scheduler integration + API lint.

- [ ] **F13 — Reconciliation and migration rehearsal** · M · depends F04, F06, F07, F10-F12
  - Acceptance: named mismatch counters detect summary/payout/duplicate/cross-tenant defects; clean fresh/upgraded DB returns zero.
  - Verify: database-safety integration, fresh migration, restored upgrade, reconciliation CLI.

- [ ] **F14 — Ledger timeline composite index** · S · depends F13
  - Acceptance: named index exactly matches tenant/member/created-desc/id-desc and the migration is expand-only.
  - Verify: Prisma validate/generate, fresh/restored migration, exact `pg_indexes` catalog assertion.

- [ ] **F15 — Sensitive audit minimization** · M · depends F10, F14
  - Acceptance: new payout audit rows never duplicate evidence/reference/reasons; legacy API output omits raw PII/secrets/IP and marks redaction; canonical payout proof remains intact.
  - Verify: payout/admin integration + API lint; no legacy audit rows are deleted or rewritten.

## Checkpoint C1 — Foundation Green

- [ ] Shared unit tests pass.
- [ ] Targeted auth/engine/payout/RBAC/settings/scheduler/sales-wallet integration suites pass.
- [ ] API, web, and mobile typechecks pass.
- [ ] Fresh and restored-schema migration rehearsals pass.
- [ ] Reconciliation correctness counters are zero.
- [ ] Ledger timeline index definition matches tenant/member/created/id order exactly.
- [ ] Audit API contains no settlement evidence/reference/reason, token, raw email, or IP.
- [ ] TOTP plaintext count is zero only after G1 and controlled backfill.
- [ ] Review packet 1 using `code-review-and-quality` and `verification-before-completion`.

## Packet 2 — Admin Operations

### Shared UI foundation

- [ ] **A01 — Versioned Network Ledger contracts** · M · depends F04, F06, G7
  - Acceptance: literal v1 schemas, decimal string money, exact/legacy provenance, bounded pagination, web resolves workspace package.
  - Verify: shared contract suite + shared/web lint.

- [ ] **A02 — Canonical brand defaults** · S · depends A01
  - Acceptance: API/web share `#384BB8/#6F7ACA` and tagline; invalid inputs normalize; product and tenant brand remain distinct.
  - Verify: shared branding suite + API/web lint.

- [ ] **A03 — Semantic tokens and ledger primitives** · M · depends A01
  - Acceptance: status/money/async/queue primitives exist; text/icon accompanies color; coarse-pointer controls reach 44px.
  - Verify: ledger UI contract + web lint.

- [ ] **A04 — Busy-safe overlays** · M · depends A03
  - Acceptance: busy financial dialog ignores Escape/backdrop/close; normal focus trap/restore works; nested scroll lock is safe.
  - Verify: overlay contract + web lint.

- [ ] **A05 — Workspace-aware admin shell** · M · depends A02, A04
  - Acceptance: atomic tenant switch; failed switch preserves state; mobile nav Home/Sales/Payouts/More; permission visibility remains.
  - Verify: shell contract + web lint; responsive assertions at A15.

### Operational vertical slices

- [ ] **A06 — Command Center operations API** · M · depends A01, F04
  - Acceptance: bounded cash-flow/queue summary, priority order, empty state, tenant isolation, permission enforcement.
  - Verify: admin integration + API lint.

- [ ] **A07 — Command Center web** · M · depends A03-A06
  - Acceptance: needs-attention first, cash rail second, sales operations third, analytics below fold; partial errors isolated; no Number cents.
  - Verify: page contract + web lint/build.

- [ ] **A08 — Sale Lineage API** · M · depends A01, F06
  - Acceptance: additive exact/legacy plan projection, captured lines/maturity/payout links, bigint gross/reversal/net, uniform tenant 404.
  - Verify: sales-wallet integration + API lint.

- [ ] **A09 — Sale Lineage drawer** · M · depends A03, A04, A08
  - Acceptance: sale→plan→beneficiaries→maturation→payout proof; legacy never guesses; busy action cannot close.
  - Verify: sales page contract + web lint/build.

- [ ] **A10 — Payout summary/page/proof APIs** · M · depends A01, F10, G4
  - Acceptance: bounded pagination, immutable snapshot detail, evidence permission/redaction, existing mutations unchanged.
  - Verify: payout integration + API lint.

- [ ] **A11 — Lazy Payout Workspace** · M · depends A03, A04, A10
  - Acceptance: URL tab/page, initial summary+one active request, no all-page loop, stale response guard, server pagination.
  - Verify: payout page contract + web lint/build.

- [ ] **A12 — Payout proof and pessimistic mutations** · M · depends A10, A11
  - Acceptance: lazy proof drawer, plain-text evidence, busy nondismissible state, ambiguous mutation refetches before retry.
  - Verify: payout page contract + web lint/build.

- [ ] **A13 — Server-filtered audit explorer** · M · depends A01, A04
  - Acceptance: tenant-AND-filter query, filtered total/facets, URL source of truth, invalid ranges 400, no page-local search illusion.
  - Verify: admin integration + audit contract + API/web lint.

- [ ] **A14 — Brand editor preview** · S · depends A02-A04
  - Acceptance: shared normalization, invalid color blocked, failed save retains form, product/tenant brand distinction explained.
  - Verify: brand contract + web lint.

- [ ] **A15 — Admin browser quality checkpoint** · M · depends A07-A14
  - Acceptance: 390/768/1440, keyboard/focus/zoom, dark/light/reduced motion, request budget, LCP/CLS, zero console errors/overflow.
  - Verify: API integration, shared tests, web lint/build, Python Playwright.

## Checkpoint C2 — Admin Web Green

- [ ] All admin contracts and integration tests pass.
- [ ] Web production build passes.
- [ ] Command Center, sale lineage, payouts, audit, workspace, and brand flows pass browser QA.
- [ ] No financial amount uses JavaScript Number arithmetic.
- [ ] No legacy sale presents guessed plan metadata.
- [ ] Initial payout screen fetches only summary plus active page.
- [ ] Review packet 2 using `frontend-design`, `shadcn-ui`, `make-interfaces-feel-better`, `web-design-guidelines`, `tailwind-design-system`, `vercel-composition-patterns`, `code-review-and-quality`, and `verification-before-completion`.

## Packet 3 — Member, Growth, Native, and Rollout

### Member web and invite growth

- [ ] **M01 — Private ledger detail and performance API** · M · depends A01, A10, F04, F14
  - Acceptance: deterministic list, own-entry detail only, allowlisted fields, uniform 404, no prohibited PII; 100k-row p95 below 1s; named index plan; 25 reads remain safe during one payout settlement.
  - Verify: sales-wallet integration + opt-in Network Ledger performance/concurrency suite + API lint.

- [ ] **M02 — Web Money Timeline** · M · depends A03, A04, M01
  - Acceptance: URL pagination, stale-request protection, lazy proof drawer, status/maturity/payout explanation, privacy-safe.
  - Verify: wallet contract + web lint/build.

- [ ] **M03 — Authoritative invite summary API** · M · depends A01, F03
  - Acceptance: issued/active/expired/joined/verified/activated counts, monotonic funnel, own invites only, no identities.
  - Verify: auth integration + API lint.

- [ ] **M04 — Member invite workspace** · M · depends A03, A04, M03
  - Acceptance: authoritative funnel, no viewed/started, create refreshes list+summary, partial errors isolated.
  - Verify: invite page contract + web lint/build.

- [ ] **M05 — Trust-first public invite** · M · depends A02-A04, F03
  - Acceptance: tenant trust context before form, safe errors, valid/expired/MFA states, no inviter identity or income promise.
  - Verify: public invite contract, auth integration, web lint/build.

- [ ] **M06 — Bounded rollout metrics** · M · depends F07, F10-F12
  - Acceptance: token-protected bounded request metrics, no PII/tenant labels, payout SLA/provenance/reconciliation gauges.
  - Verify: health integration + API lint.

- [ ] **M07 — Web member browser suite** · M · depends M02, M04, M05, A15
  - Acceptance: member/invite journeys pass at mobile/desktop, privacy assertions, keyboard/zoom/theme/motion, zero console errors/overflow.
  - Verify: web build + Python Playwright.

- [ ] **M08 — Internal and pilot rollout** · M · depends M06, M07, G3
  - Acceptance: 14-day baseline, 24h internal, one payout-cycle/seven-day pilot, zero reconciliation/duplicate/tenant exposure, signed go/no-go.
  - Verify: reconciliation CLI, metrics report, rollback rehearsal; no repository commit by default.

### Native parity after secure storage

- [ ] **M09 — Secure native session** · M · depends M08, G2
  - Acceptance: tokens in SecureStore, successful one-time AsyncStorage migration, atomic refresh/logout clear, no secret fallback.
  - Verify: session test + mobile lint/export.

- [ ] **M10 — Native workspace atomicity** · M · depends F02, M09
  - Acceptance: member switch remounts tenant state/brand, failure preserves session, privileged role lands safely, race uses newest rotated session.
  - Verify: workspace test + mobile lint/export.

- [ ] **M11 — Native Money Timeline** · M · depends M01, M10
  - Acceptance: duplicate-safe load-more, private detail sheet, 46px/a11y, explicit offline/last-updated, no optimistic money.
  - Verify: member-ledger test + mobile lint/export.

- [ ] **M12 — Native invite and brand parity** · M · depends M03-M05, M10
  - Acceptance: canonical fallback, authoritative funnel, active-tenant share, tenant-centered public/MFA flow, no inviter identity.
  - Verify: invite-funnel test + mobile lint/export.

- [ ] **M13 — Native device QA and CRO readiness** · M · depends M11, M12; G5 only for experiments
  - Acceptance: Android+iOS real-device critical flows pass; native pilot green; CRO remains off without G5 and sufficient traffic/power.
  - Verify: all mobile tests/lint/export + real-device evidence + financial guardrails.

## Checkpoint C3 — Web Pilot Green

- [ ] Member detail IDOR/privacy tests pass.
- [ ] Money Timeline and invite browser journeys pass.
- [ ] Internal and pilot reconciliation/duplicate/cross-tenant counters remain zero.
- [ ] API 5xx <=0.5%; auth failures do not increase >10%; p95 stays <=1s and does not degrade >20%; payout completion does not fall >10% below baseline.
- [ ] LCP <=2.5s, INP <=200ms, CLS <=0.1 at p75 where real-user data is available.
- [ ] Rollback capability was rehearsed without deleting financial data.
- [ ] Review member/invite truth and trust copy with `product-marketing` and `customer-research`; do not activate `marketing-ideas`/`cro` experiments without G5.

## Checkpoint C4 — Native and CRO

- [ ] G2 occurred before manifest/lockfile edits.
- [ ] Tokens are absent from AsyncStorage after migration.
- [ ] Android and iOS real-device critical paths pass.
- [ ] Native pilot preserves web financial/auth guardrails.
- [ ] G5 is explicit before any ProductEvent schema or experiment telemetry.
- [ ] Experiment assignment is tenant-level; financial state/calculation is invariant.

## Final Program Verification

- [ ] Run `pnpm lint`.
- [ ] Run `pnpm exec turbo run test --force`.
- [ ] Run `pnpm test:int` on a disposable database.
- [ ] Run `pnpm exec turbo run build --force`.
- [ ] Run `pnpm --filter @refearn/mobile export:check`.
- [ ] Run both admin and member Python Playwright suites against the production web build.
- [ ] Apply `webapp-testing` and `playwright-cli` journey/runtime review without installing a repository browser-test package.
- [ ] Run fresh and restored-schema upgrade rehearsals.
- [ ] Run Network Ledger reconciliation for test, internal, and pilot tenants; all correctness counters are zero.
- [ ] Run `code-review-and-quality` across the final diff.
- [ ] Run `verification-before-completion`; do not claim completion from stale or partial evidence.
- [ ] List exact changed files, commands/results, approved gates, unresolved gated items, and intentionally unchanged areas.
