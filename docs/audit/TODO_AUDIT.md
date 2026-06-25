# Audit TODO

## P0

- [ ] AUD-H01: design PostgreSQL RLS/tenant-context strategy for tenant tables.
- [ ] AUD-H01: add cross-tenant read/write regression tests for raw SQL and Prisma paths.
- [ ] AUD-H02: replace root `/` redirect with role-aware landing.
- [ ] AUD-H03: add responsive admin navigation below 720px.
- [ ] AUD-M02: wrap sale drawer approve/void/deliver in confirmation.
- [ ] AUD-M02: wrap payout request approve/reject in confirmation.

## P1

- [ ] AUD-M01: migrate web refresh token away from `localStorage`.
- [ ] AUD-M01: migrate mobile refresh/session storage away from `AsyncStorage`.
- [ ] AUD-M03: validate timezone against IANA names.
- [ ] AUD-M03: enforce `maturationDays` only/required for `days_after_approval`.
- [ ] AUD-M04: decide and document payout period semantics.
- [ ] AUD-M07: use Redis-backed throttling for multi-instance deployment.
- [ ] AUD-M07: add distributed/advisory locks for scheduled jobs.
- [ ] AUD-H04: define payout profile, tax, billing, API key, and webhook launch scope.

## P2

- [ ] AUD-M05: batch CSV import seller and external-ref lookups.
- [ ] AUD-M06: implement or retire `team_stats`.
- [ ] AUD-M06: add lazy depth/search endpoints for admin/platform trees.
- [ ] AUD-M08: format notification money with tenant currency.
- [ ] AUD-M09: add invite revoke and opened tracking.
- [ ] AUD-M09: decide whether inviter name should be public.
- [ ] AUD-M10: enrich audit UI with actor labels and human diffs.
- [ ] AUD-M11: add mobile account/security/notification settings.

## P3

- [ ] AUD-L01: move Prisma config out of `package.json#prisma` when dependency/config edits are in scope.
- [ ] Mark old `AI/audits` findings as fixed, superseded, open, or accepted risk.
