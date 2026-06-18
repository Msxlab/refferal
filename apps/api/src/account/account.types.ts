import { z } from 'zod';

/** Kendi profilini guncelle (membership-bagimsiz, kullanici seviyesi). */
export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    locale: z.enum(['en', 'tr']).optional(),
  })
  .refine((v) => v.fullName !== undefined || v.locale !== undefined, {
    message: 'en az bir alan gerekli',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Sifre degistir: mevcut sifre dogrulanir, yeni sifre min 10. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** 2FA etkinlestir: authenticator'dan gelen 6 haneli kod. */
export const enable2faSchema = z.object({
  code: z.string().trim().min(6).max(10),
});
export type Enable2faInput = z.infer<typeof enable2faSchema>;

/** 2FA kapat: guvenlik icin mevcut sifre dogrulanir. */
export const disable2faSchema = z.object({
  password: z.string().min(1),
});
export type Disable2faInput = z.infer<typeof disable2faSchema>;

// Gecerli USPS 2-harf kodlari: 50 eyalet + DC + bolgeler (cek yalniz ABD'ye postalanir).
export const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','AS','GU','MP','PR','VI',
]);

/**
 * Cek posta adresi (Faz A2): cek bu adrese postalanir. Hepsi zorunlu (line2 haric).
 * ABD-only: eyalet USPS 2-harf, ZIP 5 veya 5-4. mailingName = cekin "Pay to" satiri.
 */
export const updateMailingAddressSchema = z.object({
  mailingName: z.string().trim().min(2).max(120),
  mailingLine1: z.string().trim().min(3).max(120),
  mailingLine2: z.string().trim().max(120).optional().nullable(),
  mailingCity: z.string().trim().min(2).max(80),
  mailingState: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => US_STATES.has(s), { message: 'gecersiz ABD eyalet kodu (orn. CA, NY)' }),
  mailingPostal: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, 'gecersiz ZIP (12345 ya da 12345-6789)'),
});
export type UpdateMailingAddressInput = z.infer<typeof updateMailingAddressSchema>;

/** Cek postalanabilir mi: zorunlu adres alanlari (line2 haric) dolu mu. Payout kapisi bunu kullanir. */
export function mailingAddressComplete(m: {
  mailingName?: string | null;
  mailingLine1?: string | null;
  mailingCity?: string | null;
  mailingState?: string | null;
  mailingPostal?: string | null;
}): boolean {
  return !!(m.mailingName && m.mailingLine1 && m.mailingCity && m.mailingState && m.mailingPostal);
}
