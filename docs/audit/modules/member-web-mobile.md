# Module Audit: Member Web And Mobile

## Scope

Files reviewed include `apps/web/src/app/app/*`, `apps/mobile/app/*`, mobile `src/lib/*`, mobile theme/components, and member API consumers.

## What Works Well

- Member app is intentionally focused: dashboard, wallet, team, invite.
- Downline visibility is aggregate-limited.
- Mobile mirrors the key member tasks.
- Login and invite registration exist on both web and mobile.
- Mobile push token registration is present.

## Findings

| ID | Severity | Finding |
| --- | --- | --- |
| AUD-M01 | Medium | Mobile session is stored in `AsyncStorage`; web session in `localStorage`. |
| AUD-M11 | Medium | Mobile lacks account/security/notification settings and 2FA management. |
| AUD-M08 | Medium | Money formatting defaults to USD in mobile components/helpers as well as API notifications. |

## Recommendations

- Move mobile token storage to secure native storage.
- Add account/settings tab or screen for email verification status, sessions, 2FA, notification prefs, and logout-all.
- Make tenant currency part of member wallet/dashboard API payloads and formatting helpers.
- Surface push registration failures or permission state in settings rather than silently swallowing all errors.

## Residual Questions

- Is the mobile app intended to remain member-only permanently?
- Should tenant admins have a separate mobile operator app or responsive web-only support?
