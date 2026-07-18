# Module Audit: Invites And Memberships

## Scope

Files reviewed include `apps/api/src/invites/*`, `apps/api/src/memberships/*`, `apps/api/src/members/*`, member/admin invite UIs, and membership/invite schema.

## What Works Well

- Invites are tenant-scoped and tied to an inviter membership.
- Invite creation checks inviter and tenant active state.
- Active/pending invite caps are enforced.
- Public resolve validates invite, tenant, inviter, and expiration state.
- Member and admin membership status workflows exist.
- Member-facing team view is aggregate-limited.

## Findings

| ID | Severity | Finding |
| --- | --- | --- |
| AUD-M09 | Medium | Invite revoke/opened funnel tracking is absent. |
| AUD-M09 | Medium | Public invite resolve returns `inviterName`; privacy acceptability should be explicit. |
| AUD-M06 | Medium | Tree/team surfaces may need materialized stats and lazy loading at scale. |

## Recommendations

- Add invite revoke endpoint/UI.
- Add `openedAt`, maybe `lastOpenedAt`, and registration conversion metrics.
- Add tenant setting or product decision for public inviter display.
- Implement tree depth/search/lazy loading for admin/platform views.

## Residual Questions

- Should invite links be single-use only, or reusable until expiry/cap?
- Should an invite email lock prevent registration with a different email in all cases?
