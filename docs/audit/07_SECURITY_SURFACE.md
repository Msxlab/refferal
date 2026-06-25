# Security Surface

## Strengths

- Helmet is enabled for API responses.
- CORS origins are environment-driven.
- `trust proxy` is set for reverse-proxy deployments.
- Auth uses Argon2 and timing-equal dummy behavior for missing users.
- Refresh-token rotation and reuse detection exist.
- Email verification/password reset tokens are hashed in `UserToken` and encrypted in notification payloads.
- MFA supports TOTP and recovery codes.
- Guard rehydrates tenant membership, role, and permissions from the database instead of trusting only token claims.
- Backend permission checks exist for sensitive admin routes.
- Ledger immutability is enforced by database triggers.
- Financial mutations are transaction-bound and audited.
- CSV export paths defend against spreadsheet formula injection.

## Key Risks

| ID | Severity | Risk |
| --- | --- | --- |
| AUD-H01 | High | Tenant isolation relies on application discipline; no PostgreSQL RLS policies were found in Prisma migrations/schema. |
| AUD-M01 | Medium | Web stores session tokens in `localStorage`; mobile stores session tokens in `AsyncStorage`. |
| AUD-M07 | Medium | Rate limiting is in-memory and scheduler/cron coordination is not distributed-lock based. |
| AUD-M03 | Medium | Settings validation accepts arbitrary timezone strings and does not enforce maturation rule/day consistency. |
| AUD-M09 | Medium | Invite resolve exposes inviter name publicly; may be acceptable, but privacy posture should be explicit. |

## Tenant Isolation

Most services include tenant filters and the guard rehydrates membership context. That is good application-level control. The missing deeper control is database-level RLS for tables containing tenant data. Without RLS, any future missed `tenantId` filter in raw SQL, Prisma query, report, import, or platform path can leak or mutate cross-tenant data.

Recommended hardening:

- enable RLS on high-value tenant tables,
- add policies for `tenant_id`,
- add transaction-local tenant context,
- add tests that intentionally attempt cross-tenant reads/writes through service and raw query paths.

## Token Storage

Client storage is documented as an MVP tradeoff, but production should move toward:

- HttpOnly, Secure, SameSite web refresh cookie,
- short-lived access token in memory,
- Expo SecureStore / Keychain / Keystore for mobile refresh tokens,
- strict CSP and XSS review for all web pages that render user content or JSON.

## Operational Security

The app has basic health and metrics, but production monitoring should include auth anomalies, token reuse, failed payout attempts, relay failures, maturity lag, queue depth, and cross-tenant guard denials.
