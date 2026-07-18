# Fix Priority Roadmap

## P0 Before Production Exposure

1. AUD-H01: add a database-level tenant isolation plan.
   - At minimum: RLS design doc, critical-table policies, and cross-tenant tests.
   - If RLS is deferred: create explicit risk acceptance and add service-level guard tests around every raw SQL path.

2. AUD-H02: fix root role-aware landing.
   - Member should land on `/app`.
   - Tenant roles should land on `/admin`.
   - Platform admin should land on `/platform`.

3. AUD-H03: restore admin navigation on mobile.
   - Add mobile admin nav/drawer/topbar.
   - Preserve logout, theme, and current route affordances.

4. AUD-M02: require confirmations for all money-affecting actions.
   - Sale detail: approve, void, deliver.
   - Payout requests: approve, reject.
   - Keep copy consistent with design rules.

## P1 Production Hardening

5. AUD-M01: harden token storage.
   - Web: HttpOnly refresh cookie.
   - Mobile: SecureStore/Keychain.
   - Re-check CSRF/CORS/CSP after cookie migration.

6. AUD-M03: harden settings validation.
   - IANA timezone validation.
   - Rule-aware maturation fields.
   - Regression tests for invalid config.

7. AUD-M04: decide payout period semantics.
   - Either rename UX to "all payable balance" or implement period-specific payout filtering.
   - Update export copy and request copy accordingly.

8. AUD-M07: make ops primitives horizontal-safe.
   - Redis-backed throttler.
   - Distributed/advisory locks for scheduled jobs.
   - Metrics for maturity lag, relay backlog, failed payouts, auth reuse events.

9. AUD-H04: define compliance/billing launch scope.
   - Payout profile, tax, billing, API/webhook scope should be explicit before real-money rollout.

## P2 Scale And Operator Quality

10. AUD-M05 and AUD-M06: scale import and network views.
    - Batch import lookups.
    - Lazy tree endpoints.
    - Materialized team stats job.

11. AUD-M08 and AUD-M09: refine notifications and invite lifecycle.
    - Tenant currency in notifications.
    - Invite revoke/opened tracking.
    - Optional inviter-name privacy control.

12. AUD-M10 and AUD-M11: improve investigation and mobile account surfaces.
    - Human audit diff, actor labels, exports.
    - Mobile account/security/notification settings.

## P3 Opportunistic Cleanup

13. AUD-L01: migrate Prisma config when package/config work is allowed.

14. Keep `AI/audits` status labels fresh:
    - fixed,
    - superseded,
    - still-open,
    - accepted risk.
