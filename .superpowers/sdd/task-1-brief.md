## Task 1: Reconcile the shared base and establish contract tests

**Files:**

- Modify: `apps/api/src/common/permissions.ts`
- Create: `apps/api/src/members/members.network.contract.spec.ts`
- Create: `apps/api/src/wallet/wallet.team-tree.contract.spec.ts`

1. Merge `origin/main` with a normal merge commit while the worktree is clean; do not reset or drop current branch commits.
2. Add `network.financials.view` beside `network.view`; seed it for owner/admin and omit it from view-only/staff permissions unless explicitly assigned.
3. Write source/contract tests first asserting the capability split, the legacy financial route guards, and the future hierarchy query caps/privacy field constraints. The static hierarchy route placement is implemented together with its service in Task 2.
