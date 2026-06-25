# Module Audit: Data Model

## Scope

Files reviewed include `apps/api/prisma/schema.prisma`, migrations, seed, and data access patterns across services.

## What Works Well

- Tenant, user, membership, invite, sale, ledger, summary, payout, notification, role, token, and audit models cover the MVP domain.
- Ledger immutability triggers are present.
- Plan constraints and external-ref uniqueness are migration-backed.
- ltree-compatible membership paths support descendant queries.
- Refresh/user tokens are modeled separately.
- Audit logs have before/after JSON.

## Findings

| ID | Severity | Finding |
| --- | --- | --- |
| AUD-H01 | High | No RLS policies were found for tenant-owned data. |
| AUD-H04 | High | Compliance/billing/payment profile data models are not present. |
| AUD-M06 | Medium | `team_stats` exists but is not populated by a job. |
| AUD-M09 | Medium | Invite model lacks opened/revoked workflow metadata beyond status/expiry. |

## Recommendations

- Add RLS strategy for tenant tables.
- Decide production data needs for payouts, tax, billing, API keys, and webhooks.
- Either implement `team_stats` materialization or remove it from active assumptions.
- Add invite lifecycle fields if funnel tracking matters.

## Residual Questions

- Should tenant currency be immutable after first sale?
- Should audit logs be partitioned or archived for long-lived tenants?
