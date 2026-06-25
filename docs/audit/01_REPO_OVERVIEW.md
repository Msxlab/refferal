# Repository Overview

## Product

Refearn is a multi-tenant referral commission platform for invite-only member networks. The core product promise is:

- members sell and invite,
- sales generate deterministic multi-level commissions,
- admins operate approvals, payouts, roles, settings, plans, and audit logs,
- platform admins supervise tenants.

The business model is explicitly not recruitment-based. Commission rights are tied to sales, not member recruitment.

## Architecture

- `apps/api`: NestJS API, Prisma, PostgreSQL, scheduled jobs, notification relay, RBAC, commission engine.
- `apps/web`: Next.js 15 web app for login, invite registration, member portal, tenant admin console, and platform console.
- `apps/mobile`: Expo React Native member app.
- `packages/shared`: deterministic money and commission-plan helpers shared by API and tests.
- `docs` and `AI`: product specifications, design rules, operating decisions, test notes, prior audits.

## Core Invariants

- Money is stored and computed as integer cents.
- Commission rates are basis points.
- Default plan is seller 500 bps, then uplines 200, 150, 100, 50 bps.
- Ledger rows are append-oriented and protected by database triggers.
- Sales approval, commission creation, summaries, notifications, and audit entries are transaction-bound in the engine.
- Member-facing downline data is aggregate-limited; admin/platform screens can inspect broader trees.

## Runtime

- API global prefix is `/v1`, with `/healthz` and `/metrics` excluded.
- Caddy/reverse proxy is assumed in deployment docs.
- PostgreSQL and Redis exist in compose, but Redis is not yet used for rate-limit storage or distributed locks.
- Notification outbox supports SMTP/Resend email and Expo push.

## Current Health

The codebase is significantly beyond a prototype:

- strong typecheck posture across shared/API/web/mobile,
- mature shared commission tests,
- meaningful integration tests in `apps/api/test`,
- backend guards and RBAC enforcement,
- audit and ledger integrity primitives.

The main open question is production readiness, not whether the MVP can function.
