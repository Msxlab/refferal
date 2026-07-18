# Flow Audit: Sale Approval And Commission

## Flow

1. Admin creates or imports sale.
2. Sale starts as draft or approved.
3. Approval locks the sale.
4. Plan is resolved by sale date.
5. Upline chain is built from seller.
6. Shared commission helper computes lines.
7. Ledger entries, summaries, notifications, and audit records are written in one transaction.
8. Maturity rule controls payable timing.

## Strengths

- Deterministic shared math.
- Idempotent application.
- Transactional financial side effects.
- Summary month freeze.
- Void/reversal model is accounting-friendly.

## Breakpoints

- Some detail actions lack confirmation.
- Invalid maturation settings can create surprising immediate maturity.
- CSV import may degrade on large files due row-by-row lookups.

## Linked Findings

- AUD-M02
- AUD-M03
- AUD-M05
