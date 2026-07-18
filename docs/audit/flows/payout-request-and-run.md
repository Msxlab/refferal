# Flow Audit: Payout Request And Run

## Flow

1. Member requests payout for current tenant period.
2. Admin views payable members and requested payouts.
3. Admin approves request or runs payout.
4. Engine locks all payable rows for member.
5. Engine nets positive commissions and negative reversals.
6. If net is above minimum, payout is recorded and ledger rows become paid.
7. Summaries, notification, and audit are written.

## Strengths

- Good atomicity.
- Reversals are netted.
- Minimum payout guard exists.
- Request queue and admin run are separated.

## Breakpoints

- Period semantics are ambiguous.
- Request approve/reject lacks confirmation.
- Payment profile/compliance data is absent for real-world payout operations.

## Linked Findings

- AUD-M02
- AUD-M04
- AUD-H04
