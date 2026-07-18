# High Findings

| ID | Area | Summary | Next Step |
| --- | --- | --- | --- |
| AUD-H01 | Security / tenancy | No database-level RLS boundary for tenant-owned data. | Design and implement RLS or explicit risk acceptance plus expanded tests. |
| AUD-H02 | Web routing | Root route sends every session to `/admin`. | Use role-aware landing helper. |
| AUD-H03 | Admin UX | Admin mobile nav disappears below 720px. | Add responsive admin navigation. |
| AUD-H04 | Product readiness | Payout profile, tax/KYC, billing, API key, webhook models absent. | Define launch scope and implementation epics. |

High findings are the recommended starting point before any production exposure.
