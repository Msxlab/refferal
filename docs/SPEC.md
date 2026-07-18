# Master Specification

Americana Earn is a self-hosted, multi-tenant referral commission platform. This document is the product and architecture contract. When a detail is missing here, check [docs/DECISIONS.md](docs/DECISIONS.md) before inventing a new rule.

## 1. Product Summary

Companies use the platform to run invite-only referral sales networks. A member joins through an invite link, receives a permanent position in the tenant tree, records or participates in real product sales, and earns commission according to the tenant's plan.

The system is designed for luxury furniture and kitchen sales teams first, but the architecture is tenant-safe and SaaS-ready.

## 2. Goals

MVP goals:
- Invite-only member growth.
- Permanent referral tree placement.
- Automatic commission distribution after sale approval.
- Member visibility into pending, payable, and paid earnings.
- Tenant admin tooling for sales, members, payouts, settings, audit, and reports.
- Platform admin visibility across tenants.
- Self-hosted deployment with backup and restore drills.

Non-goals for MVP:
- Automatic Stripe Connect payouts.
- Public self-serve tenant signup.
- Binary, matrix, spillover, or re-parenting compensation models.
- Member access to private sales details of downstream members.
- External auth/BaaS providers such as Firebase, Supabase, or Auth0.

## 3. Commission Model

The product uses a unilevel sliding-window plan.

Rules:
- Each sale has a tenant-defined commission pool rate.
- The pool is distributed from seller upward for `plan.depth` levels.
- Level 0 is always the seller.
- Default plan: 10% pool, 5 levels: seller 5%, L1 2%, L2 1.5%, L3 1%, L4 0.5%.
- If an upline level does not exist, that share is not redistributed; it stays with the company.
- Compression is modeled as a tenant setting but is off by default.
- Plans are versioned by `effective_from`; historical ledger rows never change when a plan changes.

Money rules:
- Store all amounts as integer cents in `BIGINT`.
- Store rates as basis points: `10000 = 100%`.
- Level amount: `floor(amount_cents * rate_bps / 10000)`.
- Do not write zero-cent ledger rows.
- Ledger rows are append-only; corrections use reversal rows.

## 4. Sale And Ledger Lifecycle

Sale states:

```text
draft -> approved -> delivered? -> void?
```

Ledger states:

```text
pending -> payable -> paid
reversed is used for voided or offset entries
```

Maturation modes:
- `on_approval`: ledger rows become payable immediately.
- `on_delivery`: approved rows remain pending until delivery is marked and the scheduler matures them.
- `days_after_approval(N)`: rows mature after N days.

Void behavior:
- Never delete ledger rows.
- Add equal-and-opposite reversal rows.
- Pending/payable originals can move to `reversed`.
- Paid originals stay paid; reversal can create a negative payable balance to offset future earnings.

## 5. Identity And Access

Data model:
- `users` are global accounts.
- `memberships` connect a user to a tenant, role, sponsor, referral code, and tree position.
- One user may belong to multiple tenants.
- Login routes users by role and active membership.

Roles:
- `platform_admin`
- `tenant_owner`
- `tenant_admin`
- `tenant_staff`
- `member`

Permission rules:
- Money and role-changing actions must be audited.
- Tenant-scoped reads and writes must include tenant filters.
- Members receive privacy-safe aggregate team data only.
- Postgres RLS is a required hardening step before broad multi-tenant scale.

## 6. Surfaces And Routes

| Surface | Route |
|---|---|
| Public/auth | `/`, `/login`, `/verify-email`, `/reset-password`, `/i/{code}` |
| Member web app | `/app/*` |
| Tenant admin | `/admin/*` |
| Platform admin | `/platform/*` |
| Mobile member app | Expo app with matching invite deep links |

Runtime UI language is English-only for now.

## 7. Architecture

Monorepo:

```text
apps/api          NestJS, Prisma, commission engine, auth, settings, reports
apps/web          Next.js web runtime
apps/mobile       Expo member app
packages/shared   Pure commission logic, schemas, constants, money helpers
```

Infrastructure:

```text
postgres:17       Source of truth
redis:7           Cache/rate-limit/queue support
api               NestJS process
web               Next.js process
caddy             Reverse proxy and TLS
backup            pg_dump, retention, optional encrypted offsite copy
```

