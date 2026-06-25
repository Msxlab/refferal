# Module Audit: Sales And Commission Engine

## Scope

Files reviewed include `apps/api/src/sales/*`, `apps/api/src/engine/*`, `packages/shared/src/*`, shared tests, sales UI, and related Prisma models/migrations.

## What Works Well

- Money math is integer cents and shared pure helpers are tested.
- Sales use Zod validation.
- `externalRef` idempotency is implemented and backed by a partial unique migration.
- Engine locks sales and ledger rows with explicit transactions.
- Commission application is idempotent per sale.
- Plan selection is date-effective.
- Summary month is frozen on first application.
- Void reversal accounting handles paid and unpaid states differently.
- Maturity cron uses `FOR UPDATE SKIP LOCKED`.
- Deadlock/serialization retry exists.

## Findings

| ID | Severity | Finding |
| --- | --- | --- |
| AUD-M02 | Medium | Sale drawer approve/void/deliver actions call APIs directly without confirmation. |
| AUD-M03 | Medium | `days_after_approval` with null days matures after 0 days; timezone accepts arbitrary strings. |
| AUD-M05 | Medium | CSV import performs seller and duplicate lookups row-by-row. |

## Recommendations

- Route all sale state transitions through the shared `Confirm` component.
- Enforce settings invariants before the engine can see invalid maturation configuration.
- Batch import lookups by referral code and external reference.
- Add explicit tests for settings combinations that influence engine maturity.

## Residual Questions

- Should bulk import support all-or-nothing mode in addition to partial success?
- Should delivery marking require confirmation when it releases commissions under `on_delivery`?
