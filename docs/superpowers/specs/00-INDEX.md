# Americana Earn — Product Tracks (specs index)

Design specs for the product-improvement program that came out of the **2026-07-09
ground-truth audit**. Each track gets its own spec here (this folder), then its own
implementation plan, then implementation. Working method: spec → plan → build, one
folder, reviewable per track.

## The audit in one line

Features mostly **exist** and the **backend is production-grade (4/5)**; the pain is
**UI execution** + one genuinely-thin surface (Platform). So the program is a
front-end/UX + platform + hardening effort on top of the existing engine — **not a rewrite**.

## Tracks

| # | Track | Spec | Status | Core of it |
|---|-------|------|--------|------------|
| 1 | **Feature-gap sprint** | [feature-gap-sprint](2026-07-09-feature-gap-sprint-design.md) | Spec ✅ · plan ✅ | 7 items: duplicate detection, mandatory reject reason, unsaved-changes guard, plan-simulator wiring, share presets, fraud triage screen, activity feed (hybrid). |
| 2 | **Design-system & primitives** | [design-system-primitives](2026-07-09-design-system-primitives-design.md) | Spec ✅ · plan ✅ | Highest-ROI perceived-quality. Systematize the hand-rolled tokens into a typed primitives kit; kill 1,428 inline styles; `statusBadge`; vertical-slice rollout. |
| 3 | **Platform Command Center** | [platform-command-center](2026-07-09-platform-command-center-design.md) | Spec ✅ · plan ✅ | The one genuinely-empty surface. Overview + needs-attention queue, onboarding wizard + `setup_needed`, company tabs, safe impersonation, global search, audit/health, tenant-owner invite, plan/package matrix + MRR. |
| 4 | **Tenant-isolation & security hardening** | [tenant-isolation-hardening](2026-07-09-tenant-isolation-hardening-design.md) | Spec ✅ · plan ✅ | Top structural risk. Structural tenant-isolation backstop + `@CurrentActor`, httpOnly cookies, first Playwright smoke tests, throttler→Redis, BigInt/JSON discipline. |

## Implementation plans

Execute-ready, task-by-task (writing-plans format) in [`../plans/`](../plans/):

- [feature-gap-sprint](../plans/2026-07-09-feature-gap-sprint.md) — ~21 TDD tasks (note: the `externalRef` unique index already shipped in migration `20260619183000`)
- [design-system-primitives](../plans/2026-07-09-design-system-primitives.md) — ~14 tasks, Payouts vertical slice first
- [platform-command-center](../plans/2026-07-09-platform-command-center.md) — 18 tasks, MVP-first, backend-then-UI
- [tenant-isolation-hardening](../plans/2026-07-09-tenant-isolation-hardening.md) — ~11 tasks, isolation backstop + first Playwright harness

## ⚠️ Two decisions to confirm before/at build time

- **Track 2 (design-system):** systematize the existing hand-rolled CSS tokens into an
  in-repo primitives kit **(recommended)** vs migrate to shadcn/Tailwind. Also resolves the
  `reconcile/advanced-base` vs `redesign/shadcn-indigo` branch divergence (recommended: build
  on `reconcile/advanced-base`).
- **Track 4 (isolation):** Prisma client extension (auto-inject `tenantId`) vs Postgres RLS
  (`SET LOCAL app.tenant_id`) as the structural backstop — see the spec's item 1 recommendation.

## Suggested cross-track order

1. **Feature-gap sprint** — fast, visible wins + two money-safety fixes (in flight).
2. **Design-system vertical slice** — makes every existing feature *feel* like a product;
   also the substrate the Platform build should sit on.
3. **Tenant-isolation backstop** (item 1) — pull the #1 structural risk forward; it is
   independent of the UI work and can run in parallel.
4. **Platform Command Center** — build on the primitives kit once it exists.
5. Remaining hardening + adjacent security items.
