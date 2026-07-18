# Module Audit: Settings, Platform, And Ops

## Scope

Files reviewed include `apps/api/src/settings/*`, `apps/api/src/platform/*`, `apps/api/src/health/*`, scheduler, API bootstrap/app module, deployment docs, CI, and docker compose.

## What Works Well

- Settings changes are permission-aware and audited.
- Platform admins can list/detail/suspend/reactivate tenants.
- API uses helmet, CORS config, trust proxy, shutdown hooks, and global throttling.
- `/healthz` and `/metrics` exist.
- Scheduler can be disabled in tests.

## Findings

| ID | Severity | Finding |
| --- | --- | --- |
| AUD-M03 | Medium | Settings validation is not strict enough for timezone/maturation rule consistency. |
| AUD-M07 | Medium | In-memory throttling and in-process scheduler are not horizontally safe. |
| AUD-L01 | Low | Prisma config deprecation warning appears during validation. |

## Recommendations

- Add rule-aware settings validation and tests.
- Wire Redis-backed rate limiting before multi-instance deployment.
- Add advisory/distributed locks for jobs that must run once per interval.
- Expand metrics to business and queue health.
- Move Prisma config to `prisma.config.ts` when config/dependency edits are in scope.

## Residual Questions

- Is the intended production topology single API instance or multi-instance?
- Should platform suspend block all member login or only mutations?
