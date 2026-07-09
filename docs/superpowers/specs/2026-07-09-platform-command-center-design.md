# Platform Command Center — Design Spec

- **Date:** 2026-07-09
- **Branch:** `claude/serene-rosalind-6a05c6` (base: `reconcile/advanced-base`)
- **Author:** Mustafa + Claude
- **Status:** Draft — awaiting review

## Context

The 2026-07-09 ground-truth audit found the super-admin (Axtra platform-owner) surface is the one
genuinely-empty area of the product. It is three pages — a companies directory
([`page.tsx`](../../../apps/web/src/app/platform/page.tsx)), a single-scroll company detail
([`companies/[id]/page.tsx`](../../../apps/web/src/app/platform/companies/[id]/page.tsx)), and a
one-item nav shell ([`layout.tsx`](../../../apps/web/src/app/platform/layout.tsx)) — over a solid but
narrow backend ([`platform.service.ts`](../../../apps/api/src/platform/platform.service.ts),
[`billing.service.ts`](../../../apps/api/src/platform/billing.service.ts)). There is no landing/command
dashboard, no onboarding wizard (`TenantStatus` is only `active|suspended` —
[`schema.prisma:28`](../../../apps/api/prisma/schema.prisma)), no cross-tenant search, no audit viewer
(rows *are* written but never read back on the platform surface), no system-health panel (the scheduler
already tracks `jobHealth()` in [`scheduler.service.ts:96`](../../../apps/api/src/scheduler/scheduler.service.ts)
but nothing exposes it), no email onboarding (owner temp-password is copy-shared once), no platform-admin
management UI (`isPlatformAdmin` is flipped by a CLI script
[`add-platform-admin.ts`](../../../apps/api/prisma/add-platform-admin.ts)), and no plan/package matrix.
`docs/PRODUCT-BLUEPRINT.md` §5 marks Platform admin ❌. This track fills that surface, MVP-first.

> Path links below are relative to this file (`docs/superpowers/specs/`); repo root is three levels up.

## Global constraints & conventions (apply to every item)

1. **Multi-tenant isolation is manual and is the #1 structural risk.** The platform surface is the *one*
   place that legitimately reads across tenants, but it must do so only under `@PlatformAdmin()`
   ([`auth.guard.ts:33`](../../../apps/api/src/auth/auth.guard.ts)). Every *tenant-scoped* mutation this
   track adds (invites, billing, plans, impersonation target lookups) MUST still carry `where: { tenantId }`.
   No tenant-facing endpoint gains a cross-tenant read.
2. **Money is BigInt cents server-side**; `Number()` / `.toString()` only at the display edge (follow the
   `serialize()` pattern in [`billing.service.ts:138`](../../../apps/api/src/platform/billing.service.ts)).
3. **Audit** every money- or permission-affecting mutation in the same transaction, reusing the existing
   `auditLog.create` pattern (`setStatus` [`platform.service.ts:112`](../../../apps/api/src/platform/platform.service.ts),
   `billing.audit()` [`billing.service.ts:153`](../../../apps/api/src/platform/billing.service.ts),
   `security.impersonate_start` [`members.admin.service.ts:59`](../../../apps/api/src/members/members.admin.service.ts)).
   Note: `AuditLog` is a **per-tenant sealed hash chain** (`seq`/`hash`,
   [`reports.service.ts:33`](../../../apps/api/src/reports/reports.service.ts)) — platform-level actions on
   a tenant write into *that tenant's* chain with `tenantId` set, exactly as `setStatus` does today.
4. **UI text is English** (chat is Turkish, product UI is not). Route every status pill through one shared
   `statusBadge()` helper rather than interpolating a raw domain string into a CSS class.
5. **No design-system migration here.** Reuse existing primitives from
   [`ui.tsx`](../../../apps/web/src/components/ui.tsx) — `Modal`, `Confirm`, `Loading`, `Pagination`,
   `StatCard`, `useToast`, `SortableTh`, `useTablePrefs` — and `globals.css` classes (`card`, `badge`,
   `stat-grid`, `btn`). Systematizing the design layer is a separate track.

---

## 1. Platform overview dashboard + "needs attention" queue

**Problem.** `/platform` lands directly on the companies directory
([`page.tsx:25`](../../../apps/web/src/app/platform/page.tsx)); there is no command-center landing. The
operator cannot see, at a glance, which tenants are on fire: overdue invoices are only visible by scanning
the AR strip ([`page.tsx:84`](../../../apps/web/src/app/platform/page.tsx)), tenants with 0 members / no
active plan are invisible, stuck payouts (`requested`/`processing` for too long,
[`schema.prisma:598`](../../../apps/api/prisma/schema.prisma)) are unsurfaced, and there is no notion of a
setup-incomplete tenant (see item 2). Most of this data is already computable server-side.

