# Module Audit: RBAC And Permissions

## Scope

Files reviewed include `apps/api/src/rbac/*`, `apps/api/src/auth/auth.guard.ts`, admin settings people/roles UI, member admin controllers, sales/payout/settings/report controllers, and platform controllers.

## What Works Well

- Backend does not rely only on client UI gating.
- Permission catalog and custom roles exist.
- System role semantics remain available.
- Guard rehydrates current membership, role, permissions, tenant, and status from the database.
- Self-role-change and role downgrade edge cases are handled.
- Controllers apply role and permission decorators around sensitive surfaces.

## Findings

| ID | Severity | Finding |
| --- | --- | --- |
| AUD-H01 | High | RBAC is strong at application layer, but tenant isolation has no database RLS backstop. |
| AUD-M10 | Medium | Audit UI does not yet make permission or actor changes easy to investigate. |

## Recommendations

- Keep backend permission enforcement as the source of truth.
- Add cross-tenant tests around every admin/platform controller and raw SQL report.
- Enrich audit logs with actor display data and role/permission diff formatting.
- Consider explicit break-glass/platform support audit events.

## Residual Questions

- Should custom role creation be restricted to tenant owner only, or is tenant admin sufficient?
- Should permission grants have scope limits by feature bundle or subscription tier?
