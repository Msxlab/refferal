# Tenant-Isolation & Security Hardening — Design Spec

- **Date:** 2026-07-09
- **Branch:** `claude/serene-rosalind-6a05c6` (base: `reconcile/advanced-base`)
- **Author:** Mustafa + Claude
- **Status:** Draft — awaiting review

## Context

The 2026-07-09 ground-truth audit confirmed the backend is production-grade (BigInt cents, DB-trigger-immutable ledger, argon2id, refresh-token family reuse-detection, 43 integration specs) but that **multi-tenant isolation is entirely manual**: `apps/api/src/prisma/prisma.service.ts` is a bare `PrismaClient` with **no** middleware/extension and **no** Postgres RLS, so every one of the ~576 `tenantId` references across `*.service.ts` and the 116 `user.tid as string` / `user.mid as string` casts across controllers is a hand-written choke point. A single forgotten `where: { tenantId }` is a cross-tenant data/money leak. This track adds the missing **structural** backstop (defense-in-depth under the existing DB triggers), then hardens the session layer (tokens are in `localStorage` today), lands the first web tests, and moves rate-limiting to a shared store. It is mostly backend + platform correctness.

> Path links below are relative to this file (`docs/superpowers/specs/`); repo root is three levels up.

## Global constraints & conventions (apply to every item)