**Decision.** Add a `/platform` **overview** page (dashboard + needs-attention queue) and move the current
directory to `/platform/companies`. Nav gains an "Overview" item above "Companies". The queue is a single
backend call that returns a flat, typed list of `{ tenantId, tenantName, kind, severity, detail, ctaHref }`
rows, computed with aggregate queries (no per-tenant N-loop — see item 11).

**Changes.**
- **Backend:** new `GET /platform/overview` in
  [`platform.controller.ts`](../../../apps/api/src/platform/platform.controller.ts) →
  `PlatformService.overview()`. Returns:
  - **KPIs:** total companies, active vs suspended, total members, platform revenue-this-month (sum), plus
    AR totals (delegate to `BillingService.overview()` [`billing.service.ts:109`](../../../apps/api/src/platform/billing.service.ts), which already computes `openCents/overdueCents/paidCents`).
  - **Needs-attention rows**, each a cheap set query:
    - *overdue billing*: reuse `billing.overview()` invoices where `overdue === true`.
    - *no members*: `membership.groupBy(['tenantId'])` → tenants absent from the grouping (or count 0).
    - *no active plan*: `commissionPlan.findMany({ where: { effectiveFrom: { lte: now } }, distinct: ['tenantId'] })` → tenants missing.
    - *stuck payouts*: `payout.groupBy(['tenantId'], { where: { status: { in: ['requested','processing'] }, createdAt: { lt: now-72h } } })`.
    - *setup incomplete*: `tenant.findMany({ where: { status: 'setup_needed' } })` (item 2).
  - `severity` derived (`high` for overdue/stuck-payout, `warn` for no-plan/no-members/setup).
- **Frontend:** new [`apps/web/src/app/platform/page.tsx`](../../../apps/web/src/app/platform/page.tsx)
  (overview) — top KPI `StatCard` grid + a "Needs attention" card listing queue rows with a severity dot and
  a deep-link CTA (`ctaHref` → company detail tab). Move existing directory content to new
  `apps/web/src/app/platform/companies/page.tsx`. Update nav in
  [`layout.tsx:10`](../../../apps/web/src/app/platform/layout.tsx) to `[{Overview}, {Companies}]`.

