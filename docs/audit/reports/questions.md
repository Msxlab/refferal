# Open Questions

## Product

- Is first production launch expected to process real-money payouts, or only admin-recorded/manual payouts?
- Which payout rail is intended?
- Are payout periods supposed to pay all payable balance or only rows from a selected month?
- Should public invite pages reveal inviter name?
- Is the mobile app intended to remain member-only?

## Security And Ops

- Will production run one API instance or multiple?
- Is PostgreSQL RLS acceptable for the stack, or should an alternative tenant isolation strategy be documented?
- Should MFA be mandatory for tenant owners and platform admins?
- What CSP policy is required before storing less-sensitive data in browser contexts?

## UX

- Should admin be fully functional on mobile, or should mobile admin show a limited operator surface?
- Should money actions over a configured threshold require stronger confirmation?
- What audit export format is required by operators?

## Data

- Should tenant currency be immutable after the first sale?
- Should audit logs be retained forever, archived, or partitioned by date?
- Should `team_stats` become source-of-truth for dashboards at scale?
