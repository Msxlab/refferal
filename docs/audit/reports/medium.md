# Medium Findings

| ID | Area | Summary |
| --- | --- | --- |
| AUD-M01 | Client security | Tokens stored in web `localStorage` and mobile `AsyncStorage`. |
| AUD-M02 | Money UX | Some state-changing money actions skip confirmation. |
| AUD-M03 | Settings logic | Timezone/maturation validation is too loose. |
| AUD-M04 | Payout semantics | Payout period label does not filter payable ledger rows. |
| AUD-M05 | Import performance | CSV import uses row-by-row lookups. |
| AUD-M06 | Tree performance | `team_stats` unused; tree/network views are live/full-load. |
| AUD-M07 | Ops / scale | In-memory rate limiting and in-process scheduled jobs. |
| AUD-M08 | Notifications | Money notifications hardcode USD. |
| AUD-M09 | Invites | Revoke/opened funnel missing; inviter-name privacy undecided. |
| AUD-M10 | Audit UX | Raw JSON audit UI lacks actor/human diff. |
| AUD-M11 | Mobile UX/security | Mobile lacks account/security/notification settings. |

Medium findings are not all equal. Recommended order: AUD-M02, AUD-M01, AUD-M03, AUD-M04, AUD-M07, then scale/operator improvements.
