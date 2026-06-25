# Flow Audit: Tenant Admin Operations

## Flow

1. Auth guard resolves actor membership and permissions.
2. Admin navigates dashboard/sales/members/tree/payouts/audit/settings.
3. Controllers enforce role and permission requirements.
4. Services perform tenant-scoped reads/writes.
5. Sensitive changes are audited.

## Strengths

- Permission model is meaningful and backend-enforced.
- Admin information architecture matches operator jobs.
- Settings and RBAC are integrated into admin.

## Breakpoints

- No DB RLS means service filters are the last tenant boundary.
- Admin mobile navigation disappears.
- Audit view is weak for incident response.
- Tree/network views need scale strategy.

## Linked Findings

- AUD-H01
- AUD-H03
- AUD-M06
- AUD-M10
