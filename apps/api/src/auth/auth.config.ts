/** Auth sabitleri — secrets .env'den (SPEC 10), TTL'ler SPEC 5: access 15dk. */
export const authConfig = {
  accessSecret: (): string => {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (secret) return secret;
    // Uretimde sabit/bilinen secret = token forgery → fail-fast (bkz. DECISIONS).
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET tanimli degil (uretimde zorunlu)');
    }
    return 'dev-only-access-secret';
  },
  accessTtlSeconds: 15 * 60,
  refreshTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 gun
  inviteTtlMs: 14 * 24 * 60 * 60 * 1000, // 14 gun
  emailTokenTtlMs: 48 * 60 * 60 * 1000, // 48 saat
  passwordResetTtlMs: 60 * 60 * 1000, // 1 saat
};
