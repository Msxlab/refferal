# Knowledge Registry

**Last reconciled:** 2026-07-22

This registry identifies each document's role. A status does not erase an older
file; it tells a reader how to interpret it and what must be reconciled before
acting on it.

| Source | Purpose | Status | Use in a conflict | Next action |
| --- | --- | --- | --- | --- |
| [AGENTS.md](../../AGENTS.md) | Mandatory repository-entry and safety instructions | canonical | Governs session workflow | Keep aligned with START-HERE and active handoff |
| [START-HERE.md](START-HERE.md) | Vault orientation and decision-recording protocol | canonical | Directs the required reading sequence; never replaces the handoff | Keep concise and link-oriented |
| [CONTINUE-HERE.md](../../CONTINUE-HERE.md) | Active branch, release state, blockers, safety and validation commands | canonical | Governs active release work and deployment claims | Update after material branch/release changes |
| [CURRENT-STATE.md](CURRENT-STATE.md) | Short navigational current-state index | active | Follow its links; do not treat its summary as detailed proof | Refresh only after the detailed source changes |
| [verification/current-release.md](verification/current-release.md) | Dated verification and deployment evidence | canonical | Determines whether a pass/live claim is supported | Append fresh evidence; mark stale evidence honestly |
| [risks-and-open-items.md](risks-and-open-items.md) | Actionable blockers, risks and decisions needed | active | Separates release blockers from future roadmap items | Update owner/dependency and next action |
| [docs/DECISIONS.md](../DECISIONS.md) | Existing durable product/technical decisions | canonical | Remains authoritative until a newer ADR explicitly supersedes an item | Import/link decisions incrementally; do not mass-rewrite |
| `docs/knowledge/decisions/` (Task 3) | New ADRs and decision protocol | active | Records material decisions made after vault adoption | Add ADR before implementation changes |
| [docs/DESIGN.md](../DESIGN.md) | Runtime design-system rules | active | Use alongside accepted design ADR/spec and actual UI code | Link visual decisions without treating it as QA evidence |
| [docs/DESIGN-VISION.md](../DESIGN-VISION.md) | Product design direction and longer-term design debt | active | Strategic direction only | Reconcile with accepted visual decisions as needed |
| [2026-07-20 referral hierarchy spec](../superpowers/specs/2026-07-20-referral-network-hierarchy-design.md) | Admin/member tree product and privacy design | needs-reconciliation | Its privacy/design choices are useful; implementation-status header is stale against the handoff | Record the conflict in risks; do not reopen completed work solely from the old header |
| [2026-07-20 referral hierarchy plan](../superpowers/plans/2026-07-20-referral-network-hierarchy-implementation.md) | Original hierarchy implementation plan | historical | Consult for intent only; active handoff/verification decide completion | Link the delivered work from the relevant ADR |
| [2026-07-20 referral value-flow plan](../superpowers/plans/2026-07-20-earnica-referral-value-flow.md) | Approved admin value-flow visual direction and plan | active | Design direction does not prove current UI implementation or QA | Map in visual references and decision records |
| [Project Knowledge Vault design](../superpowers/specs/2026-07-22-project-knowledge-vault-design.md) | Accepted vault architecture | canonical | Defines this vault's structure and authority boundaries | Implement through its approved plan |
| [Project Knowledge Vault plan](../superpowers/plans/2026-07-22-project-knowledge-vault-implementation.md) | Approved task-by-task vault migration | active | Defines the current documentation work sequence | Update completed task checkboxes and evidence only |
| [Payout authority matrix](../superpowers/plans/evidence/earnica-p0-authority-matrix.json) | Earlier payout authority evidence | needs-reconciliation | Does not yet cover the dispatch checkpoint | Reconcile `processing → dispatched → settled` with the handoff before relying on it |
| [BUILD-PLAN.md](../BUILD-PLAN.md) | Earlier broad product/build plan | needs-reconciliation | KYC/OFAC scope differs from active fraud/KYC/sanctions controls | Preserve history; record a reconciliation decision |
| [README.md](../../README.md) and [audit memory](../audit/00_AUDIT_MEMORY.md) | Repository/audit orientation | needs-reconciliation | References a missing `AI/` directory | Restore an explicit source or correct the historical reference deliberately |
| [docs/audit/](../audit/) | Prior audit evidence and backlog | historical | Context, not current release proof | Preserve and link only relevant unresolved findings |
| [tasks/plan.md](../../tasks/plan.md), [tasks/todo.md](../../tasks/todo.md) | Earlier P0 ledger | historical | Not the vault task ledger | Preserve unchanged; vault plan is under `docs/superpowers/plans/` |

## Reconciliation protocol

When sources conflict, first identify the question:

- **Safety/workflow:** `AGENTS.md` and active `CONTINUE-HERE.md`.
- **Target product/design behavior:** current explicit user decision and accepted
  ADR/spec.
- **What the system currently does:** runtime code and fresh test/deploy evidence.
- **Historical context:** plans, audits and old previews.

Record the difference in [risks-and-open-items.md](risks-and-open-items.md), link
the affected sources, and create/update an ADR when the resolution changes a
material decision. Do not silently rewrite an old document to hide the drift.
