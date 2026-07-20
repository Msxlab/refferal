# Subagent-Driven Development Progress

## Earnica referral value flow

| Task | Status | Owner | Verification | Notes |
| --- | --- | --- | --- | --- |
| 1. Restore and align admin shell | completed | map_value_flow_ui + root | 6 focused node tests + typecheck | Restored lost desktop selectors; added Obsidian token island, accessible cobalt-on-ink, 44 px targets, and Value flow naming. |
| 2. Typed value-flow read model | completed | root + map_value_flow_api | 9 model node tests + typecheck | Bigint-safe; reviewer confirmed truthful period boundaries and explicit partial-tree scope. |
| 3. Data loading and URL state | completed | root + backend_final_review | loader/model contracts + typecheck | Independent requests publish authoritative core first; optional evidence is capability-aware and detail remains lazy. |
| 4. Tree canvas and evidence dock | completed | root | production browser interaction QA + build | React Flow is dynamically imported; native nodes, evidence tabs, table drill-down, and URL state work. |
| 5. Attention and responsive polish | completed | root + responsive_final_review | desktop browser QA + responsive contracts | Truthful partial coverage, 44px targets, reduced motion, table fallback, and bottom-sheet inspector are implemented. |
| 6. Web CI tests and design QA | completed | root | 296 web tests + typecheck + production build + browser matrix | `design-qa.md` records the final reference comparison and evidence. |
| 7. Independent final review | completed | api_final_audit + web_audit + final_diff_review | reviewer findings resolved | Financial processing, RBAC, bulk-action, payout, snapshot consistency, signed-rate, search truth, and disabled-control accessibility findings were fixed and regression-tested. |

### Baseline evidence

- Branch created: `codex/earnica-referral-value-flow`
- `apps/web/src/app/admin/layout.contract.node.test.ts`: 3 passed, 2 failed before implementation.
- Root cause: merge commit `24c38f3` retained the premium admin layout and its contract test but dropped the desktop `.admin-shell` / `.admin-rail` style block that exists in working commit `cdfdca6`.
- No production application files changed before this plan/progress record.

## Referral network hierarchy

| Task | Status | Owner | Verification | Notes |
| --- | --- | --- | --- | --- |
| 1. Security, permission, and route foundation | completed | hierarchy_task1_impl + web_tree_plan | 20 focused API unit tests + API typecheck; RBAC integration attempted but local Prisma schema engine blocked migration | Commits `d8c708f`, `9901929`, `e8253db`; independent review approved after fixes. |
| 2. Server-authoritative hierarchy reads | in progress | hierarchy_task2a_impl + root | 20 focused contract/token tests + API typechecks | Subtask 2A completed in `88bc3e7` and `eeca319`, independently reviewed clean; service/controller/migration integration remains. |
| 3. Member privacy projection | pending | unassigned | pending | Server-only Tier 1–3 projection, opaque refs, and privacy regression tests. |
| 4. Shared web hierarchy primitives | pending | unassigned | pending | URL surface separation, accessible tree/list primitives, defensive formatting. |
| 5. Admin Focus Cockpit and HQ | pending | unassigned | pending | Admin default hierarchy and shared HQ route. |
| 6. Member web and Expo outline | pending | unassigned | pending | Privacy-safe web and native rendering. |
| 7. Whole-branch verification and review | pending | unassigned | pending | Tests, browser/a11y/privacy checks, final review, push. |
