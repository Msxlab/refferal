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
