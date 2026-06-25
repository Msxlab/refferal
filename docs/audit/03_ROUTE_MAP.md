# Route Map

## Web Routes

| Route | File | Audience | Notes |
| --- | --- | --- | --- |
| `/` | `apps/web/src/app/page.tsx` | All | Redirects any session to `/admin`; should use role-aware landing. |
| `/login` | `apps/web/src/app/login/page.tsx` | All | Uses role-aware `landingForSession` after login. |
| `/verify-email` | `apps/web/src/app/verify-email/page.tsx` | All | Email verification confirmation. |
| `/reset-password` | `apps/web/src/app/reset-password/page.tsx` | All | Password reset. |
| `/i/[code]` | `apps/web/src/app/i/[code]/page.tsx` | Invitee | Invite registration. |
| `/app` | `apps/web/src/app/app/page.tsx` | Member | Member dashboard. |
| `/app/wallet` | `apps/web/src/app/app/wallet/page.tsx` | Member | Wallet and payout request. |
| `/app/team` | `apps/web/src/app/app/team/page.tsx` | Member | Aggregate team view. |
| `/app/invite` | `apps/web/src/app/app/invite/page.tsx` | Member | Invite creation/list. |
| `/admin` | `apps/web/src/app/admin/page.tsx` | Tenant staff/admin/owner | Dashboard. |
| `/admin/sales` | `apps/web/src/app/admin/sales/page.tsx` | Tenant staff/admin/owner | Sales import/list/detail/actions. |
| `/admin/members` | `apps/web/src/app/admin/members/page.tsx` | Tenant staff/admin/owner | Member list/invite/status. |
| `/admin/tree` | `apps/web/src/app/admin/tree/page.tsx` | Tenant staff/admin/owner | Tenant tree. |
| `/admin/payouts` | `apps/web/src/app/admin/payouts/page.tsx` | Tenant admin/owner | Payout queue/history/export. |
| `/admin/audit` | `apps/web/src/app/admin/audit/page.tsx` | Tenant admin/owner | Audit log. |
| `/admin/settings` | `apps/web/src/app/admin/settings/page.tsx` | Tenant admin/owner | Settings, roles, plans, data status. |
| `/platform` | `apps/web/src/app/platform/page.tsx` | Platform admin | Tenant list. |
| `/platform/companies/[id]` | `apps/web/src/app/platform/companies/[id]/page.tsx` | Platform admin | Tenant detail/network/actions. |

## Mobile Routes

| Route | File | Audience | Notes |
| --- | --- | --- | --- |
| `/` | `apps/mobile/app/index.tsx` | Member | Auth gate / initial route. |
| `/login` | `apps/mobile/app/login.tsx` | Member | Login and 2FA challenge. |
| `/i/[code]` | `apps/mobile/app/i/[code].tsx` | Invitee | Mobile invite registration. |
| `/(tabs)` | `apps/mobile/app/(tabs)/_layout.tsx` | Member | Tab shell. |
| `/(tabs)/index` | `apps/mobile/app/(tabs)/index.tsx` | Member | Dashboard. |
| `/(tabs)/wallet` | `apps/mobile/app/(tabs)/wallet.tsx` | Member | Wallet/payout. |
| `/(tabs)/team` | `apps/mobile/app/(tabs)/team.tsx` | Member | Team aggregate. |
| `/(tabs)/invite` | `apps/mobile/app/(tabs)/invite.tsx` | Member | Invite creation/list. |

## API Route Families

The API uses `/v1` globally except `/healthz` and `/metrics`.

- Public: `GET /v1/invites/:code`, auth request/confirm endpoints.
- Authenticated current-user: `/v1/me/*`, `/v1/app/*`, `/v1/app/invites`, `/v1/app/payout-requests`.
- Tenant admin: `/v1/admin/*`.
- Platform admin: `/v1/platform/*`.
- Ops: `/healthz`, `/metrics`.
