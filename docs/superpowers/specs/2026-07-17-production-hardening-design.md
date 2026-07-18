# Production Hardening and Manual Payout Readiness

## Objective

Make the single-host Earnica deployment safe to release without weakening payout controls. A payout request or an administrator-created payout batch must be blocked until an authorized reviewer has recorded each required compliance decision. The notification outbox must recover safely from crashes and provider outages. Production Compose must fail closed when critical configuration is missing.

The chosen launch policy is **manual, auditable payout readiness**. It is not a KYC/AML-provider integration and it must never silently treat an unavailable control as ready.

## Assumptions

- The initial deployment has one API replica and PostgreSQL is the source of truth.
- No external KYC, sanctions, fraud, or payment provider is available yet.
- The application stores no raw bank-account details, identity documents, or screening results. It stores only opaque provider references and masked display metadata.
- Owners retain their existing all-permission behavior; tenant administrators need explicit compliance permissions.
- Real production secrets, DNS, mail credentials, offsite-backup credentials, and server access are operational inputs and will not be committed to the repository.

## Scope and non-goals

This release includes the payout, outbox, scheduler observability, and Compose/Docker changes below. It adds a usable administrator compliance review surface alongside the API.

It does not integrate a third-party KYC/AML service, promise exactly-once SMTP/push delivery, configure real external credentials, or change the visual design system beyond the small functional admin controls required for the new flow.

## Design

### 1. Manual payout readiness

Each tenant/member pair receives a current decision for these five checks:

- `address`
- `kyc`
- `fraud`
- `sanctions`
- `payment_method`

The persisted decision contains `status` (`pending`, `ready`, `blocked`, or `expired`), a controlled reason code, reviewer user ID, review time, optional expiry time, and a monotonically changing version. A missing decision and an expired decision are both fail-closed. The evaluator exposes the same structured readiness response to the wallet and payout-request endpoints.

An active payout destination is stored separately. Its record contains only an opaque provider/reference token, a masked display label/last four, country, currency, reviewer metadata, and a version. Raw payment details and document contents are forbidden. A ready `payment_method` decision is valid only with an active verified destination.

`compliance.view` and `compliance.review` are added to RBAC. A reviewer cannot approve their own membership. Review writes create redacted audit events containing status, reason, expiry, and version only. No sensitive evidence or account detail enters the audit log.

The admin review screen shows the five controls, expiry state, masked destination, and audit-safe history. It can create/update a review decision and destination metadata only for the current tenant and only with `compliance.review`.

Payout eligibility is centralized so that member requests, admin payable/preview, direct approval, reservation, and settlement all use the same policy. Preview fingerprints include readiness and destination versions. Reservation re-reads the values under the database transaction; a changed version returns a review-required conflict instead of reserving money. Reservation snapshots only the permitted masked readiness/destination metadata. Settlement rechecks current readiness (especially fraud and sanctions) and returns `409` on drift; an operator must explicitly fail/release the batch before retrying.

### 2. Durable notification outbox

The `notifications` table gains two nullable fields:

- `available_at`: pending rows become eligible at this retry time; processing rows use it as lease expiry.
- `lease_token`: a UUID generated each time a worker claims a row.

The relay keeps `FOR UPDATE SKIP LOCKED` and increments attempts at claim time. It claims due pending rows or expired processing rows below the attempt limit, sets a fresh lease, and processes the resulting batch. Terminal updates use `{ id, status: processing, leaseToken }`, so an old worker cannot overwrite a newer claimant.

Transient failures clear the lease and return the row to `pending` with capped exponential delays of 30, 60, 120, and 240 seconds. A fifth failure becomes the existing `failed` dead-letter state. An expired fifth-attempt processing lease is moved to `failed` before new claims. Sent and failed rows clear both lease fields. This is robust at-least-once delivery; a crash after an SMTP/provider call has started can still produce an external duplicate and is explicitly not represented as exactly-once delivery.

Metrics gain visible aged processing/dead-letter counts. The existing scheduler remains responsible for the ten-second relay tick.

### 3. Commission scheduler safety

