import { z } from 'zod';

/** ABA routing checksum: 9 hane, agirlikli (3,7,1) mod 10. */
export function abaValid(r: string): boolean {
  if (!/^\d{9}$/.test(r)) return false;
  const d = r.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

// ABD: SSN/EIN 9 hane; TAM deger SAKLANMAZ, yalniz son-4. Hesap no 4-17 hane → son-4.
export const upsertProfileSchema = z.object({
  legalName: z.string().trim().min(2).max(120),
  country: z.string().trim().length(2).toUpperCase().default('US'),
  taxIdType: z.enum(['ssn', 'ein']),
  taxId: z.string().trim().regex(/^\d{9}$/, 'TIN 9 hane olmali (SSN/EIN)'),
  bankName: z.string().trim().max(80).optional(),
  routingNumber: z.string().trim().refine(abaValid, 'gecersiz ABA routing numarasi'),
  accountType: z.enum(['checking', 'savings']),
  accountNumber: z.string().trim().regex(/^\d{4,17}$/, 'gecersiz banka hesap numarasi'),
});
export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>;

export const decideProfileSchema = z.object({
  action: z.enum(['verify', 'reject']),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type DecideProfileInput = z.infer<typeof decideProfileSchema>;

export const listProfilesSchema = z.object({
  status: z.enum(['unverified', 'pending_review', 'verified', 'rejected']).optional(),
});
export type ListProfilesInput = z.infer<typeof listProfilesSchema>;

// Banka/kimlik degisikligi sonrasi soguma (anti-account-takeover): bu sure gecmeden payout yok.
export const KYC_COOLDOWN_DAYS = 3;

/**
 * Payout engeli (KYC kapisi acikken). null = engel yok. Tenant ayari kapaliyken cagrilmaz.
 */
export function kycPayoutBlock(
  p: { status: string; lastChangedAt: Date } | null,
  now: Date = new Date(),
): string | null {
  if (!p) return 'payout profile not set up';
  if (p.status === 'rejected') return 'payout profile was rejected';
  if (p.status !== 'verified') return 'payout profile pending verification';
  const elapsed = now.getTime() - new Date(p.lastChangedAt).getTime();
  if (elapsed < KYC_COOLDOWN_DAYS * 86_400_000) return 'payout profile recently changed — cooling-down period';
  return null;
}
