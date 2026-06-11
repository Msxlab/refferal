/** Auth sabitleri — secrets .env'den (SPEC 10), TTL'ler SPEC 5: access 15dk. */
export const authConfig = {
  accessSecret: (): string => process.env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret',
  accessTtlSeconds: 15 * 60,
  refreshTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 gun
  inviteTtlMs: 14 * 24 * 60 * 60 * 1000, // 14 gun
  emailTokenTtlMs: 48 * 60 * 60 * 1000, // 48 saat
  passwordResetTtlMs: 60 * 60 * 1000, // 1 saat
};
