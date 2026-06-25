# Global Findings

## Severity Summary

- Critical: 0 current verified findings.
- High: 4 findings.
- Medium: 11 findings.
- Low: 1 finding.

## Findings

| ID | Severity | Area | Finding | Evidence | Recommended Fix |
| --- | --- | --- | --- | --- | --- |
| AUD-H01 | High | Security / tenancy | No database-level RLS boundary was found for tenant data. | `rg` found no `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY`; tenancy is application-enforced. | Add RLS for critical tenant tables, transaction-local tenant context, and cross-tenant regression tests. |
| AUD-H02 | High | Web routing | Root route sends every existing session to `/admin`. | `apps/web/src/app/page.tsx` uses `router.replace(getSession() ? '/admin' : '/login')`; `landingForSession` exists. | Use `landingForSession(getSession())` or equivalent role-aware redirect. |
| AUD-H03 | High | Admin UX | Admin navigation disappears on mobile. | `.side` is hidden at max-width 720px in `globals.css`; admin layout has no mobile nav fallback. | Add admin responsive nav/drawer/topbar and preserve logout/theme access. |
| AUD-H04 | High | Product readiness | Payout profile, KYC/TIN/1099, billing, API key, and webhook surfaces are absent. | No matching schema/API modules found; product docs list these as later-stage needs. | Decide production launch scope; add a compliance/billing epic if real payouts or SaaS billing are in scope. |
| AUD-M01 | Medium | Client security | Refresh/session data is stored in web `localStorage` and mobile `AsyncStorage`. | `apps/web/src/lib/auth.ts`, `apps/mobile/src/lib/auth.ts`. | Move web refresh token to HttpOnly cookie and mobile refresh token to SecureStore/Keychain. |
| AUD-M02 | Medium | Money UX | Some money/state-changing actions bypass confirmation. | Sale detail drawer actions call API directly; payout request approve/reject call API directly. | Route all approve/void/deliver/payout decision actions through `Confirm`. |
| AUD-M03 | Medium | Settings logic | Timezone and maturation settings are not rule-aware validated. | `timezone` is any 3-64 char string; `days_after_approval` can have null days and engine treats null as 0. | Validate IANA timezone and enforce maturation day requirements per rule. |
| AUD-M04 | Medium | Payout semantics | Payout period label can imply period-filtered payout, but engine pays all payable rows for the member. | `payoutMember` filters tenant, member, and `status='payable'`; no ledger period filter. | Clarify product semantics or filter by summary/sale period if period-specific payouts are required. |
| AUD-M05 | Medium | Import performance | CSV import performs row-by-row seller and duplicate lookups. | `SalesService.importCsv` loops and calls seller/external-ref lookups per row. | Batch prefetch referral codes/external refs and add optional all-or-nothing import mode. |
| AUD-M06 | Medium | Tree performance | Tree/team APIs are live/full-load and `team_stats` is unused. | `TeamStat` exists; wallet uses live ltree query; admin tree returns full tree. | Implement materialized stats and lazy tree pagination/search for large tenants. |
| AUD-M07 | Medium | Ops / scale | Rate limiting is in-memory and scheduled jobs lack distributed locks. | `ThrottlerModule.forRoot` uses no Redis store; cron runs in-process. | Use Redis-backed throttling and DB advisory/distributed locks for singleton jobs. |
| AUD-M08 | Medium | Notifications | Notification templates hardcode USD. | `apps/api/src/notifications/templates.ts` uses `currency: 'USD'`. | Pass tenant currency into payload/template rendering. |
| AUD-M09 | Medium | Invites / privacy | Invite revoke/open funnel is missing; resolve exposes inviter name. | Invite controller has create/list/resolve only; schema lacks opened tracking. | Add revoke/opened fields and decide privacy setting for inviter display. |
| AUD-M10 | Medium | Audit UX | Audit UI is raw JSON-oriented and lacks actor/entity enrichment. | `apps/web/src/app/admin/audit/page.tsx` renders `JSON.stringify` and actor ID slice. | Add actor joins, human labels, field diff, filters, and CSV export. |
| AUD-M11 | Medium | Mobile UX/security | Mobile lacks account/security/notification settings and post-login 2FA management. | Mobile route map only includes login/invite/tabs for dashboard/wallet/team/invite. | Add account settings for session revoke, 2FA, email status, notification prefs. |
| AUD-L01 | Low | Tooling | Prisma warns that `package.json#prisma` config is deprecated. | `prisma validate` warning. | Move Prisma config to `prisma.config.ts` when dependency/config changes are in scope. |