1. **Multi-tenant isolation is manual and is the #1 structural risk.** Every new query on a tenant-scoped model MUST include `where: { tenantId }` (or go through membership scoping). The backstop in item 1 is *defense-in-depth*, **not** a license to drop explicit `where: { tenantId }` — hand-written scoping stays the primary contract; the backstop catches the miss.
2. **Money is BigInt cents server-side**; cents cross the API boundary as **strings** (via each service's `serialize()`/`.toString()`, e.g. [wallet.service.ts:61-65](../../../apps/api/src/wallet/wallet.service.ts)) and are `Number()`-parsed only at the display edge ([format.ts:3-4](../../../apps/web/src/lib/format.ts)). Never `Number()` a BigInt server-side.
3. **Audit** every money- or permission-affecting mutation inside the same transaction (follow existing `audit()` helpers per module; the `AuditLog` model is itself tenant-scoped).
4. **UI text is English.**
5. **Do NOT weaken existing backstops.** The DB triggers in [migrations/20260610214900_guards](../../../apps/api/prisma/migrations/20260610214900_guards/migration.sql) (ledger rows un-updatable/un-deletable → reversal-only, `forbid_reparenting` on `memberships.path`, deferrable `sum(level_rates) <= pool_rate`) and FK `onDelete: Restrict`/`Cascade` semantics MUST remain intact. Any RLS/extension work is additive.
6. **No design-system migration here.** Reuse existing `ui.tsx` primitives + `globals.css`. Session/CSRF UI changes are plumbing, not redesign.

## 1. Structural tenant-isolation backstop ⚠️ + `@CurrentActor` choke point 🔴

**Problem.** `apps/api/src/prisma/prisma.service.ts` extends `PrismaClient` with only `$connect`/`$disconnect` — no `$extends`, no middleware, no RLS. Isolation depends 100% on humans writing `where: { tenantId }` in all ~576 service query sites, and on 116 `user.tid as string` casts (e.g. [payouts.controller.ts:31-32](../../../apps/api/src/payouts/payouts.controller.ts), [sales.controller.ts:49-50](../../../apps/api/src/sales/sales.controller.ts)) that silently coerce a **nullable** `tid: string | null` ([auth.types.ts:11](../../../apps/api/src/auth/auth.types.ts)) to non-null. A controller that forgets `@RequireMembership()` can reach a service with `tenantId = "null"`/`undefined` and, absent a where-clause bug elsewhere, leak or mutate across tenants. 25 models are tenant-scoped: `Announcement, ApiKey, AuditLog, Campaign, CommissionPlan, FraudFlag, Invite, InviteEvent, Invoice, LedgerEntry, Membership, MonthlySummary, Notification, Payout, PayoutBatch, PayoutProfile, PeriodLock, RankTier, ReportSubscription, Sale, SavedView, SurveyResponse, TeamStat, TenantBilling, TenantRole` (`Tenant` itself is the root; `User` is global).

**Decision — ⚠️ DECISION TO CONFIRM.** Ship **both layers, in this order**, but the load-bearing structural backstop is **(b) Postgres RLS**, not (a) a Prisma extension.

- **RECOMMENDED (b): Postgres Row-Level Security**, enforced in the DB, threaded via `SET LOCAL app.tenant_id = <uuid>` inside a per-request transaction. Rationale: it is the *same trust boundary* as the existing DB triggers (a bug in TypeScript cannot bypass it), it covers **raw SQL** (`$queryRaw`, the CSV/report paths, the platform drill-in aggregates) that a Prisma `$extends` query hook does **not** intercept, and it fails **closed** (no policy → no rows). A Prisma client extension is TypeScript-side, bypassable by any `$queryRaw`, and adds a second source of truth.
- **Layer (a) as a lint/dev-time assist, not the guarantee:** a Prisma `$extends` `query` hook that, for the 25 tenant-scoped models, **throws in non-production** if a query runs without a `tenantId` filter *and* without an explicit `allowCrossTenant` escape — this surfaces missing-where bugs during tests/CI loudly, while RLS is the runtime guarantee. It does **not** auto-inject `tenantId` (silent injection hides the real bug and can't express composite/`OR` filters safely).

**Why not (a) alone:** the platform surface ([platform.service.ts:17,21-24](../../../apps/api/src/platform/platform.service.ts)) legitimately does cross-tenant `groupBy`/`findMany`, and reports/exports use aggregates; a query-hook that hard-injects `tenantId` would either break these or need so many escape hatches it stops being a guarantee. RLS models "who may bypass" as a first-class DB role/GUC instead.

**Changes.**

- **`@CurrentActor` param-decorator (the choke point that replaces the 116 casts).**
  - Add `CurrentActor` next to the existing `CurrentUser` in [auth.guard.ts:43](../../../apps/api/src/auth/auth.guard.ts). It reads `req.user` and returns a **validated** `ActorContext { userId: string; tenantId: string; membershipId: string; role: Role; perms: string[]; isPlatform: boolean }` — throwing `ForbiddenException('aktif uyelik gerekli')` if `tid`/`mid` is null (so the `as string` lie becomes a real assertion, once, in one place).
  - Migrate the per-controller `private actor(user)` helpers (e.g. [payouts.controller.ts:31-33](../../../apps/api/src/payouts/payouts.controller.ts), [sales.controller.ts:49-51](../../../apps/api/src/sales/sales.controller.ts)) and the `user.tid as string` read-path args to `@CurrentActor() actor: ActorContext`. This is the existing `ActorContext` shape services already accept, so service signatures barely change.
  - Platform controllers ([platform.controller.ts](../../../apps/api/src/platform/platform.controller.ts), `@PlatformAdmin()`, no `@RequireMembership()`) keep `@CurrentUser()` — they are intentionally tenant-less; `@CurrentActor` is for tenant-scoped controllers only.

- **RLS rollout (additive migration).**
  - New migration `apps/api/prisma/migrations/<ts>_rls_tenant_isolation/migration.sql`:
    - `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` + `FORCE ROW LEVEL SECURITY;` for the 25 tenant-scoped tables.
    - Policy per table: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)` for `SELECT/UPDATE/DELETE`, and `WITH CHECK` the same for `INSERT/UPDATE` (blocks writing a row into another tenant).
    - A `bypass_rls` predicate keyed on a second GUC: `current_setting('app.bypass_rls', true) = 'on'` OR run platform work under a DB role that has `BYPASSRLS`. Platform + migrations use this path.
  - **Threading the context:** wrap tenant-scoped request handling in a transaction that first runs `SET LOCAL app.tenant_id = $1` (and `SET LOCAL app.bypass_rls = 'on'` for platform). Implement as a `PrismaService.forActor(actor)` helper that returns a `$transaction` callback executing `SET LOCAL` before the work, so `SET LOCAL` is scoped to that transaction and can't leak across pooled connections. **⚠️ pgbouncer note:** `SET LOCAL` only survives in `session`/`transaction` pooling with the statement inside the same tx — confirm the prod pooler mode before enabling (PgBouncer `transaction` mode is compatible with `SET LOCAL` inside an explicit tx).
  - **Platform-admin bypass:** `platform.service.ts` cross-tenant reads run under `bypass_rls`; because these are `@PlatformAdmin()`-gated (guard checks `payload.plat`, [auth.guard.ts:146](../../../apps/api/src/auth/auth.guard.ts)), the bypass is authorization-gated, not ambient.

- **Keeping DB triggers compatible.** RLS policies and the guard triggers are orthogonal (policies filter row *visibility*; triggers enforce *immutability*/invariants). Verify order-of-evaluation only for the `DEFERRABLE` plan-level-rate check ([guards migration:22-52](../../../apps/api/prisma/migrations/20260610214900_guards/migration.sql)) — deferred constraint triggers still run at COMMIT within the same tx that set `app.tenant_id`, so no interaction. No trigger reads `tenant_id` via RLS, so none regress.

- **Prisma dev-guard extension (layer a).** Add a `$extends` in `prisma.service.ts` guarded by `process.env.NODE_ENV !== 'production'` that inspects `args.where` for the 25 models and throws `MissingTenantScopeError` when neither a `tenantId` key nor an explicit `{ allowCrossTenant: true }` context flag is present. CI (item 3) + the 43 existing specs then fail loudly on any un-scoped query. Zero prod overhead.

**Edge cases.**
- Nullable `tid`/`mid` on a mis-decorated controller → `@CurrentActor` throws before any query (fail-closed).
- Cross-tenant reads that are *legitimate* (platform, and any future admin report) must go through the `bypass_rls` path explicitly — there is no silent bypass.
- Connection pooling: `SET LOCAL` must be inside the same tx as the queries; a bare `SET` (no `LOCAL`) on a pooled connection would leak tenant context to the next request — forbid it in review.
- Raw SQL paths (CSV export [payouts.service.ts:633](../../../apps/api/src/payouts/payouts.service.ts), reports [reports.service.ts:507](../../../apps/api/src/reports/reports.service.ts)) are now covered by RLS (the whole point of choosing (b)).
- Migration is enable-only (no data change) but **high-blast-radius**: stage behind a boolean and roll out per-table.

**Tests (integration).**
- (a) Given tenant A's session, a service query for tenant B's `Sale`/`Payout`/`LedgerEntry` returns **zero rows** even if a where-clause bug omits `tenantId` (RLS proves it, not the app).
- (b) An `INSERT` with `tenant_id` = B under session A is rejected by `WITH CHECK`.
- (c) `@CurrentActor` throws 403 when `tid`/`mid` is null.
- (d) Platform drill-in under `bypass_rls` still reads all tenants; the same query without the platform guard returns only the actor's tenant.
- (e) Dev-guard extension throws on a deliberately un-scoped `findMany` in the test env.
- (f) Full existing 43-spec suite is green (no regression from RLS/`SET LOCAL`).

---

## 2. httpOnly cookie session migration 🔴

**Problem.** Web tokens live in `localStorage` under key `refearn.session` ([auth.ts:23-31](../../../apps/web/src/lib/auth.ts)) and are attached as `Authorization: Bearer` in the API client ([api.ts:19](../../../apps/web/src/lib/api.ts)). Any XSS exfiltrates both access **and** refresh tokens (refresh rotation and family reuse-detection in `auth.service.ts` don't help if the attacker steals the token directly). The code itself flags httpOnly cookies as the intended prod move ([auth.ts:1-2](../../../apps/web/src/lib/auth.ts) comment).

**Decision.** Move the **refresh token** to an httpOnly, `Secure`, `SameSite=Strict` (or `Lax` if cross-subdomain needed) cookie; keep the short-TTL access token in memory (JS variable, not `localStorage`). Add CSRF protection because cookies are now ambient on requests.

**Changes.**
- **Backend.**
  - Auth endpoints (`login`, `refresh`, `switch-tenant`, `logout`) set/clear the refresh cookie server-side instead of returning it in the JSON body. Access token stays in the response body (memory-only on the client). CORS already runs `credentials: true` ([main.ts:21](../../../apps/api/src/main.ts)) — cookie flow works.
  - **CSRF:** double-submit token. On login, set a non-httpOnly `csrf` cookie; require a matching `X-CSRF-Token` header on all non-GET requests; validate in a small guard/interceptor. The existing `AccessTokenGuard` re-validates live membership on non-GET already ([auth.guard.ts:115-128](../../../apps/api/src/auth/auth.guard.ts)) — CSRF check sits alongside it. `SameSite=Strict` on the refresh cookie is the primary defense; the double-submit token is belt-and-suspenders for the `refresh` call.
  - Refresh-token rotation/family reuse-detection in `auth.service.ts` is unchanged — only the transport (cookie vs JSON) changes.
- **Frontend.**
  - `apps/web/src/lib/auth.ts`: hold the access token in a module variable; drop `localStorage` for tokens (keep only non-sensitive session metadata like `activeMembershipId`/`memberships` if needed, or refetch on load). `getSession`/`setSession`/`clearSession`/`applyTenantSwitch` refactor accordingly.
  - `apps/web/src/lib/api.ts`: `rawFetch` sends `credentials: 'include'` + `X-CSRF-Token`; the 401→refresh retry ([api.ts:131-135,148-152](../../../apps/web/src/lib/api.ts)) calls the cookie-based refresh endpoint.
  - Impersonation (`refearn.session.impersonator`, [auth.ts](../../../apps/web/src/lib/auth.ts)) and impersonation is server-enforced read-only already ([auth.guard.ts:106-109](../../../apps/api/src/auth/auth.guard.ts)); adjust its client storage to not persist tokens.

**Edge cases.** Page reload loses the in-memory access token → silent refresh via cookie on app boot. Multi-tab: each tab refreshes independently (cookie is shared; rotation must tolerate a brief race — the family reuse-detector must not nuke the family on a legitimate concurrent refresh; confirm current grace behavior). Logout must clear the cookie server-side (not just client memory). Subdomain scope: `earn.oppeinnj.com` is single-host today, so `SameSite=Strict` is fine; revisit if the member app moves to a different subdomain.

**Tests.** Playwright (item 3): login sets an httpOnly cookie not readable via `document.cookie`; a non-GET without `X-CSRF-Token` is 403; reload keeps the user logged in via silent refresh; logout clears the cookie. Backend: refresh-cookie rotation still triggers reuse-detection on replay.

---

## 3. First web tests: Playwright smoke suite + CI 🟠

**Problem.** `apps/web` has **zero** tests (no `test`/`playwright`/`vitest` script in [apps/web/package.json](../../../apps/web/package.json)) vs the API's 43 integration specs, and there is **no CI** (`.github/workflows` is absent). The two highest-risk flows — money approval and tenant switching — have no automated coverage, right as items 1–2 change auth plumbing.

**Decision.** Add Playwright with a minimal smoke suite covering the four money/isolation-critical flows, seeded against a local API + Postgres.

**Changes.**
- Add `@playwright/test`, a `playwright.config.ts`, and `apps/web/tests/` with specs:
  1. **login** — credentials → dashboard; asserts session works (and, post-item-2, that tokens are cookie-based, not in `localStorage`).
  2. **switch-tenant** — a multi-membership user switches tenant ([api.ts:92 `switchTenant`](../../../apps/web/src/lib/api.ts)); asserts the new tenant's data shows and the previous tenant's data does **not** (isolation smoke).
  3. **sale approve** — staff creates a draft sale, admin approves it; asserts status transition + that a commission is credited.
  4. **payout approve** — admin approves a payable payout; asserts balance/status transition.
- Seed via the existing API seed path (reuse the fixtures the 43 API specs use) so web tests hit a real backend.
- Add `"test:e2e": "playwright test"` to `apps/web/package.json`.
- **CI wiring note.** Add `.github/workflows/ci.yml`: matrix job that (1) runs API integration specs against a Postgres service container **with the new RLS migration applied** (so item 1's policies are exercised), (2) builds web, (3) runs Playwright against the built web + seeded API. Gate merges on green. This is also where item 1's dev-guard extension will fail the build on any un-scoped query.

**Edge cases.** Tests must run against an ephemeral DB (migrations + seed per run), not a shared one. Playwright must handle the item-2 silent-refresh redirect. Keep the suite *smoke* (fast, deterministic) — deep coverage is a later track.

**Tests.** This item *is* the tests; success = all four specs green in CI.

---

## 4. Throttler → Redis store 🟡

**Problem.** The global rate-limiter is in-memory, single-instance ([app.module.ts:43-51](../../../apps/api/src/app.module.ts) — the comment literally says *"MVP: in-memory (tek instance)… Cok-instance icin Redis store'a gecilir"*). Horizontally scaling the API multiplies the effective limit by the instance count, weakening abuse/brute-force protection on `login`, `refresh`, and payout endpoints.

**Decision.** Swap `ThrottlerModule`'s storage to a Redis-backed store (`@nest-lab/throttler-storage-redis` or equivalent) so the limit is cluster-wide. Keep `THROTTLE_TTL_MS`/`THROTTLE_LIMIT` values unchanged.

**Changes.**
- `apps/api/src/app.module.ts`: `ThrottlerModule.forRootAsync` providing a Redis `storage`. Reuse the same Redis connection intended for any future shared state (e.g. Web Push/SSE fan-out already in the codebase).
- Preserve the test carve-out (`skipIf`, [app.module.ts:44 comment](../../../apps/api/src/app.module.ts)) so the 43 specs don't start tripping the limiter.
- `X-Forwarded-For` is already trusted ([main.ts:15](../../../apps/api/src/main.ts)) so per-IP keys are correct behind Caddy.

**Edge cases.** Redis down → decide fail-open (serve, log) vs fail-closed (reject); recommend **fail-open with alert** so a Redis blip doesn't take down auth. Key namespace must include tenant/route to avoid cross-tenant limit bleed. Single-instance dev keeps working (Redis optional locally, fall back to in-memory when `REDIS_URL` unset).

**Tests.** Integration: two simulated instances sharing Redis enforce one combined limit; limiter still bypassed in the existing suite.

---

## 5. BigInt/JSON serialization discipline 🟡

**Problem.** Cents are BigInt server-side and are hand-serialized to **strings** per-service via ad-hoc `.toString()` / `serialize()` helpers (e.g. [sales.service.ts:63](../../../apps/api/src/sales/sales.service.ts), [wallet.service.ts:61-116](../../../apps/api/src/wallet/wallet.service.ts)). There is **no** global `BigInt.prototype.toJSON` and **no** shared serializer — a new endpoint that returns a BigInt without calling `.toString()` will throw `TypeError: Do not know how to serialize a BigInt` at the JSON boundary, or (worse, if someone "fixes" it with `Number()`) silently lose precision above 2^53.

**Decision.** Add one shared serializer + a lint rule; standardize on **cents-as-string** across the boundary (matches the frontend, which already `Number()`-parses at display, [format.ts:3](../../../apps/web/src/lib/format.ts)).

**Changes.**
- Add `apps/api/src/common/serialize.ts` exporting `serializeCents(v: bigint): string` and a generic `serializeMoney(obj, keys)` helper; migrate the per-module `serialize()` helpers to it incrementally (start with `sales`, `payouts`, `wallet`, `reports`).
- Add a global safety net: a `BigInt.prototype.toJSON = function(){ return this.toString() }` shim installed once in `main.ts` **or** a Nest interceptor that stringifies BigInts, so a *forgotten* `.toString()` degrades to a correct string instead of a 500. (Choose the interceptor if you want it scoped to responses only.)
- **Optional lint:** an ESLint rule (or a targeted `no-restricted-syntax`) flagging `Number(<bigint-typed>)` and BigInt values reaching `res.json` without serialization, wired into item 3's CI.

**Edge cases.** Frontend already expects strings for cents — no client change. Any endpoint currently returning a raw `number` for cents (verify none regressed to `Number()`) stays a number only if it's a genuinely bounded count. The global `toJSON` shim is process-wide — document it so nobody assumes BigInt serializes to a JSON number.

**Tests.** Unit: `serializeCents(9007199254740993n)` round-trips losslessly as a string; an endpoint returning an un-`.toString()`'d BigInt no longer 500s (with the shim) and yields a string.

---

## 6. Adjacent security items (schedule as follow-ups)

Out of scope for this track's core (structural isolation + session hardening), but flagged by the earlier security audit ([audit-security memory](../../../)) and should be scheduled next:
- **Encryption-key fallback** — remove any default/fallback enc key; fail-closed if unset.
- **RBAC escalation paths** — the `assertGrantable` ceiling and `GOD_TIERS` handling ([auth.guard.ts:37](../../../apps/api/src/auth/auth.guard.ts), [permissions.ts:4](../../../apps/api/src/common/permissions.ts)); audit for privilege-grant-above-self.
- **API-key handling** — `ApiKey` model is tenant-scoped and bypasses the JWT-staleness recheck ([auth.guard.ts:114](../../../apps/api/src/auth/auth.guard.ts)); review key rotation/scoping/hashing.
- **SSRF** — webhook endpoints (`WebhookEndpoint` model) and any outbound fetch; allow-list egress.
- **CSV-injection** — CSV export paths ([payouts.service.ts:633](../../../apps/api/src/payouts/payouts.service.ts), [reports.service.ts:507](../../../apps/api/src/reports/reports.service.ts)); prefix-escape formula-leading cells.
- **OFAC / sanctions screening** — check-payout business obligation; screen payees before mailing.

These are noted here for continuity; each is its own work item.

## Sequencing

1. **`@CurrentActor` decorator** (item 1, part A) — MVP, unblocks everything, mechanical + safe.
2. **RLS backstop + `SET LOCAL` threading + dev-guard extension** (item 1, part B) — MVP, the core of this track; land behind a per-table flag.
3. **Playwright smoke + CI** (item 3) — MVP; must exist before item 2 changes auth plumbing so regressions are caught.
4. **httpOnly cookie + CSRF** (item 2) — high value, done *after* tests exist.
5. **BigInt serializer + shim** (item 5) — quick, low-risk, do alongside any of the above.
6. **Throttler → Redis** (item 4) — deferred until horizontal scaling is imminent.
7. **Adjacent security items** (item 6) — scheduled as a follow-on track.

## Effort (rough table)

| # | Item | Backend | Frontend | Migration/risk |
|---|------|---------|----------|----------------|
| 1a | `@CurrentActor` choke point | M (116 call sites) | — | low (mechanical) |
| 1b | RLS + `SET LOCAL` + dev-guard | L | — | ⚠️ high-blast-radius DB migration; pooler mode |
| 2 | httpOnly cookie + CSRF | M | M | medium (auth-flow change) |
| 3 | Playwright smoke + CI | S (seed reuse) | M | low; new CI infra |
| 4 | Throttler → Redis | S | — | low; needs Redis in prod |
| 5 | BigInt serializer + shim | S | — | low |
| 6 | Adjacent security follow-ups | — | — | tracked separately |

## Explicit non-goals (separate tracks)

- **Feature-gap sprint** (duplicate detection, mandatory reject reason, plan simulator, share presets, fraud triage UI, activity feed) — see [2026-07-09-feature-gap-sprint-design.md](2026-07-09-feature-gap-sprint-design.md).
- **Design-system / primitives migration**, shadcn-vs-hand-rolled decision, `statusBadge` full rollout.
- **Platform Command Center** build-out.
- **Deep** web/E2E coverage beyond the four smoke flows; visual regression.
- **Full** RBAC/escalation, SSRF, CSV-injection, enc-key, API-key, and OFAC remediation — enumerated in item 6, scheduled as the next security track, not implemented here.
- Reconciliation v2, first-class Payout Run object, member Segments engine.