Commission maturation remains durable and database-locked, but each transaction processes a bounded due-row batch. The scheduler drains a bounded number of batches per tick, releasing the transaction between batches. It records/exports last successful run, duration, and remaining backlog indicators so a stalled worker is observable without making `/healthz` depend on a business job.

### 4. Production Compose and container hardening

The developer-friendly base `docker-compose.yml` remains usable locally. A new `docker-compose.prod.yml` overlays production-only fail-closed behavior, and `.env.production.example` provides blank, non-deployable placeholders.

The production overlay requires a PostgreSQL password, JWT secret, metrics token, public HTTPS origin, real domain, mail provider configuration, encrypted offsite backup configuration, and backup alert command. It adds restart policies for PostgreSQL/Redis, web readiness checks, and health-gated Caddy dependencies.

Migrations move out of the API PID-1 startup command into a one-shot `migrate` service. The API starts only after a successful migration; its runtime command is the Node process itself. API and web runtime images use a non-root user with owned application files. Compose passes metrics and all supported SMTP/Resend configuration deliberately, while application startup validates the selected production mail provider instead of waiting for the first email to fail.

This release does not put real secret values in any `.env` file. The production deployment command uses the base file plus the production overlay and a privately managed production environment file.

## Data and API boundaries

- Additive Prisma migrations only; existing members start with no ready decision and remain blocked.
- New admin review endpoints are tenant-scoped, role- and permission-protected, schema-validated, and audited.
- Existing member payout endpoints retain their response shape; readiness checks change from `unknown/not_configured` to their persisted state.
- Existing payout batch routes retain their URL shape but enforce the shared readiness policy.
- No raw payment destination, identity, address document, or provider payload appears in APIs, CSV, logs, or audit records.

## Testing strategy

Tests are written first and observed failing before each behavior change.

1. Payout unit and integration tests cover missing/expired/blocked/ready state mapping, wallet/request parity, tenant isolation, permission boundaries, self-review rejection, audit redaction, admin-bypass prevention, preview drift, concurrent review/reservation, settlement recheck, and immutable masked snapshots.
2. Notification integration tests cover timed backoff, final-attempt crash recovery, expired-lease recovery, stale-worker fencing, and lease cleanup on sent/failed states.
3. Scheduler tests cover bounded maturation and backlog/last-success metrics.
4. Docker verification covers Compose configuration with injected non-secret test values, fresh API/web/backup images, migration service execution, health-gated startup, restart behavior, and the existing backup restore test.
5. Final verification runs API type-check/build, the focused suites, the full dedicated-test-database integration suite, workspace build, Compose validation, and serial Docker builds.

## Implementation order

1. Outbox schema, RED tests, relay state machine, and metrics.
2. Scheduler bounded-processing/observability tests and implementation.
3. Payout compliance schema, RBAC, shared eligibility enforcement, audit, and backend tests.
4. Minimal admin/member interfaces using the existing application components.
5. Docker/Compose production overlay, mail validation, non-root images, and deployment verification.
6. Full regression, a production-config smoke test using disposable local values, and a release checklist of operator-owned inputs.

## Success criteria

- A verified-email member cannot request a payout until all five reviewed checks and a verified masked destination are current.
- An administrator cannot bypass those checks through preview, reserve, approval, or settlement.
- All manual reviews are tenant-isolated, permission-gated, self-review-safe, and audit-redacted.
- An outbox row claimed on its fifth attempt is never stranded; retries cannot hot-loop, and stale workers cannot overwrite newer state.
- The scheduler exposes backlog/last-success signals and processes maturities in bounded transactions.
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml` rejects missing production-critical settings, starts only after migration/health prerequisites, and runs app processes non-root.
- Full automated verification passes against the dedicated test database.

## Boundaries

- Always: preserve fail-closed financial controls, use additive migrations, write RED tests first, and keep existing user work intact.
- Ask first: changes to provider choice, real credentials, actual server deployment, legal/compliance policy beyond the manual workflow, or CI/provider accounts.
- Never: store raw payout/KYC data, bypass compliance checks for legacy members, commit secrets, or run destructive database/file commands.
