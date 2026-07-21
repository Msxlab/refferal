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
| 1. Security, permission, and route foundation | completed | hierarchy_task1_impl + web_tree_plan | API authorization units and API build typecheck | `network.financials.view` is explicit, finance routes require it, and route/capability checks were independently reviewed. Commits `d8c708f`, `9901929`, `e8253db`, `514842e`. |
| 2. Server-authoritative hierarchy reads | completed | hierarchy_task2a_impl + hierarchy_task2b_impl + root | Focused API contracts, both API typechecks, Prisma validate/generate, independent re-review | HMAC contracts, bounded 250-node BFS, signed cursor/snapshot semantics, migration preflights, log redaction, and capability gates landed in `88bc3e7` through `03be3e7`. |
| 3. Member privacy projection | completed | hierarchy_task2b_impl + root | API unit suite: 31 suites / 163 tests; API build typecheck | Server-only Tier 1-3 projection, opaque viewer-bound refs, direct-only body search, exact visible-tier clusters, and Tier 4 mutation regression landed in `ee6cde4` and `c7b9de0`. Database integration was attempted but local PostgreSQL on `localhost:5434` was unavailable. |
| 4. Shared web hierarchy primitives | completed | web_hierarchy_primitives + web_tree_plan | Web node suite and web typecheck; independent re-review | URL surface separation, branded anonymous references, fail-closed financial projection, accessible tree/list/inspector primitives, and truthful admin aggregate labels landed in `a2e1d2a`, `32d7f01`, and `9ea72f4`. |
| 5. Admin Focus Cockpit and HQ | completed | web_hierarchy_primitives + hierarchy_task2b_impl | Focused URL/contract checks, web typecheck, independent review | Admin defaults to hierarchy, isolates Value Flow behind finance capability, retains selected/focused context, and keeps internal HQ actions in the active company route. Commits `3c49cc3`, `19b8c2f`, `f66cafd`. |
| 6. Member web and Expo outline | completed | member_tree_ui + root | Web and mobile typechecks; direct-search contracts; independent privacy review | Member tree shows sponsor, self, named Tier 1, anonymous Tier 2-3 only; mobile outline matches it. People/Performance lenses, exact `+N` clusters, and query/snapshot-safe pagination landed in `6e2612f`, `07f9429`, `3f28074`. |
| 7. Whole-branch verification and review | completed | root + independent reviewers | Fresh API 31/163, web 335/335 + production build, mobile 7/7 + typecheck, browser route smoke, clean diff check | Two independent release reviews approved privacy, HQ routing, cluster wording, and search snapshot behavior. Fresh production server routed `/app/team` and `/admin/tree` to the expected authentication boundary; no local authenticated fixture was available for data-filled visual smoke testing. |
