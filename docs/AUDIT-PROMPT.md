# Refearn — Full A→Z Audit Prompt

> Reusable, self-contained scan prompt for an **end-to-end, code-grounded audit** of the Refearn
> referral/commission SaaS. **Scan the actual source — do NOT read memory, docs, prior reports, or
> commit messages.** Every finding must cite `file:line` and the exact code. Fresh eyes only.

## Product context (the only context you get)

Refearn is a multi-tenant referral/commission tracker for cabinet companies. People who **sell** or
**refer** earn a **percentage** commission. The product exists to make the **percentage logic easy to
track**: per person, **how much they sold** and **how much they earned**, live and per month. Members
form a **sponsor tree** (ltree `path`); team-leaders are flagged roots. Money is **integer cents
(BigInt)** — never float. Tenancy is strict: every query must be tenant-scoped. Stack: NestJS + Prisma
+ Postgres + zod; Next.js (app router); `@refearn/shared` pure money/commission core.

## Architecture map (entry points to scan)

- **Money core:** `apps/api/src/engine/engine.service.ts`, `packages/shared/src/{commission,money,plan}.ts`
- **Domain:** `sales`, `payouts`, `members`, `memberships`, `invites`, `plans`, `campaigns`, `ranks`, `periods`, `wallet`
- **Compliance/security:** `auth`(+`auth.guard.ts`), `rbac`, `kyc`, `fraud`, `sanctions`, `apikeys`, `webhooks`, `events`(SSE)
- **Ops:** `reports`, `scheduler`, `notifications`, `announcements`, `survey`, `search`, `views`, `settings`, `platform`
- **Data:** `apps/api/prisma/schema.prisma` (34 models, 20 enums), `prisma/migrations/**` (incl. DB triggers/guards)
- **Frontend:** `apps/web/src/app/**` (19 pages), `apps/web/src/components/**`, `apps/web/src/lib/**`
- **Tests:** `apps/api/test/*.int-spec.ts` (41 suites)

## Scan dimensions — check EVERY item against the code

### 1. Security
- **Tenant isolation / IDOR:** every read/write filtered by `tenantId`? Any endpoint that takes an `:id`
  and loads it without a tenant scope? Cross-tenant data leakage via list/detail/export/tree/search?
- **AuthN/AuthZ:** `@Roles`, `@RequireMembership`, `@PlatformAdmin`, `@RequirePermission` correctly applied?
  Any state-changing route missing a guard? Role-escalation paths (set_role, impersonation, owner transfer)?
  Impersonation read-only enforcement. API-key (`X-Api-Key`) scope = creator's role — over-privileged?
- **Input validation:** every body/query through a zod schema? Unbounded arrays/strings? Numeric coercion
  (negative amounts, fractional cents, NaN, Infinity, >2^53)? Regex DoS? Mass-assignment.
- **Injection:** raw SQL (`$queryRaw`) parameterized? ltree path values sanitized? No string interpolation
  into queries. CSV-injection on exports (`=`,`+`,`-`,`@` lead). XSS via unescaped user content.
- **Secrets/crypto:** `REFEARN_ENC_KEY` fallback in prod? argon2 params. JWT secret handling, token TTL,
  refresh-token rotation + reuse detection. Webhook HMAC. Password reset token entropy/expiry/single-use.
- **Transport/infra:** CORS origins, rate-limit coverage (which routes bypass throttler?), security headers,
  error messages leaking internals/stack/user-existence.

### 2. Money & data integrity
- **BigInt discipline:** any money parsed/summed with JS `Number` where precision matters (server AND client)?
- **Transactions:** multi-write money ops in a single tx? Commission apply / void reversal / payout / batch
  approve / clawback — atomic? Correct isolation; `FOR UPDATE` / `SKIP LOCKED` used where needed.
- **Idempotency & races:** double-approve, double-payout, double-submit; concurrent maturation vs void;
  campaign double-finalize; reconcile re-run. Any check-then-act race?
- **Accounting invariants:** `SUM(level_rates) <= pool_rate`; distributed <= amount; reversal equals-and-opposite;
  `monthly_summaries` stays in sync with `ledger_entries`; payable→paid transitions; period-lock enforcement;
  reserve/clawback correctness. DB guards (forbid_reparenting, ledger immutability) still hold via every path.
- **Time/zone:** `summaryMonth` frozen-bucket consistency; tenant timezone; date-only UTC off-by-one; DST.

### 3. Logic correctness (per module)
- Engine: sliding-window distribution, fast-start/matching/rank-override synthetic levels, compression /
  inactive-earn, maturation rules (on_approval/on_delivery/days_after), clawback, bonus layers.
- Each service: edge cases (empty chain, missing upline, inactive seller, zero amount, deleted refs),
  off-by-one, inverted conditionals, wrong field, status-machine gaps (can an entity reach an illegal state?).
- Scheduler crons: overlap guards, partial-failure isolation, multi-tenant correctness.

### 4. Backend quality
- Error handling: leaked 500s, swallowed errors, wrong HTTP codes. N+1 queries, missing indexes for hot paths,
  unbounded `findMany`. Route ordering (static before `:id`). Dead/unused endpoints. DTO/serialization (BigInt→string).

### 5. Frontend wiring & functions
- Every button/control wired to a real handler; every `api.*` call hits an existing backend route (no 404).
- Forms submit correctly (inside `<form>`, validation, disabled-while-busy, double-submit guards).
- Loading / error / empty states present; errors recoverable (no fatal early-return that kills the page).
- Optimistic vs stale data; refetch correctness; SSE/live wiring; pagination/filter/sort correctness.

### 6. UI/UX
- Clarity for a non-technical owner: machine values humanized (roles, statuses, levels, audit actions),
  one consistent language (English), primary action obvious, dense screens prioritized, no dead/disabled-looking controls.
- Sold-vs-earned surfaced where it matters. Consistency of components, money/date formatting, mobile/responsive,
  dark mode, accessibility (labels, roles, keyboard, focus, contrast).

### 7. Features / gaps
- Missing capabilities a real cabinet company needs that the data model already supports but the app doesn't expose.
- Half-wired flows (endpoint exists, no UI; UI exists, no endpoint). Settings toggles that do nothing.

### 8. Tests
- Coverage gaps on money-critical paths, security (authz/tenant-isolation), and new features. Flaky/over-mocked tests.

## Severity rubric
- **critical** — money loss/corruption, cross-tenant leak, auth bypass, data-destruction.
- **high** — broken primary flow, real security weakness, wrong commission, missing guard.
- **med** — logic bug with limited blast radius, missing validation, UX that blocks a task.
- **low / nit** — polish, consistency, minor DX.

## Output contract (per finding)
`{ severity, area (security|money|logic|backend|frontend|uiux|feature|tests), title, file, line,
evidence (code snippet), why (impact), fix (concrete suggestion) }`

## Rules
1. **Read the real code.** No assumptions from names. If a claim depends on another file, open it.
2. **Adversarially verify** before reporting high/critical — try to disprove your own finding; default to
   "not a bug" when the wiring exists elsewhere or it's intentional.
3. **No memory/doc/report reading.** Fresh scan only.
4. Cite `file:line` + evidence for everything. Prefer fewer, real findings over many speculative ones.
