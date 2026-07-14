/** Auth constants: secrets come from .env (SPEC 10), and SPEC 5 defines the access TTL as 15 minutes. */
export const authConfig = {
  accessSecret: (): string => {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (secret) return secret;
    // A fixed/known production secret enables token forgery, so fail fast. See DECISIONS.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET is not configured and is required in production');
    }
    return 'dev-only-access-secret';
  },
  accessTtlSeconds: 15 * 60,
  refreshTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  inviteTtlMs: 14 * 24 * 60 * 60 * 1000, // 14 days
  emailTokenTtlMs: 48 * 60 * 60 * 1000, // 48 hours
  passwordResetTtlMs: 60 * 60 * 1000, // 1 hour
};
