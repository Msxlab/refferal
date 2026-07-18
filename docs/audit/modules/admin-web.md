# Module Audit: Admin Web

## Scope

Files reviewed include `apps/web/src/app/admin/*`, admin settings sections, sales/payout/members/audit pages, layout, global styles, and shared UI components.

## What Works Well

- Admin IA matches operator tasks: dashboard, sales, members, tree, payouts, audit, settings.
- The UI has reusable loading, modal, confirm, toast, field, and money components.
- Settings are broken into manageable sections.
- Sales import workflow includes preview/mapping-like behavior.
- RBAC UI exists for people/roles.

## Findings

| ID | Severity | Finding |
| --- | --- | --- |
| AUD-H03 | High | Admin navigation is hidden on mobile and no alternate nav is provided. |
| AUD-M02 | Medium | Detail-level sale and payout request actions miss confirmation. |
| AUD-M10 | Medium | Audit page is raw JSON-first and lacks actor/entity enrichment. |

## Recommendations

- Add mobile admin nav/drawer/topbar at the same breakpoint where `.side` is hidden.
- Use `Confirm` consistently for money and irreversible state changes.
- Improve audit readability: actor display, entity label, before/after field diffs, filters, export.
- Keep UI fixes scoped; avoid broad visual redesign while closing these functional UX gaps.

## Residual Questions

- Should admin be fully supported on mobile, or should mobile show a limited operator mode?
- Should destructive actions require typed confirmation above a threshold?
