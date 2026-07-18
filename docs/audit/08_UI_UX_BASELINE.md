# UI/UX Baseline

## Role-Based Experiences

- Public user: invite resolution, registration, login, email verification, password reset.
- Member: dashboard, wallet, payout request, team aggregate, invite creation/list.
- Tenant staff/admin/owner: dashboard, sales, members, tree, payouts, audit, settings, RBAC.
- Platform admin: tenant list/detail/network and suspend/reactivate.

## Strengths

- Product IA matches the domain: member, admin, and platform surfaces are separate.
- Admin workflows expose the right operational objects: sales, payouts, people, roles, settings, audit.
- Member UI stays appropriately aggregate-limited.
- Login routes correctly after fresh login using `landingForSession`.
- Theme and motion basics are well considered.

## Main UX Findings

| ID | Severity | Finding |
| --- | --- | --- |
| AUD-H02 | High | Existing web sessions on `/` always route to `/admin`; member and platform sessions should land in their own surfaces. |
| AUD-H03 | High | Admin mobile navigation disappears under 720px, leaving no replacement nav/logout/theme path. |
| AUD-M02 | Medium | Some high-risk money actions bypass confirmation despite a design rule that money actions require confirmation. |
| AUD-M10 | Medium | Audit log is raw JSON-heavy and weak for real investigations. |
| AUD-M11 | Medium | Mobile app lacks account/security/notification settings and 2FA management after login. |

## UX Priorities

1. Fix role-aware root landing.
2. Add responsive admin navigation.
3. Normalize confirmations for all money/state transitions.
4. Improve audit log readability.
5. Add mobile account/security/settings surface before production mobile rollout.
