# Subagent-Driven Development Progress

## Earnica referral value flow

| Task | Status | Owner | Verification | Notes |
| --- | --- | --- | --- | --- |
| 1. Restore and align admin shell | pending | unassigned | focused node test + typecheck | Existing merge lost desktop shell selectors; preserve structure but use approved cobalt tokens. |
| 2. Typed value-flow read model | pending | unassigned | model node tests + typecheck | All money math must remain bigint/string-safe. |
| 3. Data loading and URL state | pending | unassigned | contract test + typecheck | Initial independent requests run concurrently; detail is lazy. |
| 4. Tree canvas and evidence dock | pending | unassigned | interaction QA + build | React Flow is dynamically imported. |
| 5. Attention and responsive polish | pending | unassigned | desktop/tablet/mobile browser QA | Native controls and reduced motion required. |
| 6. Web CI tests and design QA | pending | unassigned | full test/lint/build/browser matrix | `design-qa.md` must end with the exact pass line. |
| 7. Independent final review | pending | unassigned | reviewer findings resolved | No final claim before fresh verification. |

### Baseline evidence

- Branch created: `codex/earnica-referral-value-flow`
- `apps/web/src/app/admin/layout.contract.node.test.ts`: 3 passed, 2 failed before implementation.
- Root cause: merge commit `24c38f3` retained the premium admin layout and its contract test but dropped the desktop `.admin-shell` / `.admin-rail` style block that exists in working commit `cdfdca6`.
- No production application files changed before this plan/progress record.
