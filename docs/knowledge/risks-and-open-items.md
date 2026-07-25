# Risks and Open Items

**Last reconciled:** 2026-07-22

Items below are separated by operational urgency. Roadmap risks are not active
release blockers unless the active handoff explicitly promotes them.

## Active release blockers

| ID | Area | Severity | Status / dependency | Next verifiable action | Sources |
| --- | --- | --- | --- | --- | --- |
| REL-001 | Payout dispatch lifecycle | High | `start → dispatch → settle` integration paths and required regressions are incomplete | Use a disposable/local test database; adapt focused suites and run them serially | [CONTINUE-HERE.md](../../CONTINUE-HERE.md), [verification](verification/current-release.md) |
| REL-002 | Local integration environment | High | Prisma generate/migrate deploy has not been run against a confirmed disposable test database after the dispatch schema work | Configure secure local test values; generate and migrate only the test database | [CONTINUE-HERE.md](../../CONTINUE-HERE.md) |
| REL-003 | Production deployment | High | SSH public-key authentication to `server.oppeinnj.com` was rejected; valid owner access is required | Owner supplies valid access; independently verify deployment after green test matrix | [CONTINUE-HERE.md](../../CONTINUE-HERE.md), [verification](verification/current-release.md) |
| REL-004 | PR/release gate | High | Full integration groups and final review are not complete | Run serial test matrix, inspect diff, wait for green PR checks before merge | [CONTINUE-HERE.md](../../CONTINUE-HERE.md) |

## Documentation reconciliation work

| ID | Area | Severity | Status / dependency | Next verifiable action | Sources |
| --- | --- | --- | --- | --- | --- |
| DOC-001 | Hierarchy implementation status | Medium | Hierarchy spec says implementation/review pending while active handoff records delivered work | Add a linked ADR/registry resolution; never infer a rerun is required from the stale header alone | [registry](registry.md), hierarchy spec, active handoff |
| DOC-002 | Payout authority evidence | High | Earlier authority matrix omits the current `dispatched` checkpoint | Reconcile the matrix or supersede it with an ADR after lifecycle tests establish final evidence | [registry](registry.md), active handoff |
| DOC-003 | KYC/OFAC scope | Medium | Old build plan differs from active fraud/KYC/sanctions release controls | Record scope decision with sources and current implementation/test status | [registry](registry.md), active handoff |
| DOC-004 | Missing `AI/` references | Low | README/audit refer to a directory not present in this clone | Decide whether to restore, relink or mark the reference historical | [registry](registry.md) |

## Product and operations roadmap risks

| ID | Area | Severity | Status / dependency | Next verifiable action | Sources |
| --- | --- | --- | --- | --- | --- |
| ROAD-001 | MFA onboarding and recovery | High | Known product hardening item; not an active dispatch release gate | Create a scoped ADR/spec before implementation | [docs/DECISIONS.md](../DECISIONS.md) |
| ROAD-002 | Request-time session/permission freshness | High | Existing token design has accepted freshness tradeoffs | Reassess with a threat model and current implementation evidence | [docs/DECISIONS.md](../DECISIONS.md) |
| ROAD-003 | Postgres RLS | High | Critical tenant-table protection remains planned | Scope data model, migration strategy and regression tests separately | [docs/DECISIONS.md](../DECISIONS.md) |
| ROAD-004 | Production monitoring, SMTP and offsite backup credentials | High | External configuration/credentials are not verified in this repository | Owner provisions access; document redacted operational verification | [docs/DECISIONS.md](../DECISIONS.md) |
| ROAD-005 | Real desktop/mobile visual QA | Medium | Focused checks exist, but broad real-device/browser evidence is incomplete | Run scoped browser/viewport audit after active release gate | [docs/DECISIONS.md](../DECISIONS.md) |

## Recording rule

When a risk is resolved, retain it with a date, evidence link and resolution
note rather than deleting history. Never include credentials, URLs containing
credentials, user PII or raw security secrets in this file.
