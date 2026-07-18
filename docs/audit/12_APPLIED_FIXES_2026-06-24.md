# Applied Fixes - 2026-06-24

This file records fixes applied after the audit report was created. The original audit files remain useful as the baseline snapshot; this file tracks what changed afterward.

## Applied

- AUD-H02: root web route now uses role-aware `landingForSession`.
- AUD-H03: admin layout now has a mobile navigation bar below the sidebar breakpoint.
- AUD-M02: sale approve/void/deliver actions and payout request approve/reject actions now use confirmation dialogs.
- AUD-M03: settings update now validates IANA timezone and rule-aware maturation day configuration.
- AUD-M04: payout UI copy now clarifies that payout runs process the full payable balance and uses "Run period" wording.
- AUD-M08: notification rendering now uses payload/tenant currency instead of hardcoded USD.
- Ops: Dockerfiles now use BuildKit pnpm cache mounts for faster repeat builds.
- Ops: Docker Compose now applies JSON log rotation to services.
- Ops: Backup service now has stale-backup healthcheck settings and writes `latest.json` on success.
- Ops: Backup script now supports optional offsite retention cleanup.
- Ops: Added host maintenance and restore-drill systemd timer examples under `docker/ops/`.

## Still Open

- AUD-H01: database-level tenant isolation/RLS.
- AUD-H04: payout profile, KYC/tax, billing, API key, and webhook scope.
- AUD-M01: web/mobile token storage hardening.
- AUD-M05: batch CSV import lookups.
- AUD-M06: materialized team stats and lazy tree/network loading.
- AUD-M07: Redis-backed throttling and distributed job locks.
- AUD-M09: invite revoke/opened tracking and inviter-name privacy decision.
- AUD-M10: audit UI actor labels and human diff.
- AUD-M11: mobile account/security/notification settings.
- AUD-L01: Prisma config deprecation cleanup.