Principles:
- Keep auth self-hosted.
- Use Prisma and parameterized SQL only.
- Keep outbox-style notification delivery.
- Keep operational backup/restore testable.

## 8. Core Tables

Key entities:
- `tenants`: name, slug, currency, status, settings, branding.
- `users`: email, password hash, profile, verification, MFA fields.
- `memberships`: tenant/user link, role, sponsor, referral code, path, status.
- `invites`: inviter, code, optional email lock, expiry, status.
- `commission_plans` and `commission_plan_levels`: versioned plan and rates.
- `sales`: seller, amount, status, dates, external reference.
- `ledger_entries`: beneficiary, level, rate, amount, status, payout link.
- `monthly_summaries`: precomputed earning buckets.
- `payouts`: requested/processing/paid/failed payout records.
- `notifications`: in-app/email/push outbox and inbox items.
- `audit_logs`: money, security, role, plan, and settings changes.

Invariants:
- A sale gets at most one commission row per level/type.
- Ledger totals never exceed the pool.
- Ledger rows are never deleted.
- Plan level totals cannot exceed the pool rate.

## 9. Commission Engine Algorithm

`applyCommissions(sale_id)`:

1. Lock the sale.
2. Return no-op unless sale is approved and unprocessed.
3. Resolve the active plan for the sale date.
4. Resolve seller-to-upline chain for plan depth.
5. For each payable level, calculate floor amount and insert ledger row.
6. Upsert monthly summaries in the same transaction.
7. Write notification outbox records.
8. Commit.

`voidSale(sale_id)`:

1. Lock sale and related commission rows.
2. Mark sale void.
3. Add reversal rows.
4. Update summaries according to current locked statuses.
5. Write audit and notification records.

`matureCommissions`:

1. Select due pending rows with lock/skip-locked behavior.
2. Move rows to payable.
3. Update summaries.

## 10. API Surface

Representative routes:

```text
POST /auth/login
POST /auth/refresh
POST /auth/register-by-invite
POST /auth/verify-email
POST /auth/password-reset/confirm

GET  /app/dashboard
GET  /app/team
GET  /app/wallet
GET  /app/invites
POST /app/invites
POST /app/payout-requests

GET/POST/PATCH /admin/sales
POST /admin/sales/:id/approve
POST /admin/sales/:id/void
GET /admin/members
GET/PATCH /admin/settings
GET /admin/audit
GET /admin/reports

GET /platform/companies
GET /platform/companies/:id
```

## 11. Required Engine Tests

Default plan: 10% pool, rates 500/200/150/100/50 bps.

| ID | Scenario | Expected result |
|---|---|---|
| T1 | Seller has four uplines | All five rows are written and total equals 10% |
| T2 | Founder sells | Only seller row is written; missing upline share stays with company |
| T3 | Seller has two uplines | Three rows are written; deeper levels skipped |
| T4 | Engine runs twice for one sale | Second run is no-op |
| T5 | Approved sale is voided | Equal reversal rows offset original impact |
| T6 | Plan changes after old sale | Old ledger remains unchanged, new sales use new plan |
| T7 | Delivery maturation | Approved rows remain pending until delivery/scheduler |
| T8 | Fairness at different tree depths | Equivalent local networks earn equivalent totals |
| T9 | Rounding | Each level floors; total never exceeds pool |
| T10 | Parallel approval | Unique constraints and locks produce one ledger set |

## 12. Product Phases

Phase A: design system, English runtime, brand foundation, shadcn migration.

Phase B: admin operations: dashboard, sales, members, payouts, audit, reports.

Phase C: member experience: wallet, team, invite funnel, network, account, gamification.

Phase D: platform and SaaS readiness: tenant onboarding, billing, limits, developer tools, advanced security.

## 13. Completion Bar

The system is considered production-ready only when a real tenant can:

1. Configure brand and commission rules.
2. Invite members.
3. Record and approve a sale.
4. Produce correct ledger rows.
5. Let members view earnings without leaking private downstream sales.
6. Process a payout with audit evidence.
7. Void a sale and see balances correct safely.
8. Restore from backup in a tested drill.