# Flow Audit: Auth, Session, And MFA

## Flow

1. User logs in with email/password.
2. API validates password with Argon2.
3. If MFA is required, API returns challenge.
4. User submits TOTP/recovery code.
5. API issues access/refresh token pair.
6. Client persists session.
7. Refresh rotates token and revokes on reuse.
8. Guard rehydrates user/membership/permissions per request.

## Strengths

- Good backend token and MFA primitives.
- Session revocation exists.
- Permissions are database-current, not only JWT-current.

## Breakpoints

- Existing web session landing at `/` is role-incorrect.
- Client-side token persistence is weaker than production-grade storage.
- Mobile lacks post-login security management.

## Linked Findings

- AUD-H02
- AUD-M01
- AUD-M11
