# Module Map

## API Modules

| Module | Responsibility | Notes |
| --- | --- | --- |
| `auth` | Invite registration, login, 2FA, refresh rotation, logout, email verification, password reset, session management | Strongest security module in the repo; token storage on clients remains a production concern. |
| `memberships` / `me` | Current identity, tenant switching, notification preferences, inbox, devices | Tenant switch reissues session context; member notification UX is present mostly on API side. |
| `invites` | Public invite resolution, member invite creation/listing | Missing revoke/opened funnel tracking. |
| `sales` | Admin sale CRUD/list/detail/import/bulk/approve/void/deliver | Good validation and idempotency; CSV import can be optimized. |
| `engine` | Commission application, maturity, void reversals, payouts, monthly summary deltas | Central financial core; good transaction discipline. |
| `payouts` | Admin payable list/run/history/export and member payout requests | Period label semantics should be clarified because payout runs all payable rows for a member. |
| `wallet` | Member dashboard, wallet, team aggregate | Member tree is intentionally aggregate-limited; live ltree queries may need materialization at scale. |
| `members` | Admin member list/tree/invite/activate/deactivate/role | Tree is full-load; no lazy depth/search endpoint. |
| `plans` | Commission-plan listing, creation, simulation | Uses shared validation. |
| `settings` | Tenant financial/security/branding/notification settings | Needs stronger rule-aware validation for timezone/maturation. |
| `rbac` | Permission catalog, custom role CRUD, people-role assignment | Backend enforcement exists. UI gating is convenience only. |
| `reports` | Dashboard, analytics, audit listing | Audit output is raw and not yet investigation-grade. |
| `platform` | Platform tenant list/detail/network/suspend/reactivate | Useful but still light for production support operations. |
| `notifications` | Outbox relay, email/push adapters, preferences, templates | Reliable DB claim pattern; currency formatting is hardcoded to USD. |
| `health` | `/healthz` and `/metrics` | Basic operational surface. |

## Web Areas

| Area | Responsibility | Notes |
| --- | --- | --- |
| Public/login | root redirect, login, invite registration, verify email, reset password | Root redirect is role-incorrect for existing sessions. |
| Member app | dashboard, wallet, team, invite | Good MVP coverage; no account/security/profile screen. |
| Admin app | dashboard, sales, members, tree, payouts, audit, settings | Desktop-first; admin mobile navigation is absent below 720px. |
| Platform app | company list/detail/network and tenant status actions | Admin-support focused, not full operational console. |
| Component system | `components/ui.tsx`, `globals.css`, theme/i18n helpers | Cohesive visual language, but some controls use text/glyphs instead of iconized affordances. |

## Mobile Areas

| Area | Responsibility | Notes |
| --- | --- | --- |
| Auth | login and 2FA challenge | No mobile setup/manage 2FA flow. |
| Invite | code resolution and registration | Mirrors member acquisition path. |
| Tabs | dashboard, wallet, team, invite | Member-only app. |
| Device/push | Expo token registration | Errors are swallowed silently; no user-level notification settings screen. |

## Shared Package

`packages/shared` owns commission math, basis-point validation, cents formatting, and deterministic plan logic. This is the correct place for pure financial logic and should remain dependency-light.
