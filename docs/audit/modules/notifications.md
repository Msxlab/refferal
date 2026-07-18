# Module Audit: Notifications

## Scope

Files reviewed include `apps/api/src/notifications/*`, notification preferences in `me`, device registration, mobile push registration, and related schema.

## What Works Well

- Notification rows act as an outbox.
- Relay claims rows with `FOR UPDATE SKIP LOCKED`.
- `processing` state avoids duplicate work during concurrent relay loops.
- Max attempts and retry/failure states exist.
- Email and Expo push adapters are separated.
- Invalid Expo tokens are cleaned up.
- Preferences are enforced.
- Sensitive verify/reset tokens are encrypted and payloads can be redacted after relay.

## Findings

| ID | Severity | Finding |
| --- | --- | --- |
| AUD-M08 | Medium | Notification templates format money using hardcoded USD. |
| AUD-M11 | Medium | Client notification preference management is incomplete, especially mobile. |

## Recommendations

- Include tenant currency in notification payloads or resolve it during template rendering.
- Add account/settings UI for notification preferences on web member and mobile.
- Add metrics for pending/processing/failed notification counts and relay lag.
- Consider a dead-letter/replay operator workflow for failed notifications.

## Residual Questions

- Are email links expected to be sent only by relay, or should local/dev preview expose them?
- Should notification content be localized per tenant/user locale?
