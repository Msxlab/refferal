# Module Audit: Auth

## Scope

Files reviewed include `apps/api/src/auth/*`, `apps/web/src/lib/auth.ts`, `apps/web/src/app/login/page.tsx`, `apps/mobile/src/lib/auth.ts`, `apps/mobile/src/lib/api.ts`, and mobile/web login routes.

## What Works Well

- Invite-only registration is explicit.
- Login uses Argon2 and dummy timing behavior for missing users.
- Refresh tokens rotate and reuse detection revokes tokens.
- Email verification and password reset use hashed `UserToken` rows.
- Verification/reset notification payload tokens are encrypted before relay.
- MFA supports TOTP setup, enable, disable, challenge login, and recovery-style flows.
- Session list/revoke endpoints exist.
- Login uses role-aware `landingForSession` after fresh authentication.

## Findings

| ID | Severity | Finding |
| --- | --- | --- |
| AUD-M01 | Medium | Web stores session tokens in `localStorage`; mobile stores the full session in `AsyncStorage`. |
| AUD-H02 | High | Existing sessions that visit `/` are redirected to `/admin`, bypassing role-aware landing. |
| AUD-M11 | Medium | Mobile has MFA challenge support but no account/security screen for 2FA management, session revoke, or notification preferences. |

## Recommendations

- Move web refresh token to HttpOnly, Secure, SameSite cookie and keep access token short-lived.
- Move mobile refresh token to Expo SecureStore / native secure storage.
- Use `landingForSession` in the root web route.
- Add mobile account/security settings before production mobile rollout.

## Residual Questions

- Should platform admins who also have tenant memberships default to platform or last-used tenant?
- Should MFA be mandatory for tenant owners/platform admins in production?