**Edge cases.** Empty platform (0 tenants) → friendly zero-state, not an error. A tenant can appear in
multiple queue kinds (dedupe by rendering one row per `(tenantId, kind)`). Suspended tenants are excluded
from "no members / no plan" noise (they're intentionally off).

**Tests.** `platform.int-spec`: seed a tenant with 0 members, one with no plan, one with a 4-day-old
`requested` payout, one overdue invoice → assert each surfaces exactly once with the right `kind`/`severity`;
assert suspended tenant does not surface no-member/no-plan.

---

## 2. `TenantStatus.setup_needed` + multi-step onboarding wizard

**Problem.** `TenantStatus` is only `active|suspended`
([`schema.prisma:28`](../../../apps/api/prisma/schema.prisma)). New-company creation is a **single-screen
modal** (`NewCompanyModal` [`page.tsx:178`](../../../apps/web/src/app/platform/page.tsx)) → one
`POST /platform/companies` ([`platform.service.ts:147`](../../../apps/api/src/platform/platform.service.ts))
that atomically creates tenant + default 10% plan + owner root membership. There is no branding step, no
owner-invite step, no post-create checklist, and new tenants land straight in `active` with a copy-shared
temp password.

**Decision.** Add `setup_needed` to `TenantStatus`; new tenants land in `setup_needed` (writes/reads still
allowed — the guard only special-cases `suspended`
[`auth.guard.ts:84`,`120`](../../../apps/api/src/auth/auth.guard.ts), so `setup_needed` behaves like active
for auth but is *flagged* on the platform surface). Replace the modal with a **4-step wizard**:
(1) company (name/slug/currency/timezone), (2) plan/package (item 10 — default preselected), (3) branding
(logo/colors → `tenant.branding` JSON, [`schema.prisma:178`](../../../apps/api/prisma/schema.prisma)),
(4) invite owner (item 8). Post-create the company detail Overview shows a **setup checklist** that flips the
tenant to `active` when complete ("Activate company" action) — an explicit gate so operators finish setup.

⚠️ **DECISION TO CONFIRM:** should the guard treat `setup_needed` as write-blocked (true "draft" tenant) or
fully open (my recommendation: **fully open** — the owner can log in and configure before go-live; the flag is
purely a platform-side checklist state). If write-blocked is preferred, add `setup_needed` to the guard's
inactive-status checks alongside `suspended`.

**Changes.**
- **Backend:** migration adds `setup_needed` enum value (append-only, safe). `createCompany`
  ([`platform.service.ts:159`](../../../apps/api/src/platform/platform.service.ts)) sets
  `status: TenantStatus.setup_needed`. New endpoints: `PUT /platform/companies/:id/branding`
  (validated JSON: `{ logoUrl?, primaryHex?, accentHex? }`) writing `tenant.branding`; and reuse
  `PATCH /platform/companies/:id/status` [`platform.controller.ts:65`](../../../apps/api/src/platform/platform.controller.ts)
  to flip `setup_needed → active` (extend `setStatusSchema`
  [`platform.types.ts:6`](../../../apps/api/src/platform/platform.types.ts) to accept `active|suspended|setup_needed`).
  `company()` response ([`platform.service.ts:82`](../../../apps/api/src/platform/platform.service.ts)) gains
  a computed `setup: { hasPlan, hasBranding, hasOwnerAccepted, memberCount }` block.
- **Frontend:** replace `NewCompanyModal` with a stepped `<OnboardingWizard>` (reuse `Modal`; steps as local
  state, no router change). Company detail Overview tab renders the checklist + "Activate company" button
  (uses `Confirm`).

**Edge cases.** Slug collision already handled (`ConflictException`
[`platform.service.ts:154`](../../../apps/api/src/platform/platform.service.ts)) — surface on step 1 without
losing later steps. Branding must sanitize hex/URL (reject non-hex, non-https). Activating a tenant with no
plan is blocked with a clear message. Wizard abandonment leaves a `setup_needed` tenant that the item-1 queue
surfaces — this is intended, not orphaned.

**Tests.** `platform.int-spec`: create → assert `status==='setup_needed'`; branding PUT rejects bad hex;
status flip to `active` blocked when `hasPlan===false`, allowed otherwise; enum migration round-trips.

---

## 3. Company detail tabs (Overview / Users / Plans / Payouts / Audit / Health / Settings)

**Problem.** [`companies/[id]/page.tsx`](../../../apps/web/src/app/platform/companies/[id]/page.tsx) is a
single long scroll: header + 4 KPIs + Billing card + `NetworkExplorer`. Plan is read-only
([`page.tsx:154`](../../../apps/web/src/app/platform/companies/[id]/page.tsx)); `branding` is fetched
([`platform.service.ts:89`](../../../apps/api/src/platform/platform.service.ts)) but never rendered; there is
no users list, no payouts view, no audit, no health, no settings.

**Decision.** Convert company detail to a **tabbed layout** with a persistent header (name, status badge,
"Open company admin" [item 4], Suspend/Reactivate). Tabs, MVP-first:
- **Overview** (KPIs + setup checklist [item 2] + billing summary link) — MVP.
- **Users** (tenant members table; hosts the existing `NetworkExplorer` + a flat paginated list) — MVP.
- **Plans** (item 10 matrix; currently read-only plan surfaced here).
- **Payouts** (read-only cross-view of this tenant's payouts, sourced from existing payouts data).
- **Audit** (item 6 viewer, tenant-scoped).
- **Health** (item 7, tenant-relevant slice).
- **Settings** (branding + billing config edit, moved out of the scroll).

**Changes.**
- **Frontend:** introduce `?tab=` query-param routing inside the existing client page (no new routes needed;
  keep it a single `'use client'` component with a `tab` state synced to the URL). Extract current Billing
  card → Settings tab; `NetworkExplorer` → Users tab. Add a `<Tabs>` strip (new small component in the page
  or `ui.tsx`).
- **Backend:** mostly reuses existing per-company endpoints; new reads added by items 6/7/10 hang off their
  tabs. Add `GET /platform/companies/:id/members?page=` and `GET /platform/companies/:id/payouts?page=`
  (paginated, `where: { tenantId: id }`).

**Edge cases.** Deep links (`?tab=audit`) must work on first paint. Suspended tenant still shows all tabs
(read-only where mutation would hit the guard). Tab state persists across the "Open company admin" round-trip
via `sessionStorage` or is simply reset (acceptable).

**Tests.** Frontend: assert `?tab=users` renders the members table on load. Backend: members/payouts
endpoints reject a mismatched tenant scope and paginate correctly.

---

## 4. Safe platform impersonation ("Open company admin") — no pre-existing membership required

**Problem.** "Enter workspace" is **not** impersonation. `enterWorkspace()`
([`companies/[id]/page.tsx:91`](../../../apps/web/src/app/platform/companies/[id]/page.tsx)) calls
`membershipForTenant()` + `/me/switch-tenant`, so it requires the platform admin to **already hold a
membership** in that tenant — a dead end otherwise (it literally shows "You have no membership in this
company yet"). The real impersonation flow (`POST /admin/members/:id/impersonate`,
[`members.admin.service.ts:36`](../../../apps/api/src/members/members.admin.service.ts)) is tenant-side,
read-only (`imp` claim; guard blocks non-GET [`auth.guard.ts:106`](../../../apps/api/src/auth/auth.guard.ts)),
and **cannot target owners/admins** (`BadRequestException`
[`members.admin.service.ts:42`](../../../apps/api/src/members/members.admin.service.ts)).

**Decision.** Add a **platform-scoped impersonation** endpoint that mints a short-lived token acting as the
tenant **owner** (so the operator sees the full admin surface), reusing the existing `imp` audit + readonly
pattern — but *without* requiring the platform admin to hold a membership. The token carries
`mid = <owner membership id>`, `tid`, `role: tenant_owner`, and `imp = <platform admin userId>`. The guard
already blocks all non-GET when `imp` is set ([`auth.guard.ts:106`](../../../apps/api/src/auth/auth.guard.ts)),
so this is **read-only by construction** — safe even as owner. Add a persistent "Viewing as {tenant} — exit"
band.

⚠️ **DECISION TO CONFIRM:** read-only owner-view (my recommendation — matches the existing `imp` contract and
needs zero guard changes) **vs.** a full read-write platform impersonation (would require relaxing the
`imp` non-GET block and much stronger auditing). Recommend shipping read-only first.

**Changes.**
- **Backend:** new `POST /platform/companies/:id/impersonate` on
  [`platform.controller.ts`](../../../apps/api/src/platform/platform.controller.ts) (guarded by
  `@PlatformAdmin()`). Service looks up the tenant's `tenant_owner` membership
  (`membership.findFirst({ where: { tenantId: id, role: 'tenant_owner', status: 'active' } })`), signs an
  access token with `{ sub: platformAdminUserId, mid: ownerMembership.id, tid: id, role: tenant_owner, imp: platformAdminUserId }`
  and `expiresIn: authConfig.accessTtlSeconds` (mirror
  [`members.admin.service.ts:48`](../../../apps/api/src/members/members.admin.service.ts) and
  `signAccess` [`auth.service.ts:524`](../../../apps/api/src/auth/auth.service.ts)). Writes
  `security.platform_impersonate_start` audit into the tenant chain. Add matching
  `POST /platform/companies/:id/impersonate/end` (audit `..._end`). **Note:** because `sub` is the platform
  admin, the `imp` GET-only guard fires; do not embed tenant `perms` (owner tier is god-mode in-guard, so no
  `perms` needed [`auth.guard.ts:153`](../../../apps/api/src/auth/auth.guard.ts)).
- **Frontend:** replace the "Enter workspace" button
  ([`companies/[id]/page.tsx:140`](../../../apps/web/src/app/platform/companies/[id]/page.tsx)) with
  "Open company admin". On click: call the endpoint, `applyTenantSwitch(accessToken, membershipId)`
  ([`auth.ts:48`](../../../apps/web/src/lib/auth.ts)), stash a `impersonating` marker + return path in
  `sessionStorage`, `router.push('/admin')`. Add a top-of-page "Viewing as {tenant} — exit" band (rendered in
  `/admin` and `/app` layouts when the marker is present) that restores the platform session on exit.

**Edge cases.** Tenant with no active owner membership → 404 with a clear message ("company has no active
owner"). Suspended tenant → block impersonation (mirror `switchTenant`'s `tenant: { status: active }` filter
[`auth.service.ts:355`](../../../apps/api/src/auth/auth.service.ts); allow `setup_needed`). Token expiry
mid-session → user is bounced to login; the exit band must survive a refresh (persist in `sessionStorage`, not
component state). Any non-GET request during impersonation returns 403 by design — the UI must not offer
mutating actions while the band is shown.

**Tests.** `platform.int-spec`: platform admin with **no** membership in tenant X can mint an impersonation
token for X's owner and issue a GET; a POST with that token 403s; suspended tenant rejects; both start/end
audit rows land in tenant X's chain.

---

## 5. Global cross-tenant search (users / members / sales / payouts)

**Problem.** The only search is an **in-memory** name/slug filter over already-loaded companies
(`filtered` [`page.tsx:54`](../../../apps/web/src/app/platform/page.tsx)). There is no way to find a user by
email, a member by referral code, a sale, or a payout across all tenants.

**Decision.** Add a single `GET /platform/search?q=` that fans out a bounded query across a few entities and
returns a typed, capped result set (e.g. 10 per category). Platform-admin only; this is the sanctioned
cross-tenant read.

**Changes.**
- **Backend:** new `PlatformService.search(q)` → `GET /platform/search`. For a trimmed `q` (min 2 chars):
  - **users:** `user.findMany({ where: { OR: [{ email: { contains: q, mode: 'insensitive' } }, { fullName: { contains: q, mode: 'insensitive' } }] }, take: 10 })` + resolve their memberships → `{ userId, email, fullName, tenants: [...] }`.
  - **members:** `membership.findMany({ where: { referralCode: { contains: q.toUpperCase() } }, include: { user, tenant }, take: 10 })`.
  - **sales:** `sale.findMany({ where: { OR: [{ externalRef: { contains: q } }, ...] }, take: 10 })` (scoped only by the match, returns `tenantId`).
  - **payouts:** by `checkNumber`/`ref` where `q` is numeric/ref-like.
  Each result row carries `tenantId` + `tenantName` + a `ctaHref` deep-linking into the right company tab.
- **Frontend:** a search box in the platform header (in [`layout.tsx`](../../../apps/web/src/app/platform/layout.tsx)
  or overview) with a debounced dropdown of grouped results.

**Edge cases.** `q < 2` chars → empty result, no query. Case-insensitive on email/name; referral codes are
uppercase ([`platform.service.ts:206`](../../../apps/api/src/platform/platform.service.ts)) so upper the
needle for that branch. Cap total rows hard (defense against a `q='a'` fan-out). PII: this endpoint returns
emails across tenants — it is `@PlatformAdmin()` only and every call is rate-limited by the global throttler.

**Tests.** `platform.int-spec`: seed users/members across two tenants; assert email substring finds the right
user with correct tenant attribution; referral-code search is case-insensitive; `q=''` returns empty; a
tenant_admin token 403s.

---

## 6. Platform audit-log viewer

**Problem.** Audit rows **are** written by platform actions (`platform.tenant_*`
[`platform.service.ts:114`](../../../apps/api/src/platform/platform.service.ts), `tenant.create`
[`platform.service.ts:235`](../../../apps/api/src/platform/platform.service.ts), `billing.*`
[`billing.service.ts:60`,`94`,`104`](../../../apps/api/src/platform/billing.service.ts)) but there is **no
viewer** on the platform surface. The tenant-side viewer (`GET /reports/audit`
[`reports.controller.ts:75`](../../../apps/api/src/reports/reports.controller.ts)) is tenant-scoped and behind
tenant auth.

**Decision.** Add a platform audit viewer with two entry points: a **per-tenant** Audit tab (item 3) and a
**global** platform audit feed. Read-only, paginated, filterable by `action`/`entity`/date.

**Changes.**
- **Backend:** `GET /platform/companies/:id/audit?page=&action=` → `auditLog.findMany({ where: { tenantId: id, ... }, orderBy: { seq: 'desc' }, take, skip })` returning `{ seq, action, entity, entityId, actorUserId, before, after, createdAt }` (resolve `actorUserId → email` via a batched `user.findMany`). Global feed `GET /platform/audit?page=&action=` (no `tenantId` filter — the sanctioned cross-tenant read) joins `tenant.name`. Keep `before/after` JSON as-is (already sanitized at write).
- **Frontend:** Audit tab table (reuse `SortableTh`/`Pagination`), a global Audit view reachable from the
  overview. Render `action` through a small label map; show a diff popover for `before`/`after`.

**Edge cases.** Large `before/after` blobs → truncate in the row, full in a modal. `actorUserId` may be null
(system actions) → show "system". The chain is sealed nightly ([`scheduler.service.ts:157`](../../../apps/api/src/scheduler/scheduler.service.ts));
the viewer reads rows regardless of `hash` state and never mutates. Pagination must be stable under
`orderBy: seq desc`.

**Tests.** `platform.int-spec`: perform a suspend + an invoice-issue, then assert both appear in the tenant
audit feed with correct `action`/actor; global feed returns rows from multiple tenants; filter by
`action='billing.invoice_paid'` narrows correctly.

---

## 7. System health / jobs / backups panel

**Problem.** `/healthz` ([`health.controller.ts`](../../../apps/api/src/health/health.controller.ts)) is
infra-only (DB ping, public, no auth) and unused by the UI. The scheduler already tracks per-job last-run
health via `jobHealth()` ([`scheduler.service.ts:96`](../../../apps/api/src/scheduler/scheduler.service.ts))
with staleness thresholds ([`scheduler.service.ts:31`](../../../apps/api/src/scheduler/scheduler.service.ts)),
but **nothing exposes it** — `HealthModule` only declares the controller
([`health.module.ts`](../../../apps/api/src/health/health.module.ts)). Backups exist as a script
([`docker/backup/backup.sh`](../../../docker/backup/backup.sh)) with no status surface.

**Decision.** Add a platform-admin **system panel** backed by a new `GET /platform/health` that composes:
DB ping + scheduler `jobHealth()` (name, lastRun, ok, stale?) + a backup-status read. Do **not** expose job
internals on public `/healthz`.

**Changes.**
- **Backend:** import `SchedulerModule` into `PlatformModule`
  ([`platform.module.ts`](../../../apps/api/src/platform/platform.module.ts)) and inject `SchedulerService`
  (export it from its module first). New `GET /platform/health` → `{ db, jobs: scheduler.jobHealth(), backups }`.
  For `jobs`, decorate each with a `stale` flag using the existing `FRESHNESS_MS` map
  ([`scheduler.service.ts:31`](../../../apps/api/src/scheduler/scheduler.service.ts)) (expose a small
  `jobHealthWithStaleness()` helper on the service). For `backups`, ⚠️ **DECISION TO CONFIRM:** simplest MVP
  is to record the last successful backup to a tiny `SystemStatus` row (or read a marker file the script
  touches) — recommend a **1-row `SystemStatus` table** written by a new post-backup hook, so
  the panel shows `lastBackupAt` without shelling out. If out of scope, show "backups: script-managed"
  placeholder and wire later.
- **Frontend:** a "System" nav item + page: DB status pill, a jobs table (name / last run / ok / stale
  highlighted red), and backup freshness. Auto-refresh every ~30s.

**Edge cases.** `jobHealth()` is **process-local** and resets on restart
([`scheduler.service.ts:28`](../../../apps/api/src/scheduler/scheduler.service.ts)) — a freshly-restarted API
shows empty jobs; label that as "no runs since restart", not "failing". Multi-instance deploys would show only
the responding instance's jobs (note as a known limitation). Never expose secrets/paths in the response.

**Tests.** Unit: `jobHealthWithStaleness()` flags a job whose `lastRun` exceeds its `FRESHNESS_MS`.
`platform.int-spec`: `/platform/health` returns `db:true` and a jobs array; tenant token 403s.

---

## 8. Tenant-owner email invite / accept flow (replace one-time temp password)

**Problem.** New-owner onboarding shows a temp password **once** and relies on manual copy-share
(`tempPassword` [`platform.service.ts:188`](../../../apps/api/src/platform/platform.service.ts); UI
[`page.tsx:213`](../../../apps/web/src/app/platform/page.tsx)). There is no email invite/accept. A member-level
`Invite` model exists ([`schema.prisma:417`](../../../apps/api/prisma/schema.prisma)) but it is tied to an
`inviterMembershipId` and the tenant referral tree — not fit for a platform-issued owner invite before the
owner has any membership context.

**Decision.** Issue a **platform owner-invite token** at company creation (step 4 of the wizard, item 2): a
short-lived, single-use token emailed to the owner; accepting it lets them set their own password and marks the
tenant's setup "owner accepted". Reuse the existing `UserToken` mechanism (email-verify / password-reset tokens
already exist, [`auth.service.ts:373`](../../../apps/api/src/auth/auth.service.ts)) rather than the member
`Invite` model.

⚠️ **DECISION TO CONFIRM:** reuse `UserToken` with a new `purpose` (recommended — the hashing, expiry, and
single-use machinery already exist) **vs.** a new `PlatformOwnerInvite` table. Recommend `UserToken`.

**Changes.**
- **Backend:** in `createCompany` ([`platform.service.ts:184`](../../../apps/api/src/platform/platform.service.ts)),
  when a **new** owner user is created, skip the temp password entirely and instead create a `UserToken`
  (`purpose: owner_invite`, hashed, 7-day expiry) and enqueue an email (reuse the notification/email path the
  password-reset flow already uses). Add public `POST /auth/accept-owner-invite { token, password, fullName? }`
  that validates the token, sets the password hash, verifies the email, and returns a normal session. The
  `company()` `setup.hasOwnerAccepted` flag (item 2) reads `emailVerifiedAt`/token-used state.
- **Frontend:** wizard step 4 collects owner email/name and shows "invite will be emailed" (drop the
  copy-password card). New public `/accept-invite?token=` page → set-password form → land in `/admin`.

**Edge cases.** Owner email already has an account → no token, they're added as owner and simply notified
(preserve existing `ownerExisting` branch [`platform.service.ts:242`](../../../apps/api/src/platform/platform.service.ts)).
Token expiry/reuse → clear error + "resend invite" action on company detail. Do **not** leak whether an email
exists (mirror password-reset's constant response [`auth.service.ts:385`](../../../apps/api/src/auth/auth.service.ts)).
Email delivery failure must not roll back tenant creation — enqueue outside the create transaction and surface
a "resend" affordance.

**Tests.** `platform.int-spec` / `auth.int-spec`: creating a company with a new owner mints an `owner_invite`
`UserToken` and no `tempPassword`; accept sets password + verifies email + returns a session; expired token
rejected; existing-owner path issues no token.

---

## 9. Platform admin / user management UI

**Problem.** `isPlatformAdmin` ([`schema.prisma:284`](../../../apps/api/prisma/schema.prisma)) is flipped only
by a CLI script ([`add-platform-admin.ts`](../../../apps/api/prisma/add-platform-admin.ts)). There is no UI to
list platform admins or grant/revoke the flag, and the token embeds `plat: true` from it
([`auth.service.ts:533`](../../../apps/api/src/auth/auth.service.ts)).

**Decision.** Add a platform-admins management page: list users with `isPlatformAdmin=true`, grant by email,
revoke — all audited, with a **self-revoke guard** and a **last-admin guard**.

**Changes.**
- **Backend:** new endpoints under `@PlatformAdmin()`: `GET /platform/admins` (`user.findMany({ where: { isPlatformAdmin: true } })`),
  `POST /platform/admins { email }` (set flag true, audit `platform.admin_granted`), `DELETE /platform/admins/:userId`
  (set false, audit `platform.admin_revoked`). Guards: cannot revoke self; cannot revoke the **last** remaining
  admin (count check in the same transaction). These audit rows have **no natural tenant** — ⚠️ **DECISION TO
  CONFIRM:** the current `AuditLog` requires `tenantId`; recommend either a dedicated "platform" system-tenant
  row or making `tenantId` nullable for platform-scoped audits. Recommend a nullable-`tenantId` migration for
  `AuditLog` **or** a reserved system tenant; confirm before implementing (touches the sealed-chain invariant
  in [`reports.service.ts`](../../../apps/api/src/reports/reports.service.ts), which groups by tenant).
- **Frontend:** "Admins" page under a new "Platform settings" nav group: table + "Grant by email" `Modal` +
  revoke `Confirm`.

**Edge cases.** Granting a non-existent email → 404 (don't create shell users here). Revoking self is blocked
with a clear message. Newly-granted admin must re-login (or refresh) for `plat` to appear in their token
(access token is stateless [`auth.guard.ts:111`](../../../apps/api/src/auth/auth.guard.ts)) — note this in the
UI. Race on last-admin revoke handled by the transactional count check.

**Tests.** `platform.int-spec`: grant/revoke round-trips and audits; self-revoke 403; last-admin revoke 403;
granting unknown email 404.

---

## 10. Plan/package matrix + MRR + per-tenant feature flags/limits

**Problem.** Billing is a **flat manual monthly fee** only (`TenantBilling.monthlyFeeCents`
[`schema.prisma:213`](../../../apps/api/prisma/schema.prisma)); there is no plan/package concept
(Starter/Growth/Enterprise), no MRR rollup, and no per-tenant feature flags/limits. Company detail shows the
*commission* plan read-only ([`companies/[id]/page.tsx:154`](../../../apps/web/src/app/platform/companies/[id]/page.tsx)) —
distinct from a **billing package**. (Note: this is separate from the on-tenant boolean feature toggles that
already exist on `Tenant`, e.g. `requireKycForPayout`, `compressionEnabled`
[`schema.prisma:162`](../../../apps/api/prisma/schema.prisma).)

**Decision.** Introduce a platform-level `BillingPackage` catalog (name, monthlyFeeCents, feature flags/limits
JSON) and reference it from `TenantBilling`. MRR = sum of active packages' fees. This is the **largest** item;
sequence it last.

⚠️ **DECISION TO CONFIRM:** model packages as a **DB catalog** (`BillingPackage` table + `TenantBilling.packageId`)
so fees/limits are editable without deploys (recommended) **vs.** a hardcoded enum. Recommend the DB catalog.

**Changes.**
- **Backend:** migration adds `model BillingPackage { id, key, name, monthlyFeeCents BigInt, features Json, limits Json, active }`
  and `TenantBilling.packageId String?`. New endpoints: `GET/POST/PUT /platform/packages` (catalog CRUD,
  audited), and extend `PUT /platform/companies/:id/billing`
  ([`platform.controller.ts:85`](../../../apps/api/src/platform/platform.controller.ts)) to accept `packageId`
  (fee defaults from package but stays overridable). Add `GET /platform/mrr` summing `monthlyFeeCents` over
  `TenantBilling` where `active` (BigInt sum, serialized as string). Per-tenant flags/limits read from the
  package `features/limits` JSON, overridable per tenant via a `TenantBilling.overrides Json`.
- **Frontend:** a "Packages" page (catalog editor) + a package selector in the wizard (item 2, step 2) and in
  the company Settings/Plans tab (item 3). Overview KPI adds **MRR** (item 1).

**Edge cases.** Deleting a package that tenants reference → soft-deactivate (`active=false`), never hard-delete
while referenced. Fee override must not silently diverge from the package (show "custom fee" badge). Feature
flags read at the platform edge only for now — **enforcement** in tenant runtime is explicitly out of scope
here (see non-goals). Currency mismatch between package and tenant → block or convert (block for MVP; US-only
so all USD).

**Tests.** `platform.int-spec`: package CRUD + audit; assigning a package sets the default fee; MRR sums only
active billing; soft-delete blocks hard-delete while referenced.

---

## 11. List pagination + status filter + fix the N-query revenue loop

**Problem.** `GET /platform/companies` ([`platform.service.ts:16`](../../../apps/api/src/platform/platform.service.ts))
does an **N-query revenue loop** — one `sale.aggregate` per tenant
([`platform.service.ts:32-42`](../../../apps/api/src/platform/platform.service.ts)) — and returns **all**
tenants with no pagination; the frontend does an in-memory filter only
([`page.tsx:54`](../../../apps/web/src/app/platform/page.tsx)). This is fine at a handful of tenants and
degrades linearly.

**Decision.** Paginate + add a server-side status filter, and collapse the per-tenant revenue loop into a
single grouped aggregate.

**Changes.**
- **Backend:** `companies()` → accept `{ page, pageSize, status?, q? }`. Replace the `Promise.all` revenue
  loop with **one** `sale.groupBy({ by: ['tenantId'], where: { status: 'approved', summaryMonth: <perTZ?> }, _sum: { amountCents }, _count })`.
  ⚠️ **DECISION TO CONFIRM:** the current loop uses **each tenant's own timezone** for `monthKey`
  ([`platform.service.ts:36`](../../../apps/api/src/platform/platform.service.ts)); a single `groupBy` can't
  vary the month boundary per-tenant. Recommend computing `summaryMonth` per tenant-timezone in **one pass**
  by grouping on `(tenantId, summaryMonth)` and selecting each tenant's current-month key app-side (still one
  query), or accept a small "platform TZ" approximation for the directory KPI. Confirm which.
  Add `status` to the `where`, `skip/take` for pagination, and return `{ rows, total }`.
- **Frontend:** wire the existing `Pagination` primitive
  ([`ui.tsx:303`](../../../apps/web/src/components/ui.tsx)) + a status `<select>` (all/active/suspended/setup_needed);
  move the search box to server-side `q` (debounced). Keep the current card grid.

**Edge cases.** `status=setup_needed` filter appears once item 2 lands (guard both). `q` + `status` + pagination
compose in one `where`. Empty page beyond range → clamp to last page.

**Tests.** `platform.int-spec`: seed 25 tenants → page 2 returns the right slice with correct `total`; a single
revenue query (assert no N+1 via query count if the harness supports it, else assert correctness of a tenant's
month revenue); `status=suspended` filters correctly.

---

## Sequencing

MVP-first; money-safety and operator-visibility before nice-to-haves:

1. **Item 11** — pagination + status filter + N-query fix (small, unblocks scale; pure refactor).
2. **Item 1** — overview dashboard + needs-attention queue (highest operator value, mostly reuses existing aggregates).
3. **Item 2** — `setup_needed` + onboarding wizard (unlocks items 8 and 10's entry points).
4. **Item 3** — company detail tabs (structural host for items 6/7/10).
5. **Item 4** — safe platform impersonation (kills the "no membership" dead-end; small, reuses `imp`).
6. **Item 6** — audit viewer (rows already exist; read-only).
7. **Item 5** — global cross-tenant search.
8. **Item 7** — system health/jobs/backups (wire `jobHealth()`).
9. **Item 8** — owner email invite/accept (replaces temp-password).
10. **Item 9** — platform-admin management UI (blocked on the `AuditLog.tenantId` decision).
11. **Item 10** — plan/package matrix + MRR + flags (largest; last).

## Effort (rough table)

| #  | Item | Backend | Frontend | Migration/risk |
|----|------|---------|----------|----------------|
| 1  | Overview + needs-attention queue | M | M | none |
| 2  | `setup_needed` + onboarding wizard | M | L | enum add (append-only, low) |
| 3  | Company detail tabs | S | L | none |
| 4  | Safe platform impersonation | S | M | none (reuses `imp`); **read-only guard reliance** |
| 5  | Global cross-tenant search | M | M | none; PII-across-tenant (guarded) |
| 6  | Platform audit viewer | S | M | none |
| 7  | System health/jobs/backups | S | S | module wiring; optional `SystemStatus` table |
| 8  | Owner email invite/accept | M | M | `UserToken` purpose (low) |
| 9  | Platform-admin management UI | S | S | **`AuditLog.tenantId` nullable / system-tenant (touches sealed chain)** |
| 10 | Plan/package matrix + MRR + flags | L | L | new `BillingPackage` table + FK (medium) |
| 11 | Pagination + status filter + N-query fix | S | S | none; per-TZ month decision |

## Explicit non-goals

- **No design-system migration.** This track reuses `ui.tsx` + `globals.css`; systematizing primitives is the
  separate design-system track (see `2026-07-09-feature-gap-sprint-design.md` §"Global constraints").
- **No tenant-side feature-flag *enforcement*.** Item 10 stores package flags/limits and shows them on the
  platform surface; wiring them into tenant runtime (gating features per package) is a follow-up.
- **No Stripe / automated payment collection.** Billing stays manual (check/wire, mark-paid) exactly as today
  ([`billing.service.ts`](../../../apps/api/src/platform/billing.service.ts)); packages only set the *fee*, not
  a payment rail.
- **No read-write platform impersonation.** Item 4 ships read-only owner-view; a write-capable admin takeover
  is deferred pending the security decision.
- **No automatic multi-tenant RLS.** Tenant isolation remains manual `where: { tenantId }`; hardening it into
  Postgres RLS (`docs/RLS.md`) is out of scope for this track.
- **No changes to the commission engine, payouts issuance, or ledger** — the platform surface *reads* those;
  their mechanics belong to the money/engine tracks.
