# Module Audit: Payouts And Wallet

## Scope

Files reviewed include `apps/api/src/payouts/*`, `apps/api/src/wallet/*`, `EngineService.payoutMember`, admin payout UI, member wallet UI, and payout-related schema.

## What Works Well

- Payable listing is separated from payout history.
- Member payout request queue exists.
- Email verification is required before member payout request.
- Payout run handles each member independently so one failure does not block all.
- Payout CSV export uses formula-injection protection.
- Negative reversal rows are netted into payout calculations.
- Payout mutation, ledger updates, summaries, notifications, and audit are transaction-bound.

## Findings

| ID | Severity | Finding |
| --- | --- | --- |
| AUD-M02 | Medium | Payout request approve/reject buttons execute directly without confirmation. |
| AUD-M04 | Medium | Payout `period` may imply period filtering, but engine pays all payable rows for the member. |
| AUD-H04 | High | No payment profile, payout rail, KYC/TIN, tax, or 1099 workflow was found. |

## Recommendations

- Confirm all payout approval/rejection/run actions.
- Decide whether payouts are "all payable balance" or "period-specific".
- Rename UI/export fields if period is only a run label.
- Add payout profile and compliance epic before real-money production operations.

## Residual Questions

- Should members be allowed to request partial payout amounts?
- Should admins be able to exclude selected payable rows from a payout run?
- What payment rail is intended: manual, ACH, Stripe, Wise, bank export, or another provider?
