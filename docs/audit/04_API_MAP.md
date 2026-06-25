# API Map

## Public And Auth

| Controller | Endpoints | Notes |
| --- | --- | --- |
| `auth` | `POST /v1/auth/register-by-invite`, `login`, `login/2fa`, `refresh`, `logout`, `verify-email`, `password-reset/request`, `password-reset/confirm` | Invite-only registration, 2FA challenge flow, refresh rotation. |
| `auth/2fa` | `GET status`, `POST setup`, `POST enable`, `POST disable` | User-level MFA management. |
| `auth/sessions` | `GET /`, `DELETE /:id`, `POST revoke-all` | Device/session visibility and revocation. |
| `invites` | `GET /v1/invites/:code` | Public invite resolution. |

## Current User And Member App

| Controller | Endpoints | Notes |
| --- | --- | --- |
| `me` | `GET /v1/me`, `GET /v1/me/memberships`, `POST /v1/me/switch-tenant` | Current user and tenant context. |
| `me` | `POST /v1/me/devices` | Expo push token registration. |
| `me` | notification preferences, inbox, unread count, mark read, mark all read | API exists; web/mobile settings surface is incomplete. |
| `app` | `GET /v1/app/dashboard`, `wallet`, `team` | Member dashboard/wallet/team aggregate. |
| `app/invites` | `POST /v1/app/invites`, `GET /v1/app/invites` | Member invite creation/list. |
| `app/payout-requests` | `POST /v1/app/payout-requests`, `GET /v1/app/payout-requests` | Member payout request queue. |

## Tenant Admin

| Controller | Endpoints | Notes |
| --- | --- | --- |
| `admin/sales` | create, list, import, bulk, detail, approve, void, deliver | Backend checks roles/permissions and tenant scope. |
| `admin/payouts` | payable, run, list, approve request, reject request, export CSV | Export has CSV cell guard. Period semantics need clarification. |
| `admin/members` | list, tree, invite, deactivate, activate, role change | Role change and activation paths are protected. |
| `admin/plans` | list, create, simulate | Shared validation. |
| `admin/settings` | get, data-status, patch | Permission-aware partial update. |
| `admin` RBAC | permissions, roles CRUD, people, assign role | Custom role management. |
| `admin` reports | dashboard, analytics, audit | Audit lacks actor join and human diff. |

## Platform And Ops

| Controller | Endpoints | Notes |
| --- | --- | --- |
| `platform` | companies list/detail/network/suspend/reactivate | Platform admin only. |
| `healthz` | `GET /healthz` | Public health check. |
| `metrics` | `GET /metrics` | Public metrics; currently basic. |

## Cross-Cutting API Properties

- `TenantContextInterceptor` provides actor/tenant/membership context to services.
- `AuthGuard` rehydrates membership, role, and permissions from the database.
- `ThrottlerGuard` is global and in-memory.
- Zod validation is used at controllers for many mutable inputs.
- Financial operations use explicit transactions in `EngineService`.
