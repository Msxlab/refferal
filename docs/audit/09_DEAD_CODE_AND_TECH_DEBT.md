# Dead Code And Technical Debt

## Unused Or Underused Structures

| Area | Observation | Recommendation |
| --- | --- | --- |
| `team_stats` / `TeamStat` | Schema has materialized team stats, but member team currently computes live via ltree. | Either implement scheduled materialization or remove from active roadmap/docs until needed. |
| Redis | Present in deployment/compose context, but not used for throttling or distributed locks. | Wire Redis where horizontal behavior matters before multi-instance production. |
| Mobile notification preferences | API supports preferences; mobile has push registration but no settings UI. | Add a member settings screen when mobile notification rollout is prioritized. |
| Audit report data | API returns raw before/after JSON; UI displays raw JSON. | Add actor joins, entity labels, structured diffs, and export. |

## Scaling Debt

- CSV import resolves sellers and external references row-by-row.
- Admin/platform tree/network endpoints return broad structures and need depth/search/lazy-loading behavior before very large tenants.
- Metrics are basic and not tied to business-critical lag/error signals.
- In-memory throttling is not multi-instance safe.

## Product-Readiness Debt

- No payout profile, payment-rail integration, KYC/TIN/1099 workflow, billing/subscription model, API keys, or webhooks were found in the current schema/API.
- Invite lifecycle lacks revoke/open tracking.
- Notification currency formatting is fixed to USD.

## Documentation Debt

The `AI/` memory and `docs/` files are valuable and mostly aligned with the current code, but older audit findings should be periodically marked as fixed, superseded, or still open so future agents do not re-open already-resolved P0 items.
